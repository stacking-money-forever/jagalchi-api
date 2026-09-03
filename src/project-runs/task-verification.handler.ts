import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, IsNull, MoreThan } from 'typeorm';
import { FIXTURE_VERIFICATION_IDS, FixtureVerificationProvider, type MachineProofResult, type TaskEvidenceRule, VerificationProviderError } from '../verification-providers';
import { WorkflowOperation, WorkflowOperationResult, WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { WorkflowOperationHandlers } from '../workflow-operations/workflow-operation.worker';
import { RetryableWorkflowError } from '../workflow-operations/workflow-runtime';
import { ProjectRun, ProjectRunState } from './project-run.entity';
import { ProjectFeature, ProjectFeatureEntitlement, ProjectRepositoryBinding, ProjectTask, ProofSnapshot, RepositoryInvalidationWatermark, VerificationLevel } from './product-spine.entities';

export const VERIFICATION_PROVIDER = Symbol('VERIFICATION_PROVIDER');

@Injectable()
export class TaskVerificationHandler implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly handlers: WorkflowOperationHandlers,
    @Inject(VERIFICATION_PROVIDER) private readonly provider: FixtureVerificationProvider,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') === 'true' && this.config.get<string>('GITHUB_PROVIDER') === 'fixture') {
      this.handlers.register('TASK_VERIFICATION', (operation) => this.execute(operation));
      this.handlers.register('PROOF_REVERIFICATION', (operation) => this.executeReverification(operation));
    }
  }

  private async executeReverification(operation: WorkflowOperation) {
    const fence = await this.dataSource.transaction(async (manager) => {
      const current = await manager.getRepository(WorkflowOperation).findOne({ where: { id: operation.id }, lock: { mode: 'pessimistic_read' } }); this.assertLease(current, operation.leaseOwner);
      const run = await manager.getRepository(ProjectRun).findOne({ where: { id: String(operation.input.projectRunId), ownerId: operation.ownerId }, lock: { mode: 'pessimistic_read' } });
      const binding = run ? await manager.getRepository(ProjectRepositoryBinding).findOne({ where: { projectRunId: run.id }, lock: { mode: 'pessimistic_read' } }) : null;
      if (!run || run.state !== ProjectRunState.Completed || run.version !== operation.input.runVersion || !binding?.installationId || !binding.githubRepositoryId || !binding.pullNumber || !binding.expectedHeadSha) throw Object.assign(new Error('Reverification fence is stale'), { code: 'VERIFICATION_STALE' });
      const tasks = await manager.getRepository(ProjectTask).find({ where: { projectRunId: run.id }, order: { createdAt: 'ASC' } });
      return { run, binding, rules: tasks.flatMap((task) => this.rules(task.evidenceRequirements).map((rule) => ({ ...rule, id: `${task.taskKey}:${rule.id}` }))) };
    });
    let proof: MachineProofResult;
    try {
      const repository = await this.provider.resolveRepositoryBinding({ ownerId: FIXTURE_VERIFICATION_IDS.ownerId, installationId: FIXTURE_VERIFICATION_IDS.installationId, repositoryId: fence.binding.githubRepositoryId! });
      if (repository.fullName !== fence.binding.repositoryName || repository.private !== fence.binding.repositoryPrivate) throw new VerificationProviderError('VERIFICATION_PROVIDER_DRIFTED');
      const facts = await this.provider.getPullRequestFacts({ repositoryId: fence.binding.githubRepositoryId!, pullNumber: fence.binding.pullNumber! });
      proof = this.provider.evaluate(facts, fence.rules, { bindingVersion: fence.binding.bindingVersion, criteriaVersion: fence.run.version, expectedHeadSha: fence.binding.expectedHeadSha! });
      const latest = await this.provider.getPullRequestFacts({ repositoryId: fence.binding.githubRepositoryId!, pullNumber: fence.binding.pullNumber! });
      if (latest.headSha !== proof.headSha || latest.factsDigest !== facts.factsDigest) throw new VerificationProviderError('VERIFICATION_PROVIDER_DRIFTED');
      if (proof.status !== 'PASS') throw Object.assign(new Error('Machine proof criteria failed'), { code: 'VERIFICATION_FAILED' });
    } catch (error) {
      if (error instanceof VerificationProviderError && error.code === 'VERIFICATION_PROVIDER_UNAVAILABLE') throw new RetryableWorkflowError(error.code, error.message);
      throw error;
    }
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.getRepository(WorkflowOperation).findOne({ where: { id: operation.id }, lock: { mode: 'pessimistic_write' } }); this.assertLease(current, operation.leaseOwner);
      const run = await manager.getRepository(ProjectRun).findOneOrFail({ where: { id: fence.run.id, ownerId: operation.ownerId }, lock: { mode: 'pessimistic_write' } });
      const binding = await manager.getRepository(ProjectRepositoryBinding).findOneOrFail({ where: { projectRunId: run.id }, lock: { mode: 'pessimistic_read' } });
      if (run.state !== ProjectRunState.Completed || run.version !== fence.run.version || binding.bindingVersion !== fence.binding.bindingVersion || binding.expectedHeadSha !== fence.binding.expectedHeadSha) throw Object.assign(new Error('Reverification fence is stale'), { code: 'VERIFICATION_STALE' });
      if (!run.proofMissionId) throw Object.assign(new Error('Proof mission is missing'), { code: 'VERIFICATION_STALE' });
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${proof.provider}:${proof.repositoryId}`]);
      const watermark = await manager.getRepository(RepositoryInvalidationWatermark).findOne({ where: { provider: proof.provider, repositoryId: proof.repositoryId }, lock: { mode: 'pessimistic_read' } });
      const snapshot = await manager.getRepository(ProofSnapshot).save(manager.getRepository(ProofSnapshot).create({ ownerId: operation.ownerId, projectRunId: run.id, proofMissionId: run.proofMissionId, verificationLevel: VerificationLevel.MachineVerified, verifiedAt: new Date(proof.observedAt), invalidationGeneration: watermark?.generation ?? 0, schemaVersion: 1, payload: { ...proof } }));
      const result = { resource: { resourceType: 'PROJECT_RUN', resourceId: run.id, resourceHref: `/api/project-runs/${run.id}` }, proofSnapshotId: snapshot.id, status: 'PASS' };
      await this.finalizeOperation(manager, current, result); return result;
    });
  }

  private async execute(operation: WorkflowOperation) {
    const fence = await this.readFence(operation);
    let proof: MachineProofResult;
    try {
      const repositoryFacts = await this.provider.resolveRepositoryBinding({ ownerId: FIXTURE_VERIFICATION_IDS.ownerId, installationId: FIXTURE_VERIFICATION_IDS.installationId, repositoryId: fence.binding.githubRepositoryId! });
      if (repositoryFacts.fullName !== fence.binding.repositoryName || repositoryFacts.private !== fence.binding.repositoryPrivate) throw new VerificationProviderError('VERIFICATION_PROVIDER_DRIFTED');
      const facts = await this.provider.getPullRequestFacts({ repositoryId: fence.binding.githubRepositoryId!, pullNumber: fence.binding.pullNumber! });
      proof = this.provider.evaluate(facts, fence.rules, { bindingVersion: fence.binding.bindingVersion, criteriaVersion: fence.task.version, expectedHeadSha: fence.binding.expectedHeadSha! });
      if (this.provider.scenario === 'drift') this.provider.advanceDrift();
      const latest = await this.provider.getPullRequestFacts({ repositoryId: fence.binding.githubRepositoryId!, pullNumber: fence.binding.pullNumber! });
      if (latest.headSha !== proof.headSha || latest.factsDigest !== facts.factsDigest) throw new VerificationProviderError('VERIFICATION_PROVIDER_DRIFTED');
    } catch (error) {
      if (error instanceof VerificationProviderError && error.code === 'VERIFICATION_PROVIDER_UNAVAILABLE') throw new RetryableWorkflowError(error.code, error.message);
      if (error instanceof VerificationProviderError) return this.commitFailure(operation, fence, error.code);
      throw error;
    }
    return this.commitResult(operation, fence, proof);
  }

  private readFence(operation: WorkflowOperation) {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.getRepository(WorkflowOperation).findOne({ where: { id: operation.id }, lock: { mode: 'pessimistic_read' } });
      this.assertLease(current, operation.leaseOwner);
      if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') throw Object.assign(new Error('Project Runs disabled'), { code: 'VERIFICATION_STALE' });
      const entitled = await manager.getRepository(ProjectFeatureEntitlement).exists({ where: [
        { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
        { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
      ] });
      if (!entitled) throw Object.assign(new Error('Entitlement expired'), { code: 'VERIFICATION_STALE' });
      const run = await manager.getRepository(ProjectRun).findOne({ where: { id: String(operation.input.projectRunId), ownerId: operation.ownerId }, lock: { mode: 'pessimistic_read' } });
      const task = run ? await manager.getRepository(ProjectTask).findOne({ where: { projectRunId: run.id, taskKey: String(operation.input.taskKey) }, lock: { mode: 'pessimistic_read' } }) : null;
      const binding = run ? await manager.getRepository(ProjectRepositoryBinding).findOne({ where: { projectRunId: run.id }, lock: { mode: 'pessimistic_read' } }) : null;
      if (!run || run.state === ProjectRunState.Archived || run.version !== operation.input.runVersion || !task || task.state !== 'VERIFYING' || !binding?.installationId || !binding.githubRepositoryId || !binding.pullNumber || !binding.expectedHeadSha) throw Object.assign(new Error('Verification fence is stale'), { code: 'VERIFICATION_STALE' });
      return { run, task, binding, rules: this.rules(task.evidenceRequirements) };
    });
  }

  private commitResult(operation: WorkflowOperation, fence: Awaited<ReturnType<TaskVerificationHandler['readFence']>>, proof: MachineProofResult) {
    return this.dataSource.transaction(async (manager) => {
      const { operation: current, run, task, binding, tasks } = await this.lockCommitFence(manager, operation, fence);
      if (proof.headSha !== binding.expectedHeadSha) throw Object.assign(new Error('Verification head changed'), { code: 'VERIFICATION_STALE' });
      if (proof.status !== 'PASS') return this.applyFailure(manager, current, run, task, tasks, 'VERIFICATION_FAILED');
      task.state = 'DONE'; task.blockReasonCode = null; task.blockNote = null; task.version += 1; run.currentTaskId = null;
      await manager.getRepository(ProjectTask).save(task);
      Object.assign(tasks.find((item) => item.id === task.id) ?? {}, task);
      for (const candidate of tasks) if (candidate.state === 'LOCKED' && candidate.prerequisiteIds.every((id) => tasks.some((item) => item.taskKey === id && item.state === 'DONE'))) { candidate.state = 'READY'; candidate.version += 1; await manager.getRepository(ProjectTask).save(candidate); }
      this.derive(run, tasks); await manager.getRepository(ProjectRun).save(run);
      if (!run.proofMissionId) throw Object.assign(new Error('Proof mission is missing'), { code: 'VERIFICATION_STALE' });
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${proof.provider}:${proof.repositoryId}`]);
      const watermark = await manager.getRepository(RepositoryInvalidationWatermark).findOne({ where: { provider: proof.provider, repositoryId: proof.repositoryId }, lock: { mode: 'pessimistic_read' } });
      const snapshot = await manager.getRepository(ProofSnapshot).save(manager.getRepository(ProofSnapshot).create({ ownerId: operation.ownerId, projectRunId: run.id, proofMissionId: run.proofMissionId, verificationLevel: VerificationLevel.MachineVerified, verifiedAt: new Date(proof.observedAt), invalidationGeneration: watermark?.generation ?? 0, schemaVersion: 1, payload: { taskKey: task.taskKey, ...proof } }));
      const result = { resource: { resourceType: 'PROJECT_TASK', resourceId: task.id, resourceHref: `/api/project-runs/${run.id}` }, proofSnapshotId: snapshot.id, status: 'PASS' };
      await this.finalizeOperation(manager, current, result); return result;
    });
  }

  private async commitFailure(operation: WorkflowOperation, fence: Awaited<ReturnType<TaskVerificationHandler['readFence']>>, code: string) {
    return this.dataSource.transaction(async (manager) => { const { operation: current, run, task, tasks } = await this.lockCommitFence(manager, operation, fence); return this.applyFailure(manager, current, run, task, tasks, code); });
  }
  private async applyFailure(manager: EntityManager, operation: WorkflowOperation, run: ProjectRun, task: ProjectTask, tasks: ProjectTask[], code: string) {
    task.state = 'IN_PROGRESS'; task.blockReasonCode = code; task.blockNote = null; task.version += 1; run.currentTaskId = task.taskKey;
    await manager.getRepository(ProjectTask).save(task); Object.assign(tasks.find((item) => item.id === task.id) ?? {}, task); this.derive(run, tasks); await manager.getRepository(ProjectRun).save(run);
    const result = { resource: { resourceType: 'PROJECT_TASK', resourceId: task.id, resourceHref: `/api/project-runs/${run.id}` }, status: 'FAIL', error: { code } };
    await this.finalizeOperation(manager, operation, result); return result;
  }
  private async lockCommitFence(manager: EntityManager, operation: WorkflowOperation, fence: Awaited<ReturnType<TaskVerificationHandler['readFence']>>) {
    const current = await manager.getRepository(WorkflowOperation).findOne({ where: { id: operation.id }, lock: { mode: 'pessimistic_write' } }); this.assertLease(current, operation.leaseOwner);
    const entitled = await manager.getRepository(ProjectFeatureEntitlement).exists({ where: [
      { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
      { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
    ] });
    const run = await manager.getRepository(ProjectRun).findOneOrFail({ where: { id: fence.run.id, ownerId: operation.ownerId }, lock: { mode: 'pessimistic_write' } });
    const task = await manager.getRepository(ProjectTask).findOneOrFail({ where: { id: fence.task.id, projectRunId: run.id }, lock: { mode: 'pessimistic_write' } });
    const binding = await manager.getRepository(ProjectRepositoryBinding).findOneOrFail({ where: { projectRunId: run.id }, lock: { mode: 'pessimistic_read' } });
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true' || !entitled || run.state === ProjectRunState.Archived || run.version !== fence.run.version || task.version !== fence.task.version || task.state !== 'VERIFYING' || binding.bindingVersion !== fence.binding.bindingVersion || binding.expectedHeadSha !== fence.binding.expectedHeadSha || binding.pullNumber !== fence.binding.pullNumber) throw Object.assign(new Error('Verification fence is stale'), { code: 'VERIFICATION_STALE' });
    const tasks = await manager.getRepository(ProjectTask).find({ where: { projectRunId: run.id }, order: { createdAt: 'ASC' } }); return { operation: current, run, task, binding, tasks };
  }
  private async finalizeOperation(manager: EntityManager, operation: WorkflowOperation, value: Record<string, unknown>) { const resource = value.resource as { resourceType: string; resourceId: string; resourceHref: string }; await manager.getRepository(WorkflowOperationResult).save(manager.getRepository(WorkflowOperationResult).create({ operationId: operation.id, value })); operation.state = WorkflowOperationState.Succeeded; operation.version = (operation.version ?? 1) + 1; operation.completedAt = new Date(); operation.leaseOwner = null; operation.leaseExpiresAt = null; operation.resultType = resource.resourceType; operation.resultId = resource.resourceId; operation.resultHref = resource.resourceHref; operation.failureClass = null; operation.errorCode = null; operation.errorMessage = null; await manager.getRepository(WorkflowOperation).save(operation); }
  private assertLease(operation: WorkflowOperation | null, leaseOwner: string | null): asserts operation is WorkflowOperation { if (!operation || operation.state !== WorkflowOperationState.Running || !leaseOwner || operation.leaseOwner !== leaseOwner || !operation.leaseExpiresAt || operation.leaseExpiresAt <= new Date()) throw Object.assign(new Error('Verification lease lost'), { code: 'VERIFICATION_STALE' }); }
  private rules(values: string[]): TaskEvidenceRule[] { const rules: TaskEvidenceRule[] = []; values.forEach((value, index) => { if (value === 'PR') rules.push({ id: `rule-${index}`, type: 'MERGED_PR' }); else if (value.startsWith('CHANGED_PATH:')) rules.push({ id: `rule-${index}`, type: 'CHANGED_PATH', glob: value.slice(13) }); else if (value.startsWith('NAMED_CHECK:')) rules.push({ id: `rule-${index}`, type: 'NAMED_CHECK', context: value.slice(12) }); else if (value.startsWith('BASE_BRANCH:')) rules.push({ id: `rule-${index}`, type: 'BASE_BRANCH', branch: value.slice(12) }); }); return rules; }
  private derive(run: ProjectRun, tasks: ProjectTask[]) { const required = tasks.filter((task) => task.required); run.state = required.every((task) => task.state === 'DONE') ? ProjectRunState.Completed : tasks.some((task) => ['IN_PROGRESS', 'VERIFYING'].includes(task.state)) ? ProjectRunState.Active : tasks.some((task) => task.state === 'READY') ? ProjectRunState.Active : ProjectRunState.Blocked; run.version += 1; const states = new Map(tasks.map((task) => [task.taskKey, task.state])); run.projection = { ...run.projection, state: run.state, version: run.version, currentTaskId: run.currentTaskId, recommendedTaskId: tasks.find((task) => task.state === 'READY')?.taskKey ?? null, tasks: run.projection.tasks.map((item) => ({ ...item, state: states.get(item.id) ?? item.state })), map: { ...run.projection.map, nodes: run.projection.map.nodes.map((item) => ({ ...item, state: states.get(item.id) ?? item.state })) } }; }
}
