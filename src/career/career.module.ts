import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubModule } from '../github/github.module';
import { CareerController } from './career.controller';
import {
  CareerEvidence,
  CareerTarget,
  CommandIdempotencyKey,
  ProofCriterion,
  ProofMission,
  ProofProfile,
  ProofReview,
  ProofVerificationRun,
  PublishedProof,
} from './career.entities';
import { CareerService } from './career.service';
import { CareerV1Controller, ProjectRunOperationsController } from './career-v1.controller';
import { CareerV1Service } from './career-v1.service';
import { CareerV1WorkflowHandlers } from './career-v1.handlers';
import { JobSourceModule } from '../job-sources';
import { WorkflowOperationModule } from '../workflow-operations/workflow-operation.module';
import { AiModule } from '../ai/ai.module';
import { ExecutionOrchestrationModule } from '../execution-orchestration/execution-orchestration.module';
import { CandidateProfileSnapshot, CareerDiffSnapshot, CareerTargetVersion, ProjectBlueprintVersion, ProjectFeatureEntitlement, ProjectProposal, ProjectProposalSet, ProjectRunCommand } from '../project-runs/product-spine.entities';
import { GithubInstallation, GithubInstallationRepository } from '../github/github.entities';

@Module({
  imports: [
    GithubModule,
    JobSourceModule,
    WorkflowOperationModule,
    AiModule,
    ExecutionOrchestrationModule,
    TypeOrmModule.forFeature([
      CareerTarget,
      CareerEvidence,
      ProofMission,
      ProofCriterion,
      ProofVerificationRun,
      ProofReview,
      ProofProfile,
      PublishedProof,
      CommandIdempotencyKey,
      CandidateProfileSnapshot,
      CareerDiffSnapshot,
      CareerTargetVersion,
      ProjectBlueprintVersion,
      ProjectFeatureEntitlement,
      ProjectProposal,
      ProjectProposalSet,
      ProjectRunCommand,
      GithubInstallation,
      GithubInstallationRepository,
    ]),
  ],
  controllers: [CareerController, CareerV1Controller, ProjectRunOperationsController],
  providers: [CareerService, CareerV1Service, CareerV1WorkflowHandlers],
  exports: [CareerService],
})
export class CareerModule {}
