import { Module } from '@nestjs/common';
import { PROJECT_RUNS_EXECUTION_PORT, PROOF_MISSION_EXECUTION_PORT } from './execution-orchestration.ports';
import { ExecutionOrchestrationService } from './execution-orchestration.service';
import { ProjectRunsExecutionAdapter, ProofMissionExecutionAdapter } from './execution-orchestration.adapters';

@Module({
  providers: [
    ProjectRunsExecutionAdapter,
    ProofMissionExecutionAdapter,
    { provide: PROJECT_RUNS_EXECUTION_PORT, useExisting: ProjectRunsExecutionAdapter },
    { provide: PROOF_MISSION_EXECUTION_PORT, useExisting: ProofMissionExecutionAdapter },
    ExecutionOrchestrationService,
  ],
  exports: [ExecutionOrchestrationService],
})
export class ExecutionOrchestrationModule {}
