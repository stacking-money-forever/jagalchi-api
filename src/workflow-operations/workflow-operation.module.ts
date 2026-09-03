import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowOperation, WorkflowOperationResult, WorkflowWorkerHeartbeat } from './workflow-operation.entities';
import { WorkflowOperationService } from './workflow-operation.service';
import { WorkflowOperationHandlers, WorkflowOperationWorker } from './workflow-operation.worker';
import { AiModule } from '../ai/ai.module';
import { AiWorkflowHandlers } from './ai-workflow.handlers';
import { ProjectRunEntitlement } from '../project-runs/project-run-entitlement.entity';
import { WorkflowOperationController, WorkflowOperationPublicController } from './workflow-operation.controller';
import { ExecutionOrchestrationModule } from '../execution-orchestration/execution-orchestration.module';
import { WorkflowBackoffPolicy, WorkflowClock } from './workflow-runtime';
import { ProjectFeatureEntitlement } from '../project-runs/product-spine.entities';
import { ProjectRunCommand } from '../project-runs/product-spine.entities';

@Module({
  imports: [AiModule, ExecutionOrchestrationModule, TypeOrmModule.forFeature([WorkflowOperation, WorkflowOperationResult, WorkflowWorkerHeartbeat, ProjectRunEntitlement, ProjectFeatureEntitlement, ProjectRunCommand])],
  controllers: [WorkflowOperationController, WorkflowOperationPublicController],
  providers: [WorkflowClock, WorkflowBackoffPolicy, WorkflowOperationService, WorkflowOperationHandlers, AiWorkflowHandlers, WorkflowOperationWorker],
  exports: [WorkflowOperationService, WorkflowOperationHandlers, WorkflowOperationWorker],
})
export class WorkflowOperationModule {}
