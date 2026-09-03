import { describe, expect, it, vi } from 'vitest';
import { ExecutionOrchestrationService } from './execution-orchestration.service';

describe('ExecutionOrchestrationService', () => {
  it('creates a run and its proof missions in one owner transaction', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const manager = { id: 'transaction-manager', getRepository: vi.fn(() => ({ update })) };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const run = { id: 'run-1', ownerId: 'owner-1', targetId: 'target-1', competencySlugs: ['ts'], created: true };
    const projectRuns = { create: vi.fn().mockResolvedValue(run) };
    const proofMissions = {
      createForProjectRun: vi.fn().mockResolvedValue(['mission-1']),
      invalidateForProviderChange: vi.fn(),
    };
    const service = new ExecutionOrchestrationService(
      dataSource as never, projectRuns, proofMissions,
    );
    await expect(service.createProjectRun({
      ownerId: 'owner-1', proposalId: 'proposal-1', catalogVersion: 'v1', targetId: 'target-1', competencySlugs: ['ts'],
      projection: { currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null },
      operationId: '00000000-0000-4000-8000-000000000099',
    })).resolves.toEqual({ projectRun: run, proofMissionIds: ['mission-1'] });
    expect(projectRuns.create).toHaveBeenCalledWith(manager, expect.objectContaining({ ownerId: 'owner-1' }));
    expect(proofMissions.createForProjectRun).toHaveBeenCalledWith(manager, run);
    expect(update).toHaveBeenCalledWith({ id: 'run-1' }, { proofMissionId: 'mission-1' });
  });

  it('joins a caller-owned transaction without opening a nested transaction', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const manager = { getRepository: vi.fn(() => ({ update })) };
    const dataSource = { transaction: vi.fn() };
    const run = { id: 'run-1', ownerId: 'owner-1', targetId: 'target-1', competencySlugs: ['ts'], created: true };
    const projectRuns = { create: vi.fn().mockResolvedValue(run) };
    const proofMissions = { createForProjectRun: vi.fn().mockResolvedValue(['mission-1']), invalidateForProviderChange: vi.fn() };
    const service = new ExecutionOrchestrationService(dataSource as never, projectRuns, proofMissions);
    await service.createProjectRunInTransaction(manager as never, {
      ownerId: 'owner-1', proposalId: 'proposal-1', catalogVersion: 'v1', targetId: 'target-1', competencySlugs: ['ts'],
      projection: { currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null },
      operationId: '00000000-0000-4000-8000-000000000099',
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(projectRuns.create).toHaveBeenCalledWith(manager, expect.anything());
  });
});
