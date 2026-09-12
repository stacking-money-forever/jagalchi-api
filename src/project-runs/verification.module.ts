import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubModule } from '../github/github.module';
import { FixtureVerificationProvider } from '../verification-providers';
import { WorkflowOperationModule } from '../workflow-operations/workflow-operation.module';
import { ProjectFeatureEntitlement, ProjectRepositoryBinding, ProjectTask, ProofSnapshot, ProviderInvalidationEvent, RepositoryInvalidationWatermark } from './product-spine.entities';
import { ProjectRun } from './project-run.entity';
import { PullRequestBindingHandler } from './pull-request-binding.handler';
import { TaskVerificationHandler, VERIFICATION_PROVIDER } from './task-verification.handler';
import { VerificationInvalidationService } from './verification-invalidation.service';

@Module({ imports: [GithubModule, WorkflowOperationModule, TypeOrmModule.forFeature([ProjectRun, ProjectTask, ProjectRepositoryBinding, ProjectFeatureEntitlement, ProofSnapshot, ProviderInvalidationEvent, RepositoryInvalidationWatermark])], providers: [{ provide: VERIFICATION_PROVIDER, inject: [ConfigService], useFactory: (config: ConfigService) => { const scenario = config.get<string>('FIXTURE_VERIFICATION_SCENARIO') ?? 'success'; if (!['success', 'failure', 'drift', 'unavailable'].includes(scenario)) throw new Error('FIXTURE_VERIFICATION_SCENARIO is invalid'); return new FixtureVerificationProvider(scenario as 'success' | 'failure' | 'drift' | 'unavailable'); } }, TaskVerificationHandler, PullRequestBindingHandler, VerificationInvalidationService], exports: [VerificationInvalidationService] })
export class VerificationModule {}
