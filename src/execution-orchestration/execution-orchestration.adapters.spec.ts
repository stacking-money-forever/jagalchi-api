import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProjectRunsExecutionAdapter } from './execution-orchestration.adapters';
import { ProjectFeatureEntitlement, ProjectRepositoryBinding, ProjectTask } from '../project-runs/product-spine.entities';
import { ProjectRun } from '../project-runs/project-run.entity';

const command = { ownerId: 'owner-1', proposalId: 'proposal-1', catalogVersion: 'v1', targetId: 'target-1', competencySlugs: [], projection: {}, operationId: '00000000-0000-4000-8000-000000000099' };

describe('ProjectRunsExecutionAdapter gates', () => {
  it('returns 503 without touching persistence when the global gate is closed', async () => {
    const adapter = new ProjectRunsExecutionAdapter({ get: () => 'false' } as never);
    const manager = { getRepository: vi.fn() };
    await expect(adapter.create(manager as never, command as never)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(manager.getRepository).not.toHaveBeenCalled();
  });

  it('returns 404 when the owner lacks an explicit entitlement', async () => {
    const adapter = new ProjectRunsExecutionAdapter({ get: () => 'true' } as never);
    const manager = { getRepository: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) };
    await expect(adapter.create(manager as never, command as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('atomically creates normalized tasks and an immutable repository binding with the run', async () => {
    const runRepository = { findOne: vi.fn().mockResolvedValue(null), create: vi.fn((value) => ({ id: '00000000-0000-4000-8000-000000000001', ...value })), save: vi.fn(async (value) => value) };
    const taskRepository = { create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const bindingRepository = { create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const manager = { getRepository: vi.fn((entity) => entity === ProjectFeatureEntitlement ? { findOne: vi.fn().mockResolvedValue({ enabled: true }) } : entity === ProjectRun ? runRepository : entity === ProjectTask ? taskRepository : entity === ProjectRepositoryBinding ? bindingRepository : null) };
    const adapter = new ProjectRunsExecutionAdapter({ get: () => 'true' } as never);
    await adapter.create(manager as never, {
      ...command,
      competencySlugs: ['typescript'],
      projection: { currentTaskId: null, recommendedTaskId: 'task-1', plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [{ id: 'task-1', title: 'Ship', milestoneId: 'm-1', state: 'READY' }], edges: [] }, tasks: [{ id: 'task-1', title: 'Ship', state: 'READY', required: true, milestoneId: 'm-1', prerequisiteIds: [], purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRequirements: ['PR'] }], proof: null },
      repository: { mode: 'MANUAL_GREENFIELD' as never },
    });
    expect(taskRepository.save).toHaveBeenCalledWith([expect.objectContaining({ taskKey: 'task-1', state: 'READY' })]);
    expect(bindingRepository.save).toHaveBeenCalledWith(expect.objectContaining({ mode: 'MANUAL_GREENFIELD', installationId: null }));
  });
});
