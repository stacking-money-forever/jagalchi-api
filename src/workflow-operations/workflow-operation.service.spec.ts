import { describe, expect, it, vi } from 'vitest';
import { WorkflowOperation, WorkflowOperationState } from './workflow-operation.entities';
import { ProjectRunCommand } from '../project-runs/product-spine.entities';
import { WorkflowOperationService } from './workflow-operation.service';

describe('WorkflowOperationService', () => {
  it('cancels canonically with version CAS and exact idempotent replay', async () => {
    const operation = { id: 'operation-1', ownerId: 'owner-1', kind: 'JOB_TARGET_IMPORT', state: WorkflowOperationState.Pending, version: 1, completedAt: null };
    let command: { inputHash: string; response: Record<string, unknown> } | null = null;
    const operations = { findOne: vi.fn().mockResolvedValue(operation), save: vi.fn(async (value) => value) };
    const commands = { findOne: vi.fn(async () => command), create: vi.fn((value) => value), save: vi.fn(async (value) => { command = value; return value; }) };
    const manager = { getRepository: (entity: { name: string }) => entity === WorkflowOperation ? operations : entity === ProjectRunCommand ? commands : null };
    const service = new WorkflowOperationService({ transaction: (callback) => callback(manager) } as never, {} as never, {} as never);
    const args = ['operation-1', 'owner-1', 1, '00000000-0000-4000-8000-000000000099'] as const;
    const first = await service.requestCancelVersioned(...args); const replay = await service.requestCancelVersioned(...args);
    expect(first).toEqual({ id: 'operation-1', state: WorkflowOperationState.Cancelled, version: 2 }); expect(replay).toEqual(first); expect(operations.save).toHaveBeenCalledOnce();
  });

  it('replays the original operation for the same owner, route, key, kind, and input', async () => {
    const existing = {
      id: 'operation-1', ownerId: 'owner-1', route: '/runs', idempotencyKey: 'key-1',
      kind: 'PROJECT_RUN', inputHash: 'e45a8d0e6d0f282f8747d2f12f04ef76450c0f3d57dd9cbab60c3fbf6b5b7ed5',
    };
    const operations = { findOne: vi.fn().mockResolvedValue(existing) };
    const service = new WorkflowOperationService({} as never, operations as never, {} as never);
    const input = { value: true };
    const { createHash } = await import('node:crypto');
    existing.inputHash = createHash('sha256').update('{"value":true}').digest('hex');

    await expect(service.createOrReplay({
      ownerId: 'owner-1', route: '/runs', idempotencyKey: 'key-1', kind: 'PROJECT_RUN', input,
    })).resolves.toEqual({ operation: existing, replayed: true });
  });

  it('claims the oldest ready operation with PostgreSQL SKIP LOCKED and a lease', async () => {
    const operation = {
      id: 'operation-1', kind: 'PROJECT_RUN', state: WorkflowOperationState.Pending,
      attempts: 0, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
    };
    const query = {
      setLock: vi.fn(), setOnLocked: vi.fn(), where: vi.fn(), andWhere: vi.fn(),
      orderBy: vi.fn(), addOrderBy: vi.fn(), getOne: vi.fn().mockResolvedValue(operation),
    };
    for (const method of ['setLock', 'setOnLocked', 'where', 'andWhere', 'orderBy', 'addOrderBy'] as const) {
      query[method].mockReturnValue(query);
    }
    const repository = { createQueryBuilder: vi.fn(() => query), save: vi.fn(async (value) => value) };
    const manager = { getRepository: vi.fn(() => repository) };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const service = new WorkflowOperationService(dataSource as never, {} as never, {} as never);

    await expect(service.claim('worker-1', 120_000, ['PROJECT_RUN'])).resolves.toMatchObject({
      state: WorkflowOperationState.Running, leaseOwner: 'worker-1', attempts: 1,
    });
    expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(query.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(operation.leaseExpiresAt).toBeInstanceOf(Date);
    expect(operation.heartbeatAt).toBeInstanceOf(Date);
  });

  it('does not claim when the worker has no registered kinds', async () => {
    const dataSource = { transaction: vi.fn((callback) => callback({ getRepository: () => ({
      createQueryBuilder: () => ({
        setLock() { return this; }, setOnLocked() { return this; }, where() { return this; },
        andWhere() { return this; }, orderBy() { return this; }, addOrderBy() { return this; },
      }),
    }) })) };
    const service = new WorkflowOperationService(dataSource as never, {} as never, {} as never);
    await expect(service.claim('worker-1', 30_000, [])).resolves.toBeNull();
  });

  it('serializes cancellation with claim/succeed/reaper using a write lock', async () => {
    const operation = { id: 'operation-1', ownerId: 'owner-1', state: WorkflowOperationState.Running, leaseOwner: 'worker-1', leaseExpiresAt: new Date() };
    const repository = {
      findOneOrFail: vi.fn().mockResolvedValue(operation), save: vi.fn(async (value) => value),
    };
    const dataSource = { transaction: vi.fn((callback) => callback({ getRepository: () => repository })) };
    const service = new WorkflowOperationService(dataSource as never, {} as never, {} as never);
    await expect(service.requestCancel('operation-1', 'owner-1')).resolves.toMatchObject({ state: WorkflowOperationState.CancelRequested });
    expect(repository.findOneOrFail).toHaveBeenCalledWith({
      where: { id: 'operation-1', ownerId: 'owner-1' }, lock: { mode: 'pessimistic_write' },
    });
  });

  it('rejects an expired worker result before the reaper runs', async () => {
    const operation = { id: 'operation-1', state: WorkflowOperationState.Running, leaseOwner: 'worker-1', leaseExpiresAt: new Date(Date.now() - 1) };
    const resultRepository = { create: vi.fn(), save: vi.fn() };
    const operationRepository = { findOne: vi.fn().mockResolvedValue(operation), save: vi.fn() };
    const manager = { getRepository: vi.fn((entity) => entity.name === 'WorkflowOperation' ? operationRepository : resultRepository) };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const service = new WorkflowOperationService(dataSource as never, {} as never, {} as never);
    await expect(service.succeed('operation-1', 'worker-1', { value: true })).resolves.toBe(false);
    expect(resultRepository.save).not.toHaveBeenCalled();
  });

  it('safe-noops the worker outer succeed after a handler committed atomically', async () => {
    const operation = { id: 'operation-1', state: WorkflowOperationState.Succeeded, leaseOwner: null, leaseExpiresAt: null };
    const resultRepository = { create: vi.fn(), save: vi.fn() };
    const operationRepository = { findOne: vi.fn().mockResolvedValue(operation), save: vi.fn() };
    const manager = { getRepository: vi.fn((entity) => entity.name === 'WorkflowOperation' ? operationRepository : resultRepository) };
    const service = new WorkflowOperationService({ transaction: vi.fn((callback) => callback(manager)) } as never, {} as never, {} as never);
    await expect(service.succeed('operation-1', 'worker-1', { duplicate: true })).resolves.toBe(false);
    expect(resultRepository.save).not.toHaveBeenCalled();
    expect(operationRepository.save).not.toHaveBeenCalled();
  });

  it('requeues retryable work with deterministic backoff and preserves a redacted failure class', async () => {
    const now = new Date('2026-09-03T00:00:00Z');
    const operation = {
      id: 'operation-1', state: WorkflowOperationState.Running, attempts: 1, maxAttempts: 3,
      leaseOwner: 'worker-1', leaseExpiresAt: new Date(now.getTime() + 60_000),
    };
    const repository = {
      findOne: vi.fn().mockResolvedValue(operation), save: vi.fn(async (value) => value),
    };
    const dataSource = { transaction: vi.fn((callback) => callback({ getRepository: () => repository })) };
    const service = new WorkflowOperationService(
      dataSource as never, {} as never, {} as never, {} as never,
      { now: () => now } as never, { delayMs: vi.fn(() => 2_500) } as never,
    );

    await expect(service.retry(
      'operation-1', 'worker-1', 'DEPENDENCY_UNAVAILABLE', 'safe public message', 'TRANSIENT_DEPENDENCY',
    )).resolves.toBe('RETRIED');
    expect(operation).toMatchObject({
      state: WorkflowOperationState.Pending, leaseOwner: null, failureClass: 'TRANSIENT_DEPENDENCY',
      nextAttemptAt: new Date(now.getTime() + 2_500),
    });
  });

  it('fails retryable work after its maximum attempt without another claim', async () => {
    const now = new Date('2026-09-03T00:00:00Z');
    const operation = {
      id: 'operation-1', state: WorkflowOperationState.Running, attempts: 3, maxAttempts: 3,
      leaseOwner: 'worker-1', leaseExpiresAt: new Date(now.getTime() + 60_000),
    };
    const repository = {
      findOne: vi.fn().mockResolvedValue(operation), save: vi.fn(async (value) => value),
    };
    const dataSource = { transaction: vi.fn((callback) => callback({ getRepository: () => repository })) };
    const service = new WorkflowOperationService(
      dataSource as never, {} as never, {} as never, {} as never,
      { now: () => now } as never, { delayMs: vi.fn() } as never,
    );

    await expect(service.retry(
      'operation-1', 'worker-1', 'DEPENDENCY_UNAVAILABLE', 'safe public message', 'TRANSIENT_DEPENDENCY',
    )).resolves.toBe('FAILED');
    expect(operation).toMatchObject({
      state: WorkflowOperationState.Failed, failureClass: 'RETRY_EXHAUSTED', completedAt: now,
    });
  });

  it('reclaims an expired lease after restart and rejects the previous worker result', async () => {
    const now = new Date('2026-09-03T00:00:00Z');
    const operation = {
      id: 'operation-1', state: WorkflowOperationState.Running, attempts: 1, maxAttempts: 3,
      leaseOwner: 'dead-worker', leaseExpiresAt: new Date(now.getTime() - 1), heartbeatAt: new Date(now.getTime() - 10_000),
    };
    const query = {
      setLock: vi.fn(), setOnLocked: vi.fn(), where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(),
      getMany: vi.fn().mockResolvedValue([operation]),
    };
    for (const method of ['setLock', 'setOnLocked', 'where', 'andWhere', 'orderBy'] as const) query[method].mockReturnValue(query);
    const repository = {
      createQueryBuilder: vi.fn(() => query), save: vi.fn(async (value) => value),
      findOne: vi.fn().mockResolvedValue(operation),
    };
    const resultRepository = { create: vi.fn(), save: vi.fn() };
    const manager = { getRepository: vi.fn((entity) => entity.name === 'WorkflowOperation' ? repository : resultRepository) };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const service = new WorkflowOperationService(
      dataSource as never, {} as never, {} as never, {} as never,
      { now: () => now } as never, { delayMs: () => 1_000 } as never,
    );

    await expect(service.reapExpired(now)).resolves.toBe(1);
    expect(operation).toMatchObject({
      state: WorkflowOperationState.Pending, leaseOwner: null,
      nextAttemptAt: new Date(now.getTime() + 1_000),
    });
    await expect(service.succeed('operation-1', 'dead-worker', { stale: true })).resolves.toBe(false);
    expect(resultRepository.save).not.toHaveBeenCalled();
  });
});
