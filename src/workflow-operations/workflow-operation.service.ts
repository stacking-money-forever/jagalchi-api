import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import {
  WorkflowOperation,
  WorkflowOperationResult,
  WorkflowOperationState,
  WorkflowWorkerHeartbeat,
} from './workflow-operation.entities';
import { WorkflowBackoffPolicy, WorkflowClock } from './workflow-runtime';
import { ProjectRunCommand } from '../project-runs/product-spine.entities';

const TERMINAL = new Set([
  WorkflowOperationState.Succeeded,
  WorkflowOperationState.Failed,
  WorkflowOperationState.Cancelled,
]);
const FAILURE_CLASSES = new Set([
  'TRANSIENT_DEPENDENCY',
  'CONTRACT_VIOLATION',
  'NONRETRYABLE_DEPENDENCY',
  'TERMINAL_HANDLER',
  'RETRY_EXHAUSTED',
  'TERMINAL',
]);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class WorkflowOperationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkflowOperation)
    private readonly operations: Repository<WorkflowOperation>,
    @InjectRepository(WorkflowOperationResult)
    private readonly results: Repository<WorkflowOperationResult>,
    @InjectRepository(WorkflowWorkerHeartbeat)
    private readonly workerHeartbeats?: Repository<WorkflowWorkerHeartbeat>,
    private readonly clock: WorkflowClock = new WorkflowClock(),
    private readonly backoff: WorkflowBackoffPolicy = {
      delayMs: (attempts) => Math.min(30_000, 1_000 * (2 ** Math.max(0, attempts - 1))),
    } as WorkflowBackoffPolicy,
  ) {}

  async get(ownerId: string, id: string) {
    const operation = await this.operations.findOneByOrFail({ id, ownerId });
    const result = operation.state === WorkflowOperationState.Succeeded
      ? await this.results.findOne({ where: { operationId: id } }) : null;
    return {
      id: operation.id, kind: operation.kind, state: operation.state, version: operation.version,
      attempt: operation.attempts, maxAttempts: operation.maxAttempts, nextAttemptAt: operation.nextAttemptAt,
      result: operation.state === WorkflowOperationState.Succeeded ? {
        resourceType: operation.resultType, resourceId: operation.resultId, resourceHref: operation.resultHref,
      } : null,
      error: operation.state === WorkflowOperationState.Failed ? { code: operation.errorCode, retryable: operation.failureClass === 'TRANSIENT_DEPENDENCY' } : null,
      createdAt: operation.createdAt, updatedAt: operation.updatedAt,
      body: result?.value ?? null,
    };
  }

  async createOrReplay(args: {
    ownerId: string;
    route: string;
    idempotencyKey: string;
    kind: string;
    input: Record<string, unknown>;
  }): Promise<{ operation: WorkflowOperation; replayed: boolean }> {
    const inputHash = createHash('sha256').update(canonicalJson(args.input)).digest('hex');
    const existing = await this.operations.findOne({
      where: { ownerId: args.ownerId, route: args.route, idempotencyKey: args.idempotencyKey },
    });
    if (existing) {
      if (existing.kind !== args.kind || existing.inputHash !== inputHash) {
        throw new ConflictException('Idempotency key was already used with a different request');
      }
      return { operation: existing, replayed: true };
    }
    try {
      const now = this.clock.now();
      const schemaVersion = Number.isInteger(args.input.schemaVersion)
        ? Number(args.input.schemaVersion) : 1;
      const operation = await this.operations.save(this.operations.create({
        ...args,
        inputHash,
        inputSchemaVersion: schemaVersion,
        resultSchemaVersion: 1,
        state: WorkflowOperationState.Pending,
        version: 1,
        availableAt: now,
        nextAttemptAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        attempts: 0,
        maxAttempts: 3,
        errorCode: null,
        errorMessage: null,
        failureClass: null,
        resultType: null,
        resultId: null,
        resultHref: null,
        completedAt: null,
      }));
      return { operation, replayed: false };
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      return this.createOrReplay(args);
    }
  }

  async claim(workerId: string, leaseMs: number, kinds?: string[]): Promise<WorkflowOperation | null> {
    return this.dataSource.transaction(async (manager) => {
      const query = manager.getRepository(WorkflowOperation)
        .createQueryBuilder('operation')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('operation.state = :state', { state: WorkflowOperationState.Pending })
        .andWhere('operation.next_attempt_at <= :now', { now: this.clock.now() })
        .andWhere('operation.attempts < operation.max_attempts')
        .orderBy('operation.next_attempt_at', 'ASC')
        .addOrderBy('operation.created_at', 'ASC');
      if (kinds) {
        if (kinds.length === 0) return null;
        query.andWhere({ kind: In(kinds) });
      }
      const operation = await query.getOne();
      if (!operation) return null;
      const now = this.clock.now();
      operation.state = WorkflowOperationState.Running;
      operation.leaseOwner = workerId;
      operation.heartbeatAt = now;
      operation.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      operation.attempts += 1;
      operation.version = (operation.version ?? 1) + 1;
      return manager.getRepository(WorkflowOperation).save(operation);
    });
  }

  async heartbeat(id: string, workerId: string, leaseMs: number): Promise<boolean> {
    const now = this.clock.now();
    const result = await this.operations.createQueryBuilder()
      .update()
      .set({ heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseMs) })
      .where('id = :id', { id })
      .andWhere('lease_owner = :workerId', { workerId })
      .andWhere('state = :state', { state: WorkflowOperationState.Running })
      .andWhere('lease_expires_at > :now', { now })
      .execute();
    await this.recordWorkerHeartbeat(workerId, now);
    return (result.affected ?? 0) === 1;
  }

  async requestCancel(id: string, ownerId: string): Promise<WorkflowOperation> {
    return this.dataSource.transaction(async (manager) => {
      const operations = manager.getRepository(WorkflowOperation);
      const operation = await operations.findOneOrFail({
        where: { id, ownerId }, lock: { mode: 'pessimistic_write' },
      });
      if (['JOB_TARGET_IMPORT', 'CANDIDATE_PROFILE_SNAPSHOT', 'PROJECT_PROPOSALS_V1', 'PROJECT_RUN_CREATE', 'TASK_VERIFICATION'].includes(operation.kind)) {
        throw new ConflictException({ code: 'CANONICAL_CANCEL_REQUIRED', message: 'Use the versioned workflow cancellation route' });
      }
      if (TERMINAL.has(operation.state)) return operation;
      operation.state = operation.state === WorkflowOperationState.Pending
        ? WorkflowOperationState.Cancelled
        : WorkflowOperationState.CancelRequested;
      if (operation.state === WorkflowOperationState.Cancelled) operation.completedAt = this.clock.now();
      operation.version = (operation.version ?? 1) + 1;
      return operations.save(operation);
    });
  }

  async requestCancelVersioned(id: string, ownerId: string, expectedVersion: number, idempotencyKey: string) {
    const route = `/api/workflow-operations/${id}/cancel`;
    const inputHash = createHash('sha256').update(canonicalJson({ expectedVersion })).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand);
      const prior = await commands.findOne({ where: { ownerId, route, idempotencyKey } });
      if (prior) { if (prior.inputHash !== inputHash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was reused' }); return prior.response; }
      const operations = manager.getRepository(WorkflowOperation);
      const operation = await operations.findOne({ where: { id, ownerId }, lock: { mode: 'pessimistic_write' } });
      if (!operation) throw new ConflictException({ code: 'OPERATION_NOT_FOUND', message: 'Operation is not available' });
      if (operation.version !== expectedVersion) throw new ConflictException({ code: 'STALE_VERSION', message: 'Operation version is stale' });
      if (TERMINAL.has(operation.state)) throw new ConflictException({ code: 'OPERATION_TERMINAL', message: 'Operation is terminal' });
      if (operation.state === WorkflowOperationState.CancelRequested) throw new ConflictException({ code: 'OPERATION_CANCEL_ALREADY_REQUESTED', message: 'Cancellation is already requested' });
      operation.state = operation.state === WorkflowOperationState.Pending ? WorkflowOperationState.Cancelled : WorkflowOperationState.CancelRequested;
      if (operation.state === WorkflowOperationState.Cancelled) operation.completedAt = this.clock.now();
      operation.version = (operation.version ?? 1) + 1; await operations.save(operation);
      const response = { id: operation.id, state: operation.state, version: operation.version };
      await commands.save(commands.create({ ownerId, route, idempotencyKey, inputHash, response })); return response;
    });
  }

  async succeed(
    id: string,
    workerId: string,
    value: Record<string, unknown>,
    resource?: { type: string; id: string; href: string; schemaVersion?: number },
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const operations = manager.getRepository(WorkflowOperation);
      const operation = await operations.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!operation || operation.leaseOwner !== workerId || operation.state !== WorkflowOperationState.Running || !operation.leaseExpiresAt || operation.leaseExpiresAt.getTime() <= this.clock.now().getTime()) {
        return false;
      }
      const results = manager.getRepository(WorkflowOperationResult);
      await results.save(results.create({ operationId: id, value }));
      operation.state = WorkflowOperationState.Succeeded;
      operation.version = (operation.version ?? 1) + 1;
      operation.completedAt = this.clock.now();
      operation.leaseOwner = null;
      operation.leaseExpiresAt = null;
      operation.resultType = resource?.type ?? `${operation.kind}_RESULT`;
      operation.resultId = resource?.id ?? operation.id;
      operation.resultHref = resource?.href ?? `/api/v1/operations/${operation.id}`;
      operation.resultSchemaVersion = resource?.schemaVersion ?? 1;
      operation.errorCode = null;
      operation.errorMessage = null;
      operation.failureClass = null;
      await operations.save(operation);
      return true;
    });
  }

  async fail(id: string, workerId: string, code: string, message: string, failureClass = 'TERMINAL'): Promise<boolean> {
    return this.completeFailure(id, workerId, code, message, failureClass);
  }

  async retry(id: string, workerId: string, code: string, message: string, failureClass: string): Promise<'RETRIED' | 'FAILED' | 'LOST'> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WorkflowOperation);
      const operation = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      const now = this.clock.now();
      if (!this.ownsLiveLease(operation, workerId, now)) return 'LOST';
      operation.errorCode = code;
      operation.errorMessage = message.slice(0, 1000);
      operation.failureClass = this.redactedFailureClass(failureClass, 'TRANSIENT_DEPENDENCY');
      operation.leaseOwner = null;
      operation.leaseExpiresAt = null;
      operation.heartbeatAt = null;
      if (operation.attempts >= operation.maxAttempts) {
        operation.state = WorkflowOperationState.Failed;
        operation.version = (operation.version ?? 1) + 1;
        operation.completedAt = now;
        operation.failureClass = 'RETRY_EXHAUSTED';
        await repository.save(operation);
        return 'FAILED';
      }
      const nextAttemptAt = new Date(now.getTime() + this.backoff.delayMs(operation.attempts));
      operation.state = WorkflowOperationState.Pending;
      operation.version = (operation.version ?? 1) + 1;
      operation.availableAt = nextAttemptAt;
      operation.nextAttemptAt = nextAttemptAt;
      await repository.save(operation);
      return 'RETRIED';
    });
  }

  async finishCancellation(id: string, workerId: string): Promise<boolean> {
    const now = this.clock.now();
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WorkflowOperation);
      const operation = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!this.ownsLiveLease(operation, workerId, now) || operation.state !== WorkflowOperationState.CancelRequested) return false;
      operation.state = WorkflowOperationState.Cancelled;
      operation.version = (operation.version ?? 1) + 1;
      operation.completedAt = now;
      operation.leaseOwner = null;
      operation.leaseExpiresAt = null;
      await repository.save(operation);
      return true;
    });
  }

  async abandon(id: string, workerId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WorkflowOperation);
      const operation = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!operation || operation.leaseOwner !== workerId || ![WorkflowOperationState.Running, WorkflowOperationState.CancelRequested].includes(operation.state)) return false;
      const now = this.clock.now();
      operation.state = operation.state === WorkflowOperationState.CancelRequested
        ? WorkflowOperationState.Cancelled : WorkflowOperationState.Pending;
      operation.completedAt = operation.state === WorkflowOperationState.Cancelled ? now : null;
      operation.availableAt = now;
      operation.nextAttemptAt = now;
      operation.leaseOwner = null;
      operation.leaseExpiresAt = null;
      operation.heartbeatAt = null;
      operation.version = (operation.version ?? 1) + 1;
      await repository.save(operation);
      return true;
    });
  }

  async reapExpired(now = this.clock.now()): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WorkflowOperation);
      const expired = await repository.createQueryBuilder('operation')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('operation.state IN (:...states)', { states: [WorkflowOperationState.Running, WorkflowOperationState.CancelRequested] })
        .andWhere('operation.lease_expires_at < :now', { now })
        .orderBy('operation.lease_expires_at', 'ASC')
        .getMany();
      for (const operation of expired) {
        operation.leaseOwner = null;
        operation.leaseExpiresAt = null;
        operation.heartbeatAt = null;
        if (operation.state === WorkflowOperationState.CancelRequested) {
          operation.state = WorkflowOperationState.Cancelled;
          operation.completedAt = now;
        } else if (operation.attempts >= operation.maxAttempts) {
          operation.state = WorkflowOperationState.Failed;
          operation.errorCode = 'LEASE_EXPIRED';
          operation.errorMessage = 'Workflow operation exhausted its retry budget';
          operation.failureClass = 'RETRY_EXHAUSTED';
          operation.completedAt = now;
        } else {
          const nextAttemptAt = new Date(now.getTime() + this.backoff.delayMs(operation.attempts));
          operation.state = WorkflowOperationState.Pending;
          operation.errorCode = 'LEASE_EXPIRED';
          operation.errorMessage = 'Workflow worker lease expired before completion';
          operation.failureClass = 'TRANSIENT_DEPENDENCY';
          operation.availableAt = nextAttemptAt;
          operation.nextAttemptAt = nextAttemptAt;
        }
        operation.version = (operation.version ?? 1) + 1;
        await repository.save(operation);
      }
      return expired.length;
    });
  }

  async recordWorkerHeartbeat(workerId: string, at = this.clock.now()): Promise<void> {
    if (!this.workerHeartbeats) return;
    await this.workerHeartbeats.upsert({ workerId, heartbeatAt: at }, ['workerId']);
  }

  async latestWorkerHeartbeat(): Promise<Date | null> {
    if (!this.workerHeartbeats) return null;
    const row = await this.workerHeartbeats.findOne({ order: { heartbeatAt: 'DESC' } });
    return row?.heartbeatAt ?? null;
  }

  private ownsLiveLease(operation: WorkflowOperation | null, workerId: string, now: Date): operation is WorkflowOperation {
    return !!operation && operation.leaseOwner === workerId && !!operation.leaseExpiresAt
      && operation.leaseExpiresAt.getTime() > now.getTime()
      && [WorkflowOperationState.Running, WorkflowOperationState.CancelRequested].includes(operation.state);
  }

  private async completeFailure(id: string, workerId: string, code: string, message: string, failureClass: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WorkflowOperation);
      const operation = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      const now = this.clock.now();
      if (!this.ownsLiveLease(operation, workerId, now) || operation.state !== WorkflowOperationState.Running) return false;
      operation.state = WorkflowOperationState.Failed;
      operation.version = (operation.version ?? 1) + 1;
      operation.errorCode = code;
      operation.errorMessage = message.slice(0, 1000);
      operation.failureClass = this.redactedFailureClass(failureClass, 'TERMINAL');
      operation.completedAt = now;
      operation.leaseOwner = null;
      operation.leaseExpiresAt = null;
      await repository.save(operation);
      return true;
    });
  }

  private redactedFailureClass(value: string, fallback: string): string {
    return FAILURE_CLASSES.has(value) ? value : fallback;
  }
}
