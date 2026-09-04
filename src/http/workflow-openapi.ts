import { applyDecorators, Header, HttpCode } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { WORKFLOW_RETRY_AFTER_SECONDS } from './workflow-response';
import { WorkflowOperationResponseDto } from '../workflow-operations/workflow-operation.response.dto';

export function ApiAcceptedWorkflowOperation() {
  return applyDecorators(
    HttpCode(202),
    Header('Retry-After', WORKFLOW_RETRY_AFTER_SECONDS),
    ApiResponse({
      status: 202,
      description: 'Workflow operation accepted for asynchronous processing',
      type: WorkflowOperationResponseDto,
      headers: {
        'Retry-After': {
          description: 'Seconds before polling GET /api/workflow-operations/{id} again',
          schema: { type: 'integer', example: Number(WORKFLOW_RETRY_AFTER_SECONDS) },
        },
      },
    }),
  );
}
