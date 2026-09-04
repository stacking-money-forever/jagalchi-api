import { ApiProperty } from '@nestjs/swagger';

export class WorkflowOperationResultDto {
  @ApiProperty({ type: String }) resourceType: string;
  @ApiProperty({ type: String, format: 'uuid' }) resourceId: string;
  @ApiProperty({ type: String, example: '/api/career/target-versions/00000000-0000-4000-8000-000000000001' }) resourceHref: string;
}

export class WorkflowOperationErrorDto {
  @ApiProperty({ type: String, example: 'AI_PLAN_MALFORMED' }) code: string;
  @ApiProperty({ type: Boolean }) retryable: boolean;
}

export class WorkflowOperationResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) kind: string;
  @ApiProperty({ type: String, enum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'CANCEL_REQUESTED'] }) state: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) attempt: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) maxAttempts: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) nextAttemptAt: string | null;
  @ApiProperty({ type: WorkflowOperationResultDto, nullable: true }) result: WorkflowOperationResultDto | null;
  @ApiProperty({ type: WorkflowOperationErrorDto, nullable: true }) error: WorkflowOperationErrorDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: Object, nullable: true, additionalProperties: true }) body: Record<string, unknown> | null;
}

export class WorkflowOperationCancelResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, enum: ['CANCELLED', 'CANCEL_REQUESTED'] }) state: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version: number;
}
