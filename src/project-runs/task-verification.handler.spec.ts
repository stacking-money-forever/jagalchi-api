import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_VERIFICATION_IDS, FixtureVerificationProvider } from '../verification-providers';
import { WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { WorkflowOperationHandlers } from '../workflow-operations/workflow-operation.worker';
import { RetryableWorkflowError } from '../workflow-operations/workflow-runtime';
import { TaskVerificationHandler } from './task-verification.handler';

const operation = { id: 'operation-1', ownerId: 'owner-1', state: WorkflowOperationState.Running, leaseOwner: 'worker-1' } as never;
const fence = {
  run: { id: 'run-1', version: 2 }, task: { id: 'task-1', version: 1 },
  binding: { githubRepositoryId: FIXTURE_VERIFICATION_IDS.repositoryId, repositoryName: 'fixture/verification-repository', repositoryPrivate: true, pullNumber: FIXTURE_VERIFICATION_IDS.pullNumber, bindingVersion: 2, expectedHeadSha: FIXTURE_VERIFICATION_IDS.initialHeadSha },
  rules: [{ id: 'merged', type: 'MERGED_PR' as const }],
};

function setup(scenario: 'success' | 'failure' | 'drift' | 'unavailable') {
  const registry = new WorkflowOperationHandlers();
  const subject = new TaskVerificationHandler({} as never, { get: (key: string) => key === 'GITHUB_PROVIDER' ? 'fixture' : 'true' } as never, registry, new FixtureVerificationProvider(scenario));
  vi.spyOn(subject as never, 'readFence').mockResolvedValue(fence as never);
  const success = vi.spyOn(subject as never, 'commitResult').mockResolvedValue({ status: 'PASS' } as never);
  const failure = vi.spyOn(subject as never, 'commitFailure').mockResolvedValue({ status: 'FAIL' } as never);
  subject.onModuleInit();
  return { handler: registry.get('TASK_VERIFICATION')!, success, failure };
}

describe('TaskVerificationHandler fixture integration', () => {
  it('finalizes operation metadata and result through the same transaction manager', async () => {
    const registry = new WorkflowOperationHandlers();
    const subject = new TaskVerificationHandler({} as never, { get: () => 'true' } as never, registry, new FixtureVerificationProvider());
    const resultRepository = { create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const operationRepository = { save: vi.fn(async (value) => value) };
    const manager = { getRepository: vi.fn((entity: { name: string }) => entity.name === 'WorkflowOperationResult' ? resultRepository : operationRepository) };
    const current = { id: 'operation-1', state: WorkflowOperationState.Running, version: 2, leaseOwner: 'worker-1', leaseExpiresAt: new Date(Date.now() + 60_000) };
    const value = { resource: { resourceType: 'PROJECT_TASK', resourceId: '00000000-0000-4000-8000-000000000001', resourceHref: '/api/project-runs/run-1' }, status: 'PASS' };
    await subject['finalizeOperation'](manager as never, current as never, value);
    expect(resultRepository.save).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'operation-1', value }));
    expect(operationRepository.save).toHaveBeenCalledWith(expect.objectContaining({ state: WorkflowOperationState.Succeeded, version: 3, resultType: 'PROJECT_TASK' }));
  });

  it('commits a passing proof only through the fenced success path', async () => {
    const subject = setup('success'); await expect(subject.handler(operation, new AbortController().signal)).resolves.toEqual({ status: 'PASS' });
    expect(subject.success).toHaveBeenCalledWith(operation, fence, expect.objectContaining({ status: 'PASS' })); expect(subject.failure).not.toHaveBeenCalled();
  });
  it('returns failed evidence without fabricating a Proof snapshot', async () => {
    const subject = setup('failure'); subject.success.mockResolvedValue({ status: 'FAIL' } as never); await expect(subject.handler(operation, new AbortController().signal)).resolves.toEqual({ status: 'FAIL' });
    expect(subject.success).toHaveBeenCalledWith(operation, fence, expect.objectContaining({ status: 'FAIL' }));
  });
  it('detects provider drift and routes it to closed failure without a success commit', async () => {
    const subject = setup('drift'); await expect(subject.handler(operation, new AbortController().signal)).resolves.toEqual({ status: 'FAIL' });
    expect(subject.failure).toHaveBeenCalledWith(operation, fence, 'VERIFICATION_PROVIDER_DRIFTED'); expect(subject.success).not.toHaveBeenCalled();
  });
  it('keeps unavailable providers retryable and stale fences side-effect free', async () => {
    const unavailable = setup('unavailable'); await expect(unavailable.handler(operation, new AbortController().signal)).rejects.toBeInstanceOf(RetryableWorkflowError);
    const error = Object.assign(new Error('stale'), { code: 'VERIFICATION_STALE' });
    const registry = new WorkflowOperationHandlers(); const handler = new TaskVerificationHandler({} as never, { get: (key: string) => key === 'GITHUB_PROVIDER' ? 'fixture' : 'true' } as never, registry, new FixtureVerificationProvider());
    vi.spyOn(handler as never, 'readFence').mockRejectedValue(error); handler.onModuleInit();
    await expect(registry.get('TASK_VERIFICATION')!(operation, new AbortController().signal)).rejects.toBe(error);
  });
});
