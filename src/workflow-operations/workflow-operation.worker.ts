import { Injectable, Logger } from '@nestjs/common';
import { WorkflowOperation } from './workflow-operation.entities';
import { WorkflowOperationService } from './workflow-operation.service';
import { ConfigService } from '@nestjs/config';
import { workflowTiming } from './workflow-timing';
import { RetryableWorkflowError, WorkflowClock } from './workflow-runtime';

export type WorkflowOperationHandler = (
  operation: WorkflowOperation,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;

@Injectable()
export class WorkflowOperationHandlers {
  private readonly handlers = new Map<string, WorkflowOperationHandler>();

  register(kind: string, handler: WorkflowOperationHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Workflow handler already registered: ${kind}`);
    this.handlers.set(kind, handler);
  }

  kinds(): string[] { return [...this.handlers.keys()]; }
  get(kind: string): WorkflowOperationHandler | undefined { return this.handlers.get(kind); }
}

@Injectable()
export class WorkflowOperationWorker {
  private readonly logger = new Logger(WorkflowOperationWorker.name);
  private active: { operationId: string; workerId: string; abort: AbortController } | undefined;
  private stopping = false;

  constructor(
    private readonly operations: WorkflowOperationService,
    private readonly handlers: WorkflowOperationHandlers,
    private readonly config: ConfigService,
    private readonly clock: WorkflowClock = new WorkflowClock(),
  ) {}

  async runOnce(workerId: string): Promise<boolean> {
    if (this.stopping) return false;
    const { leaseMs, heartbeatMs } = workflowTiming(this.config);
    await this.operations.recordWorkerHeartbeat(workerId);
    await this.operations.reapExpired();
    const operation = await this.operations.claim(workerId, leaseMs, this.handlers.kinds());
    if (!operation) return false;
    const handler = this.handlers.get(operation.kind);
    if (!handler) return false;
    const abort = new AbortController();
    this.active = { operationId: operation.id, workerId, abort };
    const heartbeat = setInterval(() => {
      void this.operations.heartbeat(operation.id, workerId, leaseMs).then((owned) => {
        if (!owned) abort.abort();
      }).catch(() => abort.abort());
    }, heartbeatMs);
    heartbeat.unref();
    try {
      const holdMs = Number(this.config.get<string>('WORKFLOW_HOLD_AFTER_CLAIM_MS', '0'));
      if (holdMs > 0) await this.clock.sleep(holdMs, abort.signal);
      const result = await handler(operation, abort.signal);
      if (!(await this.operations.finishCancellation(operation.id, workerId))) {
        await this.operations.succeed(operation.id, workerId, result, this.resourceMetadata(operation, result));
      }
    } catch (error) {
      if (this.stopping) {
        await this.operations.abandon(operation.id, workerId);
      } else if (!(await this.operations.finishCancellation(operation.id, workerId))) {
        const failure = this.classifyFailure(error);
        this.logger.error(`Workflow operation ${operation.id} failed with ${failure.code}: ${failure.message}`);
        if (failure.retryable) {
          await this.operations.retry(operation.id, workerId, failure.code, failure.message, failure.failureClass);
        } else {
          await this.operations.fail(operation.id, workerId, failure.code, failure.message, failure.failureClass);
        }
      }
    } finally {
      clearInterval(heartbeat);
      if (this.active?.operationId === operation.id) this.active = undefined;
    }
    return true;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const active = this.active;
    if (!active) return;
    active.abort.abort(new Error('Workflow worker is shutting down'));
    await this.operations.abandon(active.operationId, active.workerId);
  }

  private classifyFailure(error: unknown): {
    code: string;
    message: string;
    failureClass: string;
    retryable: boolean;
  } {
    if (error instanceof RetryableWorkflowError) {
      return {
        code: error.code,
        message: 'A transient dependency prevented workflow completion',
        failureClass: error.failureClass,
        retryable: true,
      };
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'AI_CONTRACT_INVALID') {
      return {
        code: 'AI_CONTRACT_INVALID',
        message: error instanceof Error ? error.message : 'AI response violates the canonical contract',
        failureClass: 'CONTRACT_VIOLATION',
        retryable: false,
      };
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'AI_REQUEST_REJECTED') {
      return {
        code: 'AI_REQUEST_REJECTED',
        message: 'AI service rejected the workflow request',
        failureClass: 'NONRETRYABLE_DEPENDENCY',
        retryable: false,
      };
    }
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^(JOB_SOURCE_|MANUAL_CAPTURE_|REPOSITORY_|SNAPSHOT_|INSUFFICIENT_|EVIDENCE_)/.test(error.code)) {
      return { code: error.code, message: 'Workflow input or provider result was rejected', failureClass: 'NONRETRYABLE_DEPENDENCY', retryable: false };
    }
    return {
      code: 'HANDLER_FAILED',
      message: 'Workflow handler failed',
      failureClass: 'TERMINAL_HANDLER',
      retryable: false,
    };
  }

  private resourceMetadata(operation: WorkflowOperation, value: Record<string, unknown>) {
    const resource = value.resource;
    if (resource && typeof resource === 'object' && !Array.isArray(resource)) {
      const record = resource as Record<string, unknown>;
      if (typeof record.resourceType === 'string' && typeof record.resourceId === 'string' && typeof record.resourceHref === 'string') {
        return { type: record.resourceType, id: record.resourceId, href: record.resourceHref, schemaVersion: 1 };
      }
    }
    const execution = value.execution;
    const projectRun = execution && typeof execution === 'object' && !Array.isArray(execution)
      ? (execution as Record<string, unknown>).projectRun : undefined;
    const projectRunId = projectRun && typeof projectRun === 'object' && !Array.isArray(projectRun)
      ? (projectRun as Record<string, unknown>).id : undefined;
    if (typeof projectRunId === 'string') {
      return { type: 'PROJECT_RUN', id: projectRunId, href: `/api/project-runs/${projectRunId}`, schemaVersion: 1 };
    }
    return {
      type: `${operation.kind}_RESULT`,
      id: operation.id,
      href: `/api/v1/operations/${operation.id}`,
      schemaVersion: 1,
    };
  }
}
