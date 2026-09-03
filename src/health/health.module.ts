import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { WorkflowOperationModule } from '../workflow-operations/workflow-operation.module';

@Module({ imports: [WorkflowOperationModule], controllers: [HealthController] })
export class HealthModule {}
