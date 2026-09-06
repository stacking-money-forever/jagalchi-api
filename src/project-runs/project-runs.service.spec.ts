import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProjectRunState } from './project-run.entity';
import { ProjectRunsService } from './project-runs.service';
import { WorkflowOperation, WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { ProjectRun } from './project-run.entity';
import { ProjectFeatureEntitlement, ProjectRepositoryBinding, ProjectRunCommand, ProjectTask, ProofPublication, ProofPublicationStatus, ProofSnapshot, ProofValidity } from './product-spine.entities';
import { ProofProfile, ProofProfileState } from '../career/career.entities';

const key = '00000000-0000-4000-8000-000000000099';
function transitionSubject(taskOverrides: Record<string, unknown> = {}, runOverrides: Record<string, unknown> = {}, options: { sharedTaskReference?: boolean } = {}) {
  const runId = '00000000-0000-4000-8000-000000000001';
  const baseTask = { id: 'task-row-1', projectRunId: runId, taskKey: 'task-1', title: 'Ship', state: 'READY', required: true, milestoneId: 'm-1', prerequisiteIds: [], purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRequirements: ['PR'], blockedFrom: null, blockReasonCode: null, blockNote: null, version: 1, startedAt: null, createdAt: new Date() };
  const lockedTask = { ...baseTask, ...taskOverrides };
  const listedTask = options.sharedTaskReference ? lockedTask : { ...lockedTask };
  const projection = { id: runId, state: ProjectRunState.Ready, version: 1, currentTaskId: null, recommendedTaskId: 'task-1', plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [{ id: 'task-1', title: 'Ship', milestoneId: 'm-1', state: listedTask.state }], edges: [] }, tasks: [{ id: 'task-1', title: 'Ship', state: listedTask.state, required: listedTask.required, milestoneId: 'm-1', prerequisiteIds: listedTask.prerequisiteIds, purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRequirements: ['PR'] }], proof: null };
  const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Ready, version: 1, currentTaskId: null, projection, ...runOverrides };
  let command: { inputHash: string; response: Record<string, unknown> } | null = null;
  const commands = { findOne: vi.fn(async () => command), create: vi.fn((value) => value), save: vi.fn(async (value) => { command = value; return value; }) };
  const tasks = { findOne: vi.fn().mockResolvedValue(lockedTask), find: vi.fn().mockResolvedValue([listedTask]), save: vi.fn(async (value) => value) };
  const runs = { findOne: vi.fn().mockResolvedValue(run), save: vi.fn(async (value) => value) };
  const operations = { create: vi.fn((value) => ({ id: '00000000-0000-4000-8000-000000000077', ...value })), save: vi.fn(async (value) => value) };
  const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectTask ? tasks : entity === ProjectRunCommand ? commands : entity === WorkflowOperation ? operations : null };
  const dataSource = { transaction: vi.fn((callback) => callback(manager)), getRepository: manager.getRepository };
  return { service: new ProjectRunsService(runs as never, dataSource as never), run, task: lockedTask, listedTask, runs, tasks, commands, operations, dataSource };
}

describe('ProjectRunsService', () => {
  it('uses a stable updatedAt/id cursor and returns a real next page token', async () => {
    const projection = (id: string) => ({ id, state: ProjectRunState.Ready, version: 1, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null });
    const rows = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'].map((id, index) => ({ id, ownerId: 'owner-1', state: ProjectRunState.Ready, version: 1, updatedAt: new Date(`2026-09-0${2 - index}T00:00:00Z`), projection: projection(id) }));
    const builder = { where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), getMany: vi.fn().mockResolvedValue(rows) };
    for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'take'] as const) builder[method].mockReturnValue(builder);
    const service = new ProjectRunsService({ createQueryBuilder: vi.fn(() => builder) } as never);
    const page = await service.list('owner-1', undefined, 1);
    expect(builder.where).toHaveBeenCalledWith('run.owner_id = :ownerId', {
      ownerId: 'owner-1',
    });
    expect(builder.take).toHaveBeenCalledWith(2);
    expect(page.items).toHaveLength(1); expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.items[0]?.updatedAt).toBe('2026-09-02T00:00:00.000Z');
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
    expect((first.tasks as Array<{ id: string; state: string }>).find((task) => task.id === 'task-1')?.state).toBe('IN_PROGRESS');
    expect((first.map as { nodes: Array<{ id: string; state: string }> }).nodes.find((node) => node.id === 'task-1')?.state).toBe('IN_PROGRESS');
    expect(replay).toEqual(first);
    expect(subject.tasks.save).toHaveBeenCalledOnce();
    expect(subject.runs.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
  });

  it('persists synced projection so get returns IN_PROGRESS after start', async () => {
    const subject = transitionSubject();
    await subject.service.taskCommand({ ownerId: 'owner-1', runId: subject.run.id, taskKey: 'task-1', command: 'start', expectedVersion: 1, idempotencyKey: key });
    const savedRun = subject.runs.save.mock.calls[0]![0] as typeof subject.run;
    expect(savedRun.projection.tasks.find((task) => task.id === 'task-1')?.state).toBe('IN_PROGRESS');
    expect(savedRun.projection.state).toBe(ProjectRunState.Active);
    const queryBuilder = { where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), getOne: vi.fn().mockResolvedValue(null) };
    for (const method of ['where', 'andWhere', 'orderBy'] as const) queryBuilder[method].mockReturnValue(queryBuilder);
    const readRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), createQueryBuilder: vi.fn(() => queryBuilder) };
    subject.dataSource.getRepository = vi.fn(() => readRepo);
    subject.runs.findOne.mockResolvedValue(savedRun);
    const projection = await subject.service.get('owner-1', subject.run.id);
    expect(projection.tasks.find((task) => task.id === 'task-1')?.state).toBe('IN_PROGRESS');
    expect(projection.state).toBe(ProjectRunState.Active);
  });

  it.each([
    ['start', {}, 'IN_PROGRESS', ProjectRunState.Active, { currentTaskId: 'task-1', eligibleReadyTaskIds: [] }],
    ['defer', { required: false }, 'DEFERRED', ProjectRunState.Completed, { recommendedTaskId: null, eligibleReadyTaskIds: [] }],
    ['block', {}, 'BLOCKED', ProjectRunState.Blocked, { currentTaskId: null, eligibleReadyTaskIds: [] }],
    ['resume', { state: 'DEFERRED', required: false }, 'READY', ProjectRunState.Completed, { recommendedTaskId: 'task-1', eligibleReadyTaskIds: ['task-1'] }],
    ['verify', { state: 'IN_PROGRESS' }, 'VERIFYING', ProjectRunState.Active, { currentTaskId: 'task-1', eligibleReadyTaskIds: [] }],
  ] as const)('projects %s from distinct locked/list rows', async (command, taskOverrides, expectedTaskState, expectedRunState, responseShape) => {
    const subject = transitionSubject(taskOverrides, command === 'verify' ? { state: ProjectRunState.Active, currentTaskId: 'task-1' } : {});
    if (command === 'verify') {
      subject.run.projection.state = ProjectRunState.Active;
      subject.run.projection.currentTaskId = 'task-1';
    }
    const body = command === 'block' ? { reasonCode: 'WAITING_ON_DEPENDENCY', note: 'blocked for test' } : undefined;
    const result = await subject.service.taskCommand({
      ownerId: 'owner-1',
      runId: subject.run.id,
      taskKey: 'task-1',
      command,
      expectedVersion: 1,
      idempotencyKey: key,
      ...(body ? { body } : {}),
    });
    expect(subject.listedTask.state).toBe(expectedTaskState);
    expect(result).toMatchObject({ state: expectedRunState, version: 2, ...responseShape });
    expect((result.tasks as Array<{ id: string; state: string }>).find((task) => task.id === 'task-1')?.state).toBe(expectedTaskState);
    expect((result.map as { nodes: Array<{ id: string; state: string }> }).nodes.find((node) => node.id === 'task-1')?.state).toBe(expectedTaskState);
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
      .rejects.toMatchObject({ response: { code: 'STALE_VERSION', details: { currentVersion: 1 } } });
    const focused = transitionSubject({}, { currentTaskId: 'task-other' });
    await expect(focused.service.taskCommand({ ownerId: 'owner-1', runId: focused.run.id, taskKey: 'task-1', command: 'start', expectedVersion: 1, idempotencyKey: key }))
      .rejects.toMatchObject({ response: { code: 'FOCUS_TASK_ACTIVE', details: { currentTaskId: 'task-other' } } });
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

  it('advances fixture invalidation before enqueuing reverification', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Completed, version: 4, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: { summary: 'Verified', validUntil: null, publication: { state: 'ACTIVE', publicId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA' }, verification: { state: 'PASS', verifiedAt: '2026-09-03T00:00:00.000Z' }, facts: { snapshotId: 'snapshot-1', verificationLevel: 'MACHINE_VERIFIED', headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } } };
    const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Completed, version: 4, projection };
    const commands = { findOne: vi.fn().mockResolvedValue(null), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const runs = { findOne: vi.fn().mockResolvedValue(run), save: vi.fn(async (value) => value) };
    const profiles = { findOne: vi.fn().mockResolvedValue({ state: ProofProfileState.Enabled }) };
    const entitlements = { exists: vi.fn().mockResolvedValue(true) };
    const snapshots = { findOne: vi.fn().mockResolvedValue({ id: 'snapshot-1', payload: { status: 'PASS' } }) };
    const tasks = { exists: vi.fn().mockResolvedValue(false) };
    const qb = { where: vi.fn(), andWhere: vi.fn(), getExists: vi.fn().mockResolvedValue(false) };
    for (const method of ['where', 'andWhere'] as const) qb[method].mockReturnValue(qb);
    const order: string[] = [];
    const operations = { create: vi.fn((value) => value), save: vi.fn(async (value) => { order.push('operation'); return value; }), createQueryBuilder: vi.fn(() => qb) };
    const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectRunCommand ? commands : entity === ProofProfile ? profiles : entity === ProofSnapshot ? snapshots : entity === WorkflowOperation ? operations : entity === ProjectFeatureEntitlement ? entitlements : entity === ProjectTask ? tasks : null };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const config = { get: vi.fn((name: string) => name === 'GITHUB_PROVIDER' ? 'fixture' : name === 'PROJECT_RUNS_ENABLED' ? 'true' : undefined) };
    const invalidation = {
      advanceFixtureAndInvalidate: vi.fn(async () => { order.push('invalidate'); return 2; }),
      assertSnapshotPublishable: vi.fn().mockResolvedValue({ id: 'snapshot-1' }),
    };
    const result = await new ProjectRunsService(runs as never, dataSource as never, config as never, invalidation as never).reverify('owner-1', runId, 4, key);
    expect(result).toMatchObject({ kind: 'PROOF_REVERIFICATION', state: WorkflowOperationState.Pending });
    expect(run.version).toBe(5);
    expect(invalidation.advanceFixtureAndInvalidate).toHaveBeenCalledOnce();
    expect(order).toEqual(['invalidate', 'operation']);
    expect(invalidation.assertSnapshotPublishable).not.toHaveBeenCalled();
  });

  it('rejects reverification while proof reverification is already in flight', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Completed, version: 4, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null };
    const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Completed, version: 4, projection };
    const commands = { findOne: vi.fn().mockResolvedValue(null) };
    const runs = { findOne: vi.fn().mockResolvedValue(run) };
    const profiles = { findOne: vi.fn().mockResolvedValue({ state: ProofProfileState.Enabled }) };
    const entitlements = { exists: vi.fn().mockResolvedValue(true) };
    const snapshots = { findOne: vi.fn().mockResolvedValue({ id: 'snapshot-1', payload: { status: 'PASS' } }) };
    const tasks = { exists: vi.fn().mockResolvedValue(false) };
    const qb = { where: vi.fn(), andWhere: vi.fn(), getExists: vi.fn().mockResolvedValue(true) };
    for (const method of ['where', 'andWhere'] as const) qb[method].mockReturnValue(qb);
    const operations = { createQueryBuilder: vi.fn(() => qb) };
    const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectRunCommand ? commands : entity === ProofProfile ? profiles : entity === ProofSnapshot ? snapshots : entity === WorkflowOperation ? operations : entity === ProjectFeatureEntitlement ? entitlements : entity === ProjectTask ? tasks : null };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const config = { get: vi.fn((name: string) => name === 'GITHUB_PROVIDER' ? 'fixture' : name === 'PROJECT_RUNS_ENABLED' ? 'true' : undefined) };
    await expect(new ProjectRunsService(runs as never, dataSource as never, config as never).reverify('owner-1', runId, 4, key))
      .rejects.toMatchObject({ response: { code: 'VERIFICATION_IN_PROGRESS' } });
  });

  it('schedules reverification after publish when the published snapshot is still current', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Completed, version: 5, currentTaskId: null, recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: { summary: 'Verified', validUntil: null, publication: { state: 'ACTIVE', publicId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA' }, verification: { state: 'PASS', verifiedAt: '2026-09-03T00:00:00.000Z' } } };
    const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Completed, version: 5, projection };
    const commands = { findOne: vi.fn().mockResolvedValue(null), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const runs = { findOne: vi.fn().mockResolvedValue(run), save: vi.fn(async (value) => value) };
    const profiles = { findOne: vi.fn().mockResolvedValue({ ownerUserId: 'owner-1', publicId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', state: ProofProfileState.Enabled }) };
    const entitlements = { exists: vi.fn().mockResolvedValue(true) };
    const snapshots = { findOne: vi.fn().mockResolvedValue({ id: 'snapshot-1', payload: { status: 'PASS' } }) };
    const tasks = { exists: vi.fn().mockResolvedValue(false) };
    const qb = { where: vi.fn(), andWhere: vi.fn(), getExists: vi.fn().mockResolvedValue(false) };
    for (const method of ['where', 'andWhere'] as const) qb[method].mockReturnValue(qb);
    const operations = { create: vi.fn((value) => ({ id: '00000000-0000-4000-8000-000000000088', version: 1, ...value })), save: vi.fn(async (value) => value), createQueryBuilder: vi.fn(() => qb) };
    const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectRunCommand ? commands : entity === ProofProfile ? profiles : entity === ProofSnapshot ? snapshots : entity === WorkflowOperation ? operations : entity === ProjectFeatureEntitlement ? entitlements : entity === ProjectTask ? tasks : null };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const config = { get: vi.fn((name: string) => name === 'GITHUB_PROVIDER' ? 'fixture' : name === 'PROJECT_RUNS_ENABLED' ? 'true' : undefined) };
    const invalidation = { advanceFixtureAndInvalidate: vi.fn().mockResolvedValue(0), assertSnapshotPublishable: vi.fn().mockResolvedValue({ id: 'snapshot-1' }) };
    const service = new ProjectRunsService(runs as never, dataSource as never, config as never, invalidation as never);
    const result = await service.reverify('owner-1', runId, 5, key);
    expect(result).toMatchObject({ kind: 'PROOF_REVERIFICATION', state: WorkflowOperationState.Pending });
    expect(run.version).toBe(6);
    expect(invalidation.advanceFixtureAndInvalidate).toHaveBeenCalledOnce();
  });

  it('enqueues pull request binding before the first task verification attempt', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Ready, version: 1, currentTaskId: null, recommendedTaskId: 'task-1', plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null };
    const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Ready, version: 1, projection };
    const binding = { projectRunId: runId, githubRepositoryId: '9000001', bindingVersion: 1, pullNumber: null, expectedHeadSha: null };
    const commands = { findOne: vi.fn().mockResolvedValue(null), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const runs = { findOne: vi.fn().mockResolvedValue(run), save: vi.fn(async (value) => value) };
    const bindings = { findOne: vi.fn().mockResolvedValue(binding) };
    const entitlements = { exists: vi.fn().mockResolvedValue(true) };
    const operations = { create: vi.fn((value) => ({ id: '00000000-0000-4000-8000-000000000088', version: 1, ...value })), save: vi.fn(async (value) => value) };
    const tasks = { exists: vi.fn().mockResolvedValue(false) };
    const qb = { where: vi.fn(), andWhere: vi.fn(), getExists: vi.fn().mockResolvedValue(false) };
    for (const method of ['where', 'andWhere'] as const) qb[method].mockReturnValue(qb);
    const workflowOps = { createQueryBuilder: vi.fn(() => qb) };
    const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectRunCommand ? commands : entity === ProjectRepositoryBinding ? bindings : entity === ProjectFeatureEntitlement ? entitlements : entity === WorkflowOperation ? { ...operations, createQueryBuilder: workflowOps.createQueryBuilder } : entity === ProjectTask ? tasks : null };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const config = { get: vi.fn((name: string) => name === 'GITHUB_PROVIDER' ? 'fixture' : name === 'PROJECT_RUNS_ENABLED' ? 'true' : undefined) };
    const result = await new ProjectRunsService(runs as never, dataSource as never, config as never).bindPullRequest('owner-1', runId, 1, key, { githubRepositoryId: '9000001', pullNumber: 17 });
    expect(result).toMatchObject({ kind: 'PULL_REQUEST_BINDING', state: WorkflowOperationState.Pending });
    expect(run.version).toBe(2);
  });

  it('rejects pull request binding after a task verification attempt exists', async () => {
    const runId = '00000000-0000-4000-8000-000000000001';
    const projection = { id: runId, state: ProjectRunState.Active, version: 2, currentTaskId: 'task-1', recommendedTaskId: null, plan: { id: 'plan-1', schemaVersion: 1 }, map: { nodes: [], edges: [] }, tasks: [], proof: null };
    const run = { id: runId, ownerId: 'owner-1', state: ProjectRunState.Active, version: 2, projection };
    const binding = { projectRunId: runId, githubRepositoryId: '9000001', bindingVersion: 1 };
    const commands = { findOne: vi.fn().mockResolvedValue(null) };
    const runs = { findOne: vi.fn().mockResolvedValue(run) };
    const bindings = { findOne: vi.fn().mockResolvedValue(binding) };
    const entitlements = { exists: vi.fn().mockResolvedValue(true) };
    const tasks = { exists: vi.fn().mockResolvedValue(false) };
    const qb = { where: vi.fn(), andWhere: vi.fn(), getExists: vi.fn().mockResolvedValue(true) };
    for (const method of ['where', 'andWhere'] as const) qb[method].mockReturnValue(qb);
    const workflowOps = { createQueryBuilder: vi.fn(() => qb) };
    const manager = { getRepository: (entity: { name: string }) => entity === ProjectRun ? runs : entity === ProjectRunCommand ? commands : entity === ProjectRepositoryBinding ? bindings : entity === ProjectFeatureEntitlement ? entitlements : entity === WorkflowOperation ? { createQueryBuilder: workflowOps.createQueryBuilder } : entity === ProjectTask ? tasks : null };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const config = { get: vi.fn((name: string) => name === 'GITHUB_PROVIDER' ? 'fixture' : name === 'PROJECT_RUNS_ENABLED' ? 'true' : undefined) };
    await expect(new ProjectRunsService(runs as never, dataSource as never, config as never).bindPullRequest('owner-1', runId, 2, key, { githubRepositoryId: '9000001', pullNumber: 17 }))
      .rejects.toMatchObject({ response: { code: 'PULL_REQUEST_BINDING_LOCKED' } });
  });
  it('includes the immutable repository ID before a pull request is bound', () => {
    const service = new ProjectRunsService({} as never);
    const privateService = service as unknown as { repositoryBindingView: (binding: { githubRepositoryId: string; repositoryName: string | null; pullNumber: number | null; expectedHeadSha: string | null }) => unknown };
    const view = privateService.repositoryBindingView({
      githubRepositoryId: '9000001',
      repositoryName: null,
      pullNumber: null,
      expectedHeadSha: null,
    });
    expect(view).toEqual({ githubRepositoryId: '9000001', repositoryName: null, pullNumber: null, headSha: null, pullUrl: null });
  });

});
