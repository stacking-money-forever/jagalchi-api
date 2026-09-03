import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProjectRunState } from './project-run.entity';
import { ProjectRunsService } from './project-runs.service';
import { WorkflowOperation, WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { ProjectRun } from './project-run.entity';
import { ProjectFeatureEntitlement, ProjectRunCommand, ProjectTask, ProofPublication, ProofPublicationStatus, ProofSnapshot, ProofValidity } from './product-spine.entities';
import { ProofProfile, ProofProfileState } from '../career/career.entities';

const key = '00000000-0000-4000-8000-000000000099';
function transitionSubject(taskOverrides: Record<string, unknown> = {}, runOverrides: Record<string, unknown> = {}) {
  const runId = '00000000-0000-4000-8000-000000000001';
  const baseTask = { id: 'task-row-1', projectRunId: runId, taskKey: 'task-1', title: 'Ship', state: 'READY', required: true, milestoneId: 'm-1', prerequisiteIds: [], purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRequirements: ['PR'], blockedFrom: null, blockReasonCode: null, blockNote: null, version: 1, startedAt: null, createdAt: new Date() };
  const task = { ...baseTask, ...taskOverrides };
  const projection = { id: runId, state: ProjectRunState.Ready, version: 1, currentTaskId: null, recommendedTaskId: 'task-1', plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [{ id: 'task-1', title: 'Ship', milestoneId: 'm-1', state: task.state }], edges: [] }, tasks: [{ id: 'task-1', title: 'Ship', state: task.state, required: task.required, milestoneId: 'm-1', prerequisiteIds: task.prerequisiteIds, purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRequirements: ['PR'] }], proof: null };
  const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Ready, version: 1, currentTaskId: null, projection, ...runOverrides };
  let command: { inputHash: string; response: Record<string, unknown> } | null = null;
  const commands = { findOne: vi.fn(async () => command), create: vi.fn((value) => value), save: vi.fn(async (value) => { command = value; return value; }) };
  const tasks = { findOne: vi.fn().mockResolvedValue(task), find: vi.fn().mockResolvedValue([task]), save: vi.fn(async (value) => value) };
  const runs = { findOne: vi.fn().mockResolvedValue(run), save: vi.fn(async (value) => value) };
  const operations = { create: vi.fn((value) => ({ id: '00000000-0000-4000-8000-000000000077', ...value })), save: vi.fn(async (value) => value) };
  const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectTask ? tasks : entity === ProjectRunCommand ? commands : entity === WorkflowOperation ? operations : null };
  const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
  return { service: new ProjectRunsService(runs as never, dataSource as never), run, task, runs, tasks, commands, operations };
}

describe('ProjectRunsService', () => {
  it('uses a stable updatedAt/id cursor and returns a real next page token', async () => {
    const projection = (id: string) => ({ id, state: ProjectRunState.Ready, version: 1, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null });
    const rows = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'].map((id, index) => ({ id, ownerId: 'owner-1', state: ProjectRunState.Ready, version: 1, updatedAt: new Date(`2026-09-0${2 - index}T00:00:00Z`), projection: projection(id) }));
    const builder = { where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), getMany: vi.fn().mockResolvedValue(rows) };
    for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'take'] as const) builder[method].mockReturnValue(builder);
    const service = new ProjectRunsService({ createQueryBuilder: vi.fn(() => builder) } as never);
    const page = await service.list('owner-1', undefined, 1);
    expect(page.items).toHaveLength(1); expect(page.nextCursor).toEqual(expect.any(String));
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toEqual({ updatedAt: '2026-09-02T00:00:00.000Z', id: rows[0]!.id });
  });

  it('preserves owner reads independently of the new-run feature gate', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Active, version: 2, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null };
    const runs = { findOne: vi.fn().mockResolvedValue({ id: runId, ownerId: 'owner-1', state: ProjectRunState.Active, version: 2, projection }) };
    const service = new ProjectRunsService(runs as never);
    await expect(service.get('owner-1', runId)).resolves.toMatchObject({ id: runId, state: 'ACTIVE', version: 2, proof: null });
    expect(runs.findOne).toHaveBeenCalledWith({ where: { id: runId, ownerId: 'owner-1' } });
  });

  it('fails closed when persisted jsonb contains unknown projection fields', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Ready, version: 1, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null, surprise: true };
    const service = new ProjectRunsService({ findOne: vi.fn().mockResolvedValue({ id: runId, ownerId: 'owner-1', state: ProjectRunState.Ready, version: 1, projection }) } as never);
    await expect(service.get('owner-1', runId)).rejects.toThrow('closed v1 contract');
  });

  it('does not reveal a run owned by another user', async () => {
    const service = new ProjectRunsService({ findOne: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.get('owner-2', 'run-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('starts once under lock, increments the run version, and replays the original response', async () => {
    const subject = transitionSubject();
    const args = { ownerId: 'owner-1', runId: subject.run.id, taskKey: 'task-1', command: 'start' as const, expectedVersion: 1, idempotencyKey: key };
    const first = await subject.service.taskCommand(args);
    const replay = await subject.service.taskCommand(args);
    expect(first).toMatchObject({ state: 'ACTIVE', version: 2, currentTaskId: 'task-1' });
    expect(replay).toEqual(first);
    expect(subject.tasks.save).toHaveBeenCalledOnce();
    expect(subject.runs.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
  });

  it.each([
    [{ required: true }, 'defer', 'REQUIRED_TASK_CANNOT_DEFER'],
    [{ prerequisiteIds: ['missing'] }, 'start', 'DEPENDENCIES_INCOMPLETE'],
  ] as const)('rejects guarded task commands', async (overrides, command, code) => {
    const subject = transitionSubject(overrides);
    await expect(subject.service.taskCommand({ ownerId: 'owner-1', runId: subject.run.id, taskKey: 'task-1', command, expectedVersion: 1, idempotencyKey: key }))
      .rejects.toMatchObject({ response: { code } });
  });

  it('rejects stale versions and a second focus task', async () => {
    const stale = transitionSubject();
    await expect(stale.service.taskCommand({ ownerId: 'owner-1', runId: stale.run.id, taskKey: 'task-1', command: 'start', expectedVersion: 2, idempotencyKey: key }))
      .rejects.toMatchObject({ response: { code: 'STALE_VERSION' } });
    const focused = transitionSubject({}, { currentTaskId: 'task-other' });
    await expect(focused.service.taskCommand({ ownerId: 'owner-1', runId: focused.run.id, taskKey: 'task-1', command: 'start', expectedVersion: 1, idempotencyKey: key }))
      .rejects.toMatchObject({ response: { code: 'FOCUS_TASK_ACTIVE' } });
  });

  it('moves verification to VERIFYING and creates a durable operation without faking PASS', async () => {
    const subject = transitionSubject({ state: 'IN_PROGRESS' }, { state: ProjectRunState.Active, currentTaskId: 'task-1' });
    subject.run.projection.state = ProjectRunState.Active;
    subject.run.projection.currentTaskId = 'task-1';
    const result = await subject.service.taskCommand({ ownerId: 'owner-1', runId: subject.run.id, taskKey: 'task-1', command: 'verify', expectedVersion: 1, idempotencyKey: key });
    expect(result).toMatchObject({ state: 'ACTIVE', operationId: '00000000-0000-4000-8000-000000000077' });
    expect(subject.task.state).toBe('VERIFYING');
    expect(subject.operations.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'TASK_VERIFICATION', state: WorkflowOperationState.Pending }));
  });

  it('republishes the same active immutable snapshot without creating another snapshot', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Completed, version: 4, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: { summary: 'Verified', validUntil: null, publication: { state: 'UNPUBLISHED', publicId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA' }, verification: { state: 'PASS', verifiedAt: '2026-09-03T00:00:00.000Z' } } };
    const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Completed, version: 4, projection };
    const publication = { id: 'publication-1', projectRunId: runId, proofSnapshotId: 'snapshot-1', publicationStatus: ProofPublicationStatus.Unpublished, validity: ProofValidity.Active, version: 1 };
    const commands = { findOne: vi.fn().mockResolvedValue(null), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const runs = { findOne: vi.fn().mockResolvedValue(run), save: vi.fn(async (value) => value) };
    const tasks = { find: vi.fn().mockResolvedValue([]) };
    const profiles = { findOne: vi.fn().mockResolvedValue({ ownerUserId: 'owner-1', publicId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', state: ProofProfileState.Enabled }) };
    const publications = { findOne: vi.fn().mockResolvedValue(publication), save: vi.fn(async (value) => value) };
    const snapshots = { create: vi.fn(), save: vi.fn() };
    const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectTask ? tasks : entity === ProjectRunCommand ? commands : entity === ProofProfile ? profiles : entity === ProofPublication ? publications : entity === ProofSnapshot ? snapshots : null };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const invalidation = { assertSnapshotPublishable: vi.fn().mockResolvedValue({ id: 'snapshot-1' }) };
    const result = await new ProjectRunsService(runs as never, dataSource as never, undefined, invalidation as never).publish('owner-1', runId, 4, key);
    expect(result).toMatchObject({ created: false, projection: { version: 5, proof: { publication: { state: 'ACTIVE' } } } });
    expect(publication.publicationStatus).toBe(ProofPublicationStatus.Published);
    expect(snapshots.save).not.toHaveBeenCalled();
  });

  it('enqueues fixture reverification only when the latest snapshot is stale', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Completed, version: 4, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null };
    const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Completed, version: 4, projection };
    const commands = { findOne: vi.fn().mockResolvedValue(null), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const runs = { findOne: vi.fn().mockResolvedValue(run), save: vi.fn(async (value) => value) };
    const profiles = { findOne: vi.fn().mockResolvedValue({ state: ProofProfileState.Enabled }) };
    const entitlements = { exists: vi.fn().mockResolvedValue(true) };
    const snapshots = { findOne: vi.fn().mockResolvedValue({ id: 'snapshot-1' }) };
    const operations = { create: vi.fn((value) => ({ id: '00000000-0000-4000-8000-000000000077', version: 1, ...value })), save: vi.fn(async (value) => value) };
    const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectRunCommand ? commands : entity === ProofProfile ? profiles : entity === ProofSnapshot ? snapshots : entity === WorkflowOperation ? operations : entity === ProjectFeatureEntitlement ? entitlements : null };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const config = { get: vi.fn((name: string) => name === 'GITHUB_PROVIDER' ? 'fixture' : name === 'PROJECT_RUNS_ENABLED' ? 'true' : undefined) };
    const invalidation = { assertSnapshotPublishable: vi.fn().mockRejectedValue(Object.assign(new ConflictException({ code: 'VERIFICATION_STALE' }), {})) };
    const result = await new ProjectRunsService(runs as never, dataSource as never, config as never, invalidation as never).reverify('owner-1', runId, 4, key);
    expect(result).toMatchObject({ kind: 'PROOF_REVERIFICATION', state: WorkflowOperationState.Pending });
    expect(run.version).toBe(5);
  });
});
