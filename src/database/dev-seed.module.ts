import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/auth.entities';
import { CareerModule } from '../career/career.module';
import { CareerTarget, ProofMission } from '../career/career.entities';
import { ExecutionOrchestrationModule } from '../execution-orchestration/execution-orchestration.module';
import { ProjectRunEntitlement } from '../project-runs/project-run-entitlement.entity';
import { ProjectRun } from '../project-runs/project-run.entity';
import { ProjectFeatureEntitlement } from '../project-runs/product-spine.entities';
import { Roadmap } from '../roadmaps/entities/roadmap.entities';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkflowOperationModule } from '../workflow-operations/workflow-operation.module';
import { DevSeedService } from './dev-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, ProjectRunEntitlement, ProjectFeatureEntitlement, ProjectRun, CareerTarget, ProofMission, Roadmap,
    ]),
    TicketsModule,
    CareerModule,
    RoadmapsModule,
    WorkflowOperationModule,
    ExecutionOrchestrationModule,
  ],
  providers: [DevSeedService],
  exports: [DevSeedService],
})
export class DevSeedModule {}
