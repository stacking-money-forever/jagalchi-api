import { describe, expect, it, vi } from 'vitest';
import { WorkflowOperationState, type WorkflowOperation } from './workflow-operation.entities';
import { WorkflowOperationHandlers, WorkflowOperationWorker } from './workflow-operation.worker';

describe('WorkflowOperationWorker', () => {
  const config = { get: (key: string) => ({
    WORKFLOW_LEASE_MS: '120000', WORKFLOW_HEARTBEAT_MS: '30000', WORKFLOW_POLL_MS: '1000', AI_TIMEOUT_MS: '65000',
  })[key] };
  it('claims only registered kinds and persists one successful result', async () => {
    const operation = { id: 'operation-1', kind: 'PROJECT_RUN', state: WorkflowOperationState.Running } as WorkflowOperation;
    const operations = {
      reapExpired: vi.fn().mockResolvedValue(0),
      recordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue(operation),
      succeed: vi.fn().mockResolvedValue(undefined),
      heartbeat: vi.fn().mockResolvedValue(true),
      finishCancellation: vi.fn().mockResolvedValue(false),
      abandon: vi.fn(), retry: vi.fn(),
      fail: vi.fn(),
    };
    const handlers = new WorkflowOperationHandlers();
    handlers.register('PROJECT_RUN', vi.fn().mockResolvedValue({ projectRunId: 'run-1' }));
    const worker = new WorkflowOperationWorker(operations as never, handlers, config as never);

    await expect(worker.runOnce('worker-1')).resolves.toBe(true);
    expect(operations.claim).toHaveBeenCalledWith('worker-1', 120_000, ['PROJECT_RUN']);
    expect(operations.succeed).toHaveBeenCalledWith(
      'operation-1', 'worker-1', { projectRunId: 'run-1' },
      { type: 'PROJECT_RUN_RESULT', id: 'operation-1', href: '/api/v1/operations/operation-1', schemaVersion: 1 },
    );
    expect(operations.fail).not.toHaveBeenCalled();
  });

  it('does not claim arbitrary operation kinds when no handlers are registered', async () => {
    const operations = {
      reapExpired: vi.fn().mockResolvedValue(0),
      recordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue(null),
    };
    const worker = new WorkflowOperationWorker(operations as never, new WorkflowOperationHandlers(), config as never);
    await expect(worker.runOnce('worker-1')).resolves.toBe(false);
    expect(operations.claim).toHaveBeenCalledWith('worker-1', 120_000, []);
  });

  it('discards a late result cleanly after the lease was reaped', async () => {
    const operation = { id: 'operation-late', kind: 'PROJECT_RUN', state: WorkflowOperationState.Running } as WorkflowOperation;
    const operations = {
      reapExpired: vi.fn().mockResolvedValue(0), claim: vi.fn().mockResolvedValue(operation),
      recordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),
      heartbeat: vi.fn().mockResolvedValue(false), finishCancellation: vi.fn().mockResolvedValue(false),
      succeed: vi.fn().mockResolvedValue(false), fail: vi.fn().mockResolvedValue(false),
      abandon: vi.fn(), retry: vi.fn(),
    };
    const handlers = new WorkflowOperationHandlers();
    handlers.register('PROJECT_RUN', vi.fn().mockResolvedValue({ ignored: true }));
    const worker = new WorkflowOperationWorker(operations as never, handlers, config as never);
    await expect(worker.runOnce('stale-worker')).resolves.toBe(true);
    expect(operations.succeed).toHaveBeenCalledOnce();
    expect(operations.fail).not.toHaveBeenCalled();
  });

  it('persists the typed AI contract failure code', async () => {
    const operation = { id: 'operation-invalid', kind: 'PROJECT_PLAN', state: WorkflowOperationState.Running } as WorkflowOperation;
    const operations = {
      reapExpired: vi.fn().mockResolvedValue(0), claim: vi.fn().mockResolvedValue(operation),
      recordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),
      heartbeat: vi.fn().mockResolvedValue(true), finishCancellation: vi.fn().mockResolvedValue(false),
      succeed: vi.fn(), fail: vi.fn().mockResolvedValue(true), abandon: vi.fn(), retry: vi.fn(),
    };
    const handlers = new WorkflowOperationHandlers();
    handlers.register('PROJECT_PLAN', vi.fn().mockRejectedValue(Object.assign(new Error('AI response violates contract at $.receipt'), { code: 'AI_CONTRACT_INVALID' })));
    await new WorkflowOperationWorker(operations as never, handlers, config as never).runOnce('worker-1');
    expect(operations.fail).toHaveBeenCalledWith(
      'operation-invalid', 'worker-1', 'AI_CONTRACT_INVALID',
      'AI response violates contract at $.receipt', 'CONTRACT_VIOLATION',
    );
    expect(operations.succeed).not.toHaveBeenCalled();
  });

  it('requeues a retryable dependency failure instead of making it terminal', async () => {
    const operation = { id: 'operation-retry', kind: 'PROJECT_PLAN', state: WorkflowOperationState.Running } as WorkflowOperation;
    const operations = {
      reapExpired: vi.fn().mockResolvedValue(0), claim: vi.fn().mockResolvedValue(operation),
      recordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn(),
      finishCancellation: vi.fn().mockResolvedValue(false), succeed: vi.fn(), fail: vi.fn(),
      retry: vi.fn().mockResolvedValue('RETRIED'), abandon: vi.fn(),
    };
    const handlers = new WorkflowOperationHandlers();
    const { RetryableWorkflowError } = await import('./workflow-runtime');
    handlers.register('PROJECT_PLAN', vi.fn().mockRejectedValue(
      new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', 'provider secret detail'),
    ));
    await new WorkflowOperationWorker(operations as never, handlers, config as never).runOnce('worker-1');
    expect(operations.retry).toHaveBeenCalledWith(
      'operation-retry', 'worker-1', 'AI_SERVICE_UNAVAILABLE',
      'A transient dependency prevented workflow completion', 'TRANSIENT_DEPENDENCY',
    );
    expect(operations.fail).not.toHaveBeenCalled();
  });

  it('abandons the active lease and aborts hold-after-claim on graceful stop', async () => {
    const operation = { id: 'operation-held', kind: 'PROJECT_PLAN', state: WorkflowOperationState.Running } as WorkflowOperation;
    const operations = {
      reapExpired: vi.fn().mockResolvedValue(0), claim: vi.fn().mockResolvedValue(operation),
      recordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn(),
      finishCancellation: vi.fn(), succeed: vi.fn(), fail: vi.fn(), retry: vi.fn(),
      abandon: vi.fn().mockResolvedValue(true),
    };
    const heldConfig = { get: (key: string) => key === 'WORKFLOW_HOLD_AFTER_CLAIM_MS' ? '60000' : config.get(key) };
    const worker = new WorkflowOperationWorker(operations as never, new WorkflowOperationHandlers(), heldConfig as never);
    worker['handlers'].register('PROJECT_PLAN', vi.fn());
    const running = worker.runOnce('worker-1');
    await vi.waitFor(() => expect(operations.claim).toHaveBeenCalled());
    await worker.stop();
    await expect(running).resolves.toBe(true);
    expect(operations.abandon).toHaveBeenCalledWith('operation-held', 'worker-1');
    expect(operations.succeed).not.toHaveBeenCalled();
  });
});
