import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, IsNull, MoreThan } from 'typeorm';
import { FIXTURE_VERIFICATION_IDS, FixtureVerificationProvider } from '../verification-providers';
import { VerificationProviderError } from '../verification-providers/verification-provider.errors';
import { WorkflowOperation, WorkflowOperationResult, WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { WorkflowOperationHandlers } from '../workflow-operations/workflow-operation.worker';
import { RetryableWorkflowError } from '../workflow-operations/workflow-runtime';
import { GithubProviderError } from '../github/github.client';
import { GithubAuthorizationError, GithubService } from '../github/github.service';
import { ProjectRun, ProjectRunState } from './project-run.entity';
import { assertProjectRunProjection } from './project-run.projection';
import { ProjectFeature, ProjectFeatureEntitlement, ProjectRepositoryBinding, ProjectTask } from './product-spine.entities';
import { VERIFICATION_PROVIDER } from './task-verification.handler';

@Injectable()
export class PullRequestBindingHandler implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly handlers: WorkflowOperationHandlers,
    @Inject(VERIFICATION_PROVIDER) private readonly provider: FixtureVerificationProvider,
    @Optional() private readonly github?: GithubService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') === 'true' && ['fixture', 'github'].includes(this.config.get<string>('GITHUB_PROVIDER') ?? '')) {
      this.handlers.register('PULL_REQUEST_BINDING', (operation) => this.execute(operation));
    }
  }

  private async execute(operation: WorkflowOperation) {
    const fence = await this.readFence(operation);
    try {
      if (this.config.get<string>('GITHUB_PROVIDER') === 'github') {
        if (!this.github || !fence.binding.installationId) {
          throw new VerificationProviderError('VERIFICATION_PROVIDER_UNAVAILABLE');
        }
        const [binding, head] = await Promise.all([
          this.github.resolvePullRequestBinding(
            operation.ownerId,
            fence.binding.installationId,
            String(operation.input.githubRepositoryId),
            Number(operation.input.pullNumber),
          ),
          this.github.getPullRequestHead(
            operation.ownerId,
            fence.binding.installationId,
            String(operation.input.githubRepositoryId),
            Number(operation.input.pullNumber),
          ),
        ]);
        if (binding.repositoryName !== fence.binding.repositoryName && fence.binding.repositoryName) {
          throw new VerificationProviderError('VERIFICATION_PROVIDER_DRIFTED');
        }
        return this.commitSuccess(
          operation,
          fence,
          binding.repositoryName,
          binding.repositoryPrivate,
          head.headSha,
        );
      }
      const repository = await this.provider.resolveRepositoryBinding({
        ownerId: FIXTURE_VERIFICATION_IDS.ownerId,
        installationId: FIXTURE_VERIFICATION_IDS.installationId,
        repositoryId: String(operation.input.githubRepositoryId),
      });
      const facts = await this.provider.getPullRequestFacts({
        repositoryId: String(operation.input.githubRepositoryId),
        pullNumber: Number(operation.input.pullNumber),
      });
      if (repository.fullName !== fence.binding.repositoryName && fence.binding.repositoryName) {
        throw new VerificationProviderError('VERIFICATION_PROVIDER_DRIFTED');
      }
      return this.commitSuccess(operation, fence, repository.fullName, repository.private, facts.headSha);
    } catch (error) {
      if (error instanceof GithubProviderError) {
        if (['RATE_LIMITED', 'TIMEOUT', 'UPSTREAM'].includes(error.code)) {
          throw new RetryableWorkflowError('VERIFICATION_PROVIDER_UNAVAILABLE', error.message);
        }
        return this.commitFailure(
          operation,
          fence,
          error.code === 'NOT_FOUND' ? 'PULL_REQUEST_NOT_FOUND' : 'VERIFICATION_FACTS_INVALID',
        );
      }
      if (error instanceof GithubAuthorizationError) {
        return this.commitFailure(operation, fence, 'REPOSITORY_NOT_AUTHORIZED');
      }
      if (error instanceof VerificationProviderError && error.code === 'VERIFICATION_PROVIDER_UNAVAILABLE') {
        throw new RetryableWorkflowError(error.code, error.message);
      }
      if (error instanceof VerificationProviderError) {
        return this.commitFailure(operation, fence, error.code);
      }
      throw error;
    }
  }

  private readFence(operation: WorkflowOperation) {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.getRepository(WorkflowOperation).findOne({ where: { id: operation.id }, lock: { mode: 'pessimistic_read' } });
      this.assertLease(current, operation.leaseOwner);
      if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') throw Object.assign(new Error('Project Runs disabled'), { code: 'PULL_REQUEST_BINDING_STALE' });
      const entitled = await manager.getRepository(ProjectFeatureEntitlement).exists({ where: [
        { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
        { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
      ] });
      if (!entitled) throw Object.assign(new Error('Entitlement expired'), { code: 'PULL_REQUEST_BINDING_STALE' });
      const run = await manager.getRepository(ProjectRun).findOne({ where: { id: String(operation.input.projectRunId), ownerId: operation.ownerId }, lock: { mode: 'pessimistic_read' } });
      const binding = run ? await manager.getRepository(ProjectRepositoryBinding).findOne({ where: { projectRunId: run.id }, lock: { mode: 'pessimistic_read' } }) : null;
      if (!run || run.state === ProjectRunState.Archived || run.version !== Number(operation.input.runVersion) || !binding?.githubRepositoryId || binding.githubRepositoryId !== String(operation.input.githubRepositoryId)) {
        throw Object.assign(new Error('Pull request binding fence is stale'), { code: 'PULL_REQUEST_BINDING_STALE' });
      }
      if (await this.hasTaskVerificationAttempt(manager, operation.ownerId, run.id)) {
        throw Object.assign(new Error('Pull request binding is locked'), { code: 'PULL_REQUEST_BINDING_STALE' });
      }
      return { run, binding };
    });
  }

  private commitSuccess(
    operation: WorkflowOperation,
    fence: Awaited<ReturnType<PullRequestBindingHandler['readFence']>>,
    repositoryName: string,
    repositoryPrivate: boolean,
    headSha: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.getRepository(WorkflowOperation).findOne({ where: { id: operation.id }, lock: { mode: 'pessimistic_write' } });
      this.assertLease(current, operation.leaseOwner);
      const run = await manager.getRepository(ProjectRun).findOneOrFail({ where: { id: fence.run.id, ownerId: operation.ownerId }, lock: { mode: 'pessimistic_write' } });
      const binding = await manager.getRepository(ProjectRepositoryBinding).findOneOrFail({ where: { projectRunId: run.id }, lock: { mode: 'pessimistic_write' } });
      if (run.version !== fence.run.version || binding.bindingVersion !== fence.binding.bindingVersion) {
        throw Object.assign(new Error('Pull request binding fence is stale'), { code: 'PULL_REQUEST_BINDING_STALE' });
      }
      binding.repositoryName = repositoryName;
      binding.repositoryPrivate = repositoryPrivate;
      binding.pullNumber = Number(operation.input.pullNumber);
      binding.expectedHeadSha = headSha;
      binding.bindingVersion += 1;
      await manager.getRepository(ProjectRepositoryBinding).save(binding);
      const pullUrl = repositoryName ? `https://github.com/${repositoryName}/pull/${binding.pullNumber}` : null;
      run.projection = {
        ...run.projection,
        version: run.version,
        repositoryBinding: {
          githubRepositoryId: binding.githubRepositoryId!,
          repositoryName: binding.repositoryName,
          pullNumber: binding.pullNumber,
          headSha: binding.expectedHeadSha,
          pullUrl,
        },
      };
      assertProjectRunProjection(run.projection);
      await manager.getRepository(ProjectRun).save(run);
      const result = {
        resource: { resourceType: 'PROJECT_RUN', resourceId: run.id, resourceHref: `/api/project-runs/${run.id}` },
        status: 'PASS',
        repositoryBinding: run.projection.repositoryBinding,
      };
      await this.finalizeOperation(manager, current, result);
      return result;
    });
  }

  private commitFailure(operation: WorkflowOperation, fence: Awaited<ReturnType<PullRequestBindingHandler['readFence']>>, code: string) {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.getRepository(WorkflowOperation).findOne({ where: { id: operation.id }, lock: { mode: 'pessimistic_write' } });
      this.assertLease(current, operation.leaseOwner);
      const result = {
        resource: { resourceType: 'PROJECT_RUN', resourceId: fence.run.id, resourceHref: `/api/project-runs/${fence.run.id}` },
        status: 'FAIL',
        error: { code },
      };
      await this.finalizeOperation(manager, current, result);
      return result;
    });
  }

  private async hasTaskVerificationAttempt(manager: EntityManager, ownerId: string, projectRunId: string): Promise<boolean> {
    if (await manager.getRepository(ProjectTask).exists({ where: { projectRunId, state: 'VERIFYING' } })) return true;
    return manager.getRepository(WorkflowOperation).createQueryBuilder('op')
      .where('op.owner_id = :ownerId', { ownerId })
      .andWhere(`op.kind = 'TASK_VERIFICATION'`)
      .andWhere(`op.input ->> 'projectRunId' = :projectRunId`, { projectRunId })
      .getExists();
  }

  private async finalizeOperation(manager: EntityManager, operation: WorkflowOperation, value: Record<string, unknown>) {
    const resource = value.resource as { resourceType: string; resourceId: string; resourceHref: string };
    await manager.getRepository(WorkflowOperationResult).save(manager.getRepository(WorkflowOperationResult).create({ operationId: operation.id, value }));
    operation.state = WorkflowOperationState.Succeeded;
    operation.version = (operation.version ?? 1) + 1;
    operation.completedAt = new Date();
    operation.leaseOwner = null;
    operation.leaseExpiresAt = null;
    operation.resultType = resource.resourceType;
    operation.resultId = resource.resourceId;
    operation.resultHref = resource.resourceHref;
    operation.failureClass = value.status === 'FAIL' ? 'NONRETRYABLE_DEPENDENCY' : null;
    operation.errorCode = value.status === 'FAIL' ? String((value.error as { code?: string })?.code ?? 'PULL_REQUEST_BINDING_FAILED') : null;
    operation.errorMessage = value.status === 'FAIL' ? 'Pull request binding failed' : null;
    await manager.getRepository(WorkflowOperation).save(operation);
  }

  private assertLease(operation: WorkflowOperation | null, leaseOwner: string | null): asserts operation is WorkflowOperation {
    if (!operation || operation.state !== WorkflowOperationState.Running || !leaseOwner || operation.leaseOwner !== leaseOwner || !operation.leaseExpiresAt || operation.leaseExpiresAt <= new Date()) {
      throw Object.assign(new Error('Pull request binding lease lost'), { code: 'PULL_REQUEST_BINDING_STALE' });
    }
  }
}
