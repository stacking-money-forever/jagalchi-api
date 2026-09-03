import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { WorkflowOperation, WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { ProofProfile, ProofProfileState } from '../career/career.entities';
import { ProjectRun, ProjectRunState, type ProjectRunProjection } from './project-run.entity';
import { assertProjectRunProjection } from './project-run.projection';
import { ProjectFeature, ProjectFeatureEntitlement, ProjectRunCommand, ProjectTask, ProofPublication, ProofPublicationStatus, ProofSnapshot, ProofValidity, RepositoryInvalidationWatermark, VerificationLevel } from './product-spine.entities';
import { VerificationInvalidationService } from './verification-invalidation.service';

export type TaskCommand = 'start' | 'defer' | 'block' | 'resume' | 'verify';
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value) ?? 'null';

@Injectable()
export class ProjectRunsService {
  constructor(
    @InjectRepository(ProjectRun) private readonly runs: Repository<ProjectRun>,
    private readonly dataSource?: DataSource,
    private readonly config?: ConfigService,
    private readonly invalidation?: VerificationInvalidationService,
  ) {}

  async list(ownerId: string, state?: ProjectRunState, limit = 20, cursor?: string) {
    const take = Math.max(1, Math.min(50, limit));
    const builder = this.runs.createQueryBuilder('run').where('run.owner_id = :ownerId', { ownerId });
    if (state) builder.andWhere('run.state = :state', { state });
    if (cursor) {
      let decoded: { updatedAt: string; id: string };
      try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new ConflictException({ code: 'INVALID_CURSOR', message: 'Cursor is invalid' }); }
      if (!decoded.updatedAt || !decoded.id || Number.isNaN(Date.parse(decoded.updatedAt))) throw new ConflictException({ code: 'INVALID_CURSOR', message: 'Cursor is invalid' });
      builder.andWhere('(run.updated_at, run.id) < (:updatedAt, :id)', decoded);
    }
    const rows = await builder.orderBy('run.updated_at', 'DESC').addOrderBy('run.id', 'DESC').take(take + 1).getMany();
    const hasMore = rows.length > take; const page = rows.slice(0, take);
    const last = page.at(-1);
    return { items: await Promise.all(page.map((run) => this.ownerProjection(run))), nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last.id })).toString('base64url') : null };
  }

  async get(ownerId: string, id: string): Promise<ProjectRunProjection> {
    const run = await this.runs.findOne({ where: { id, ownerId } });
    if (!run) throw new NotFoundException('Project run is not available');
    return this.ownerProjection(run);
  }

  async taskCommand(args: { ownerId: string; runId: string; taskKey: string; command: TaskCommand; expectedVersion: number; idempotencyKey: string; body?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (!this.dataSource) throw new Error('Project Run command persistence is unavailable');
    const route = `/api/project-runs/${args.runId}/tasks/${args.taskKey}/${args.command}`;
    const inputHash = createHash('sha256').update(canonical({ expectedVersion: args.expectedVersion, body: args.body ?? {} })).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand);
      const prior = await commands.findOne({ where: { ownerId: args.ownerId, route, idempotencyKey: args.idempotencyKey } });
      if (prior) { if (prior.inputHash !== inputHash) this.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with different input'); return prior.response; }
      await this.requireMutationEnabled(manager, args.ownerId);
      if (args.command === 'verify' && this.config && this.config.get<string>('GITHUB_PROVIDER') !== 'fixture') throw new ServiceUnavailableException({ code: 'VERIFICATION_PROVIDER_UNAVAILABLE', message: 'Task verification provider is unavailable' });
      const runs = manager.getRepository(ProjectRun);
      const run = await runs.findOne({ where: { id: args.runId, ownerId: args.ownerId }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new NotFoundException('Project run is not available');
      const concurrentReplay = await commands.findOne({ where: { ownerId: args.ownerId, route, idempotencyKey: args.idempotencyKey } });
      if (concurrentReplay) { if (concurrentReplay.inputHash !== inputHash) this.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with different input'); return concurrentReplay.response; }
      if (run.version !== args.expectedVersion) this.conflict('STALE_VERSION', 'Project Run version is stale');
      if (run.state === ProjectRunState.Archived) this.conflict('RUN_ARCHIVED', 'Project Run is archived');
      const tasks = manager.getRepository(ProjectTask);
      const task = await tasks.findOne({ where: { projectRunId: run.id, taskKey: args.taskKey }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException('Project task is not available');
      const all = await tasks.find({ where: { projectRunId: run.id }, order: { createdAt: 'ASC' } });
      this.apply(run, task, all, args.command, args.body ?? {});
      task.version += 1; run.version += 1; this.deriveRunState(run, all); this.project(run, all);
      await tasks.save(task); await runs.save(run);
      let operationId: string | null = null;
      if (args.command === 'verify') {
        const operations = manager.getRepository(WorkflowOperation);
        const now = new Date();
        const operation = await operations.save(operations.create({
          ownerId: args.ownerId, route, idempotencyKey: args.idempotencyKey, kind: 'TASK_VERIFICATION', inputHash,
          input: { schemaVersion: 1, projectRunId: run.id, taskKey: task.taskKey, runVersion: run.version }, inputSchemaVersion: 1, resultSchemaVersion: 1,
          state: WorkflowOperationState.Pending, availableAt: now, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
          attempts: 0, maxAttempts: 3, errorCode: null, errorMessage: null, failureClass: null, resultType: null, resultId: null, resultHref: null, completedAt: null,
        }));
        operationId = operation.id;
      }
      const response = { ...run.projection, ...(operationId ? { operationId } : {}) };
      await commands.save(commands.create({ ownerId: args.ownerId, route, idempotencyKey: args.idempotencyKey, inputHash, response }));
      return response;
    });
  }

  async archive(ownerId: string, runId: string, expectedVersion: number, idempotencyKey: string): Promise<Record<string, unknown>> {
    if (!this.dataSource) throw new Error('Project Run command persistence is unavailable');
    const route = `/api/project-runs/${runId}/archive`;
    const inputHash = createHash('sha256').update(canonical({ expectedVersion })).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand);
      const prior = await commands.findOne({ where: { ownerId, route, idempotencyKey } });
      if (prior) { if (prior.inputHash !== inputHash) this.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with different input'); return prior.response; }
      await this.requireMutationEnabled(manager, ownerId);
      const runs = manager.getRepository(ProjectRun);
      const run = await runs.findOne({ where: { id: runId, ownerId }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new NotFoundException('Project run is not available');
      const concurrentReplay = await commands.findOne({ where: { ownerId, route, idempotencyKey } });
      if (concurrentReplay) { if (concurrentReplay.inputHash !== inputHash) this.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with different input'); return concurrentReplay.response; }
      if (run.version !== expectedVersion) this.conflict('STALE_VERSION', 'Project Run version is stale');
      if (run.state === ProjectRunState.Archived) this.conflict('RUN_ARCHIVED', 'Project Run is archived');
      run.state = ProjectRunState.Archived; run.currentTaskId = null; run.version += 1;
      run.projection = { ...run.projection, state: ProjectRunState.Archived, currentTaskId: null, version: run.version };
      await runs.save(run);
      await manager.getRepository(WorkflowOperation).createQueryBuilder().update().set({
        state: () => `CASE WHEN "state" = 'PENDING' THEN 'CANCELLED'::"workflow_operations_state_enum" ELSE 'CANCEL_REQUESTED'::"workflow_operations_state_enum" END`,
      }).where(`input ->> 'projectRunId' = :runId`, { runId }).andWhere(`state IN ('PENDING','RUNNING')`).execute();
      await manager.getRepository(ProofPublication).update(
        { projectRunId: run.id }, { publicationStatus: ProofPublicationStatus.Unpublished },
      );
      const response = run.projection as unknown as Record<string, unknown>;
      await commands.save(commands.create({ ownerId, route, idempotencyKey, inputHash, response }));
      return response;
    });
  }

  async reverify(ownerId: string, runId: string, expectedVersion: number, idempotencyKey: string): Promise<Record<string, unknown>> {
    if (!this.dataSource) throw new Error('Project Run command persistence is unavailable');
    if (this.config?.get<string>('GITHUB_PROVIDER') !== 'fixture') throw new ServiceUnavailableException({ code: 'VERIFICATION_PROVIDER_UNAVAILABLE', message: 'Proof verification provider is unavailable' });
    const route = `/api/project-runs/${runId}/reverify`; const inputHash = createHash('sha256').update(canonical({ expectedVersion })).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand); const prior = await commands.findOne({ where: { ownerId, route, idempotencyKey } });
      if (prior) { if (prior.inputHash !== inputHash) this.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with different input'); return prior.response; }
      await this.requireMutationEnabled(manager, ownerId);
      await this.requireProofProfile(manager, ownerId);
      const run = await manager.getRepository(ProjectRun).findOne({ where: { id: runId, ownerId }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new NotFoundException('Project run is not available');
      if (run.version !== expectedVersion) this.conflict('STALE_VERSION', 'Project Run version is stale');
      if (run.state !== ProjectRunState.Completed) this.conflict('RUN_NOT_COMPLETED', 'Only a completed Project Run can be reverified');
      const latest = await manager.getRepository(ProofSnapshot).findOne({ where: { projectRunId: run.id }, order: { createdAt: 'DESC' } });
      if (latest) {
        try { await this.invalidation?.assertSnapshotPublishable(manager, latest.id); this.conflict('VERIFICATION_ALREADY_CURRENT', 'The current verification remains publishable'); } catch (error) { if (!(error instanceof ConflictException) || (error.getResponse() as { code?: string }).code !== 'VERIFICATION_STALE') throw error; }
      }
      run.version += 1; run.projection = { ...run.projection, version: run.version }; await manager.getRepository(ProjectRun).save(run);
      const now = new Date(); const operation = await manager.getRepository(WorkflowOperation).save(manager.getRepository(WorkflowOperation).create({ ownerId, route, idempotencyKey, kind: 'PROOF_REVERIFICATION', inputHash, input: { schemaVersion: 1, projectRunId: run.id, runVersion: run.version }, inputSchemaVersion: 1, resultSchemaVersion: 1, state: WorkflowOperationState.Pending, availableAt: now, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, attempts: 0, maxAttempts: 3, errorCode: null, errorMessage: null, failureClass: null, resultType: null, resultId: null, resultHref: null, completedAt: null }));
      const response = { id: operation.id, kind: operation.kind, state: operation.state, version: operation.version ?? 1, result: null, error: null };
      await commands.save(commands.create({ ownerId, route, idempotencyKey, inputHash, response })); return response;
    });
  }

  async publish(ownerId: string, runId: string, expectedVersion: number, idempotencyKey: string): Promise<{ created: boolean; projection: ProjectRunProjection }> {
    if (!this.dataSource || !this.invalidation) throw new Error('Proof publication persistence is unavailable');
    const invalidation = this.invalidation;
    const route = `/api/project-runs/${runId}/publish`; const inputHash = createHash('sha256').update(canonical({ expectedVersion })).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand); const prior = await commands.findOne({ where: { ownerId, route, idempotencyKey } });
      if (prior) { if (prior.inputHash !== inputHash) this.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with different input'); return prior.response as unknown as { created: boolean; projection: ProjectRunProjection }; }
      await this.requireMutationEnabled(manager, ownerId);
      const run = await manager.getRepository(ProjectRun).findOne({ where: { id: runId, ownerId }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new NotFoundException('Project run is not available');
      if (run.version !== expectedVersion) this.conflict('STALE_VERSION', 'Project Run version is stale');
      if (run.state === ProjectRunState.Archived) this.conflict('RUN_ARCHIVED', 'Archived Project Runs cannot publish');
      const tasks = await manager.getRepository(ProjectTask).find({ where: { projectRunId: run.id } });
      if (!tasks.filter((task) => task.required).every((task) => task.state === 'DONE')) this.conflict('REQUIRED_TASKS_INCOMPLETE', 'Required tasks are incomplete');
      const profile = await manager.getRepository(ProofProfile).findOne({ where: { ownerUserId: ownerId }, lock: { mode: 'pessimistic_read' } });
      if (!profile || profile.state !== ProofProfileState.Enabled) this.conflict('PROOF_PROFILE_DISABLED', 'Proof Profile must be enabled before publishing');
      const current = await manager.getRepository(ProofPublication).findOne({ where: { projectRunId: run.id, validity: Not(ProofValidity.Superseded) }, lock: { mode: 'pessimistic_write' } });
      if (current?.validity === ProofValidity.Active) {
        if (current.publicationStatus === ProofPublicationStatus.Published) {
          const result = { created: false, projection: run.projection }; await commands.save(commands.create({ ownerId, route, idempotencyKey, inputHash, response: result as unknown as Record<string, unknown> })); return result;
        }
        await invalidation.assertSnapshotPublishable(manager, current.proofSnapshotId); current.publicationStatus = ProofPublicationStatus.Published; current.version += 1; await manager.getRepository(ProofPublication).save(current);
        run.version += 1; run.projection = this.withPublication(run, profile.publicId, 'ACTIVE'); await manager.getRepository(ProjectRun).save(run);
        const result = { created: false, projection: run.projection }; await commands.save(commands.create({ ownerId, route, idempotencyKey, inputHash, response: result as unknown as Record<string, unknown> })); return result;
      }
      const source = await manager.getRepository(ProofSnapshot).findOne({ where: { projectRunId: run.id }, order: { createdAt: 'DESC' } });
      if (!source || source.payload.status !== 'PASS') this.conflict('VERIFICATION_STALE', 'A current passing verification is required');
      await invalidation.assertSnapshotPublishable(manager, source.id);
      if (current) { current.validity = ProofValidity.Superseded; await manager.getRepository(ProofPublication).save(current); }
      const evaluations = Array.isArray(source.payload.evaluations) ? source.payload.evaluations.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)) : [];
      const criteriaTypes = [...new Set(evaluations.map((value) => String(value.type)).filter((type) => ['MERGED_PR', 'BASE_BRANCH', 'CHANGED_PATH', 'NAMED_CHECK'].includes(type)))];
      const target = run.projection.target;
      const publicProjection = { schemaVersion: 1, publicProofId: randomBytes(20).toString('base64url'), title: target ? `${target.company} ${target.role}`.slice(0, 160) : 'Verified project delivery', summary: run.projection.proof?.summary ?? null, competencyLabel: 'Verified project delivery', provider: 'GITHUB', verification: { status: 'VERIFIED', verifiedAt: source.verifiedAt.toISOString() }, criteria: { passedCount: evaluations.filter((value) => value.passed === true).length, totalCount: Math.max(1, evaluations.length), types: criteriaTypes.length ? criteriaTypes : ['MERGED_PR'] } };
      const snapshot = await manager.getRepository(ProofSnapshot).save(manager.getRepository(ProofSnapshot).create({ ownerId, projectRunId: run.id, proofMissionId: source.proofMissionId, verificationLevel: VerificationLevel.MachineVerified, verifiedAt: source.verifiedAt, invalidationGeneration: source.invalidationGeneration, schemaVersion: source.schemaVersion, payload: { ...source.payload, publicProfileId: profile.publicId, publicProjection } }));
      await manager.getRepository(ProofPublication).save(manager.getRepository(ProofPublication).create({ projectRunId: run.id, proofSnapshotId: snapshot.id, publicationStatus: ProofPublicationStatus.Published, validity: ProofValidity.Active, version: 1 }));
      run.version += 1; run.projection = this.withPublication(run, profile.publicId, 'ACTIVE'); await manager.getRepository(ProjectRun).save(run);
      const result = { created: true, projection: run.projection }; await commands.save(commands.create({ ownerId, route, idempotencyKey, inputHash, response: result as unknown as Record<string, unknown> })); return result;
    });
  }

  async unpublish(ownerId: string, runId: string, expectedVersion: number, idempotencyKey: string): Promise<ProjectRunProjection> {
    if (!this.dataSource) throw new Error('Proof publication persistence is unavailable');
    const route = `/api/project-runs/${runId}/unpublish`; const inputHash = createHash('sha256').update(canonical({ expectedVersion })).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const commands = manager.getRepository(ProjectRunCommand); const prior = await commands.findOne({ where: { ownerId, route, idempotencyKey } });
      if (prior) { if (prior.inputHash !== inputHash) this.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with different input'); return prior.response as unknown as ProjectRunProjection; }
      const run = await manager.getRepository(ProjectRun).findOne({ where: { id: runId, ownerId }, lock: { mode: 'pessimistic_write' } }); if (!run) throw new NotFoundException('Project run is not available');
      if (run.version !== expectedVersion) this.conflict('STALE_VERSION', 'Project Run version is stale');
      await this.requireProofProfile(manager, ownerId);
      const current = await manager.getRepository(ProofPublication).findOne({ where: { projectRunId: run.id, validity: Not(ProofValidity.Superseded) }, lock: { mode: 'pessimistic_write' } });
      if (current) { current.publicationStatus = ProofPublicationStatus.Unpublished; current.version += 1; await manager.getRepository(ProofPublication).save(current); }
      run.version += 1; run.projection = this.withPublication(run, run.projection.proof?.publication.publicId ?? null, current?.validity === ProofValidity.Invalidated ? 'INVALIDATED' : 'UNPUBLISHED'); await manager.getRepository(ProjectRun).save(run);
      await commands.save(commands.create({ ownerId, route, idempotencyKey, inputHash, response: run.projection as unknown as Record<string, unknown> })); return run.projection;
    });
  }

  private apply(run: ProjectRun, task: ProjectTask, all: ProjectTask[], command: TaskCommand, body: Record<string, unknown>): void {
    const dependenciesComplete = task.prerequisiteIds.every((id) => all.some((candidate) => candidate.taskKey === id && candidate.state === 'DONE'));
    if ((command === 'start' || command === 'resume') && !dependenciesComplete) this.conflict('DEPENDENCIES_INCOMPLETE', 'Task dependencies are incomplete');
    if (command === 'start') { if (task.state !== 'READY') this.invalid(); this.focus(run, task); task.state = 'IN_PROGRESS'; task.startedAt ??= new Date(); run.currentTaskId = task.taskKey; }
    else if (command === 'defer') { if (task.required) this.conflict('REQUIRED_TASK_CANNOT_DEFER', 'Required task cannot be deferred'); if (task.state !== 'READY') this.invalid(); task.state = 'DEFERRED'; }
    else if (command === 'block') {
      if (!['READY', 'IN_PROGRESS'].includes(task.state) || (task.state === 'READY' && !task.required)) this.invalid();
      task.blockedFrom = task.state as 'READY' | 'IN_PROGRESS'; task.state = 'BLOCKED'; task.blockReasonCode = this.required(body.reasonCode, 80); task.blockNote = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null;
      if (run.currentTaskId === task.taskKey) run.currentTaskId = null;
    } else if (command === 'resume') {
      if (task.state === 'DEFERRED') task.state = 'READY';
      else if (task.state === 'BLOCKED' && task.blockedFrom) { if (task.blockedFrom === 'IN_PROGRESS') { this.focus(run, task); run.currentTaskId = task.taskKey; } task.state = task.blockedFrom; }
      else this.invalid();
      task.blockedFrom = null; task.blockReasonCode = null; task.blockNote = null;
    } else if (command === 'verify') { if (task.state !== 'IN_PROGRESS') this.invalid(); task.state = 'VERIFYING'; run.currentTaskId = task.taskKey; }
  }

  private deriveRunState(run: ProjectRun, tasks: ProjectTask[]): void {
    if (tasks.filter((task) => task.required).every((task) => task.state === 'DONE')) run.state = ProjectRunState.Completed;
    else if (tasks.some((task) => ['IN_PROGRESS', 'VERIFYING'].includes(task.state))) run.state = ProjectRunState.Active;
    else if (tasks.some((task) => task.state === 'READY')) run.state = tasks.some((task) => task.startedAt) ? ProjectRunState.Active : ProjectRunState.Ready;
    else if (tasks.some((task) => task.state === 'BLOCKED')) run.state = ProjectRunState.Blocked;
  }
  private project(run: ProjectRun, tasks: ProjectTask[]): void {
    const states = new Map(tasks.map((task) => [task.taskKey, task.state]));
    run.projection = { ...run.projection, state: run.state, version: run.version, currentTaskId: run.currentTaskId, recommendedTaskId: tasks.find((task) => task.state === 'READY')?.taskKey ?? null, tasks: run.projection.tasks.map((task) => ({ ...task, state: states.get(task.id) ?? task.state })), map: { ...run.projection.map, nodes: run.projection.map.nodes.map((node) => ({ ...node, state: states.get(node.id) ?? node.state })) } };
    assertProjectRunProjection(run.projection);
  }
  private focus(run: ProjectRun, task: ProjectTask): void { if (run.currentTaskId && run.currentTaskId !== task.taskKey) this.conflict('FOCUS_TASK_ACTIVE', 'Another Focus task is active'); }
  private async requireMutationEnabled(manager: { getRepository: DataSource['getRepository'] }, ownerId: string): Promise<void> {
    if (!this.config) return;
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') throw new ServiceUnavailableException({ code: 'PROJECT_RUNS_DISABLED', message: 'Project Runs are unavailable' });
    const entitled = await manager.getRepository(ProjectFeatureEntitlement).exists({ where: [
      { userId: ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
      { userId: ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
    ] });
    if (!entitled) throw new NotFoundException('Project Run entitlement not found');
  }
  private required(value: unknown, max: number): string { if (typeof value !== 'string' || !value.trim() || value.length > max) this.invalid(); return value.trim(); }
  private async requireProofProfile(manager: { getRepository: DataSource['getRepository'] }, ownerId: string): Promise<ProofProfile> {
    const profile = await manager.getRepository(ProofProfile).findOne({ where: { ownerUserId: ownerId } });
    if (!profile || profile.state !== ProofProfileState.Enabled) this.conflict('PROOF_PROFILE_DISABLED', 'Proof Profile must be enabled');
    return profile;
  }
  private invalid(): never { this.conflict('INVALID_TASK_TRANSITION', 'Task transition is not allowed'); }
  private conflict(code: string, message: string): never { throw new ConflictException({ code, message }); }
  private withPublication(run: ProjectRun, publicId: string | null, state: 'ACTIVE' | 'UNPUBLISHED' | 'INVALIDATED'): ProjectRunProjection {
    const prior = run.projection.proof; const projection: ProjectRunProjection = { ...run.projection, version: run.version, proof: { summary: prior?.summary ?? 'Machine verification for the current Project Run', validUntil: prior?.validUntil ?? null, publication: { state, publicId }, verification: prior?.verification ?? { state: 'PASS', verifiedAt: null }, ...(prior?.facts ? { facts: prior.facts } : {}) } }; assertProjectRunProjection(projection); return projection;
  }
  private validated(run: ProjectRun): ProjectRunProjection { assertProjectRunProjection(run.projection); if (run.projection.id !== run.id || run.projection.state !== run.state || run.projection.version !== run.version) throw new Error('ProjectRun projection metadata is inconsistent with its aggregate'); return run.projection; }
  private async ownerProjection(run: ProjectRun): Promise<ProjectRunProjection> {
    const legacy = this.validated(run);
    if (!this.dataSource) return legacy;
    const [tasks, snapshot, publication, profile] = await Promise.all([
      this.dataSource.getRepository(ProjectTask).find({ where: { projectRunId: run.id } }),
      this.dataSource.getRepository(ProofSnapshot).findOne({ where: { projectRunId: run.id }, order: { createdAt: 'DESC' } }),
      this.dataSource.getRepository(ProofPublication).findOne({ where: { projectRunId: run.id, validity: Not(ProofValidity.Superseded) }, order: { updatedAt: 'DESC' } }),
      this.dataSource.getRepository(ProofProfile).findOne({ where: { ownerUserId: run.ownerId } }),
    ]);
    const taskRows = new Map(tasks.map((task) => [task.taskKey, task]));
    const projectedTasks = legacy.tasks.map((task) => {
      const row = taskRows.get(task.id);
      return { ...task, verificationFailure: row?.blockReasonCode ? { code: row.blockReasonCode, note: row.blockNote } : null };
    });
    if (!snapshot) {
      const projection = { ...legacy, tasks: projectedTasks };
      assertProjectRunProjection(projection); return projection;
    }
    const payload = snapshot.payload;
    const provider: 'fixture' | 'github' | null = payload.provider === 'fixture' || payload.provider === 'github' ? payload.provider : null;
    const repositoryId = typeof payload.repositoryId === 'string' ? payload.repositoryId : null;
    const watermark = provider && repositoryId ? await this.dataSource.getRepository(RepositoryInvalidationWatermark).findOne({ where: { provider, repositoryId } }) : null;
    const stale = publication?.validity === ProofValidity.Invalidated || (watermark?.generation ?? 0) !== snapshot.invalidationGeneration;
    const evaluations = Array.isArray(payload.evaluations) ? payload.evaluations.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({ ruleId: String(item.ruleId), type: item.type as 'MERGED_PR' | 'BASE_BRANCH' | 'CHANGED_PATH' | 'NAMED_CHECK', passed: item.passed === true, code: String(item.code) })) : [];
    const facts = provider && repositoryId && Number.isInteger(payload.pullNumber) && typeof payload.headSha === 'string' && typeof payload.observedAt === 'string'
      ? { snapshotId: snapshot.id, verificationLevel: snapshot.verificationLevel, provider, repositoryId, pullNumber: Number(payload.pullNumber), headSha: payload.headSha, observedAt: payload.observedAt, evaluations }
      : undefined;
    const proof: ProjectRunProjection['proof'] = {
      summary: legacy.proof?.summary ?? 'Machine verification for the current Project Run', validUntil: legacy.proof?.validUntil ?? null,
      publication: { state: publication?.validity === ProofValidity.Invalidated ? 'INVALIDATED' : publication?.publicationStatus === ProofPublicationStatus.Published ? 'ACTIVE' : 'UNPUBLISHED', publicId: legacy.proof?.publication.publicId ?? profile?.publicId ?? null },
      verification: { state: stale ? 'STALE' : payload.status === 'FAIL' ? 'FAIL' : 'PASS', verifiedAt: snapshot.verifiedAt.toISOString() },
      ...(facts ? { facts } : {}),
    };
    const projection = { ...legacy, tasks: projectedTasks, proof };
    assertProjectRunProjection(projection); return projection;
  }
}
