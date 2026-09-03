import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProjectRun } from './project-run.entity';
import { ProjectRunsController } from './project-runs.controller';
import { ProjectRunsService } from './project-runs.service';
import { ProjectRunEntitlement } from './project-run-entitlement.entity';
import {
  CandidateProfileSnapshot, CareerDiffSnapshot, CareerTargetVersion, ProjectBlueprintVersion, ProjectFeatureEntitlement,
  ProjectPlanSnapshot, ProjectProposal, ProjectProposalSet, ProjectRepositoryBinding,
  ProjectRunCommand, ProjectTask, ProofPublication, ProofSnapshot, ProviderInvalidationEvent, RepositoryInvalidationWatermark,
} from './product-spine.entities';
import { WorkflowOperation } from '../workflow-operations/workflow-operation.entities';
import { ProofProfile } from '../career/career.entities';
import { VerificationModule } from './verification.module';

@Module({
  imports: [AuthModule, VerificationModule, TypeOrmModule.forFeature([
    ProjectRun, ProjectRunEntitlement, WorkflowOperation, CandidateProfileSnapshot,
    CareerDiffSnapshot, CareerTargetVersion, ProjectBlueprintVersion, ProjectFeatureEntitlement, ProjectPlanSnapshot,
    ProjectProposal, ProjectProposalSet, ProjectRepositoryBinding, ProjectRunCommand, ProjectTask,
    ProofPublication, ProofSnapshot,
    ProviderInvalidationEvent, RepositoryInvalidationWatermark,
    ProofProfile,
  ])],
  controllers: [ProjectRunsController], providers: [ProjectRunsService], exports: [ProjectRunsService],
})
export class ProjectRunsModule {}
