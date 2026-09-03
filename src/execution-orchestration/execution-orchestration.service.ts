import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  PROJECT_RUNS_EXECUTION_PORT,
  PROOF_MISSION_EXECUTION_PORT,
  type CreateProjectRunCommand,
  type ProjectRunsExecutionPort,
  type ProofMissionExecutionPort,
} from './execution-orchestration.ports';
import { ProjectRun } from '../project-runs/project-run.entity';

@Injectable()
export class ExecutionOrchestrationService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(PROJECT_RUNS_EXECUTION_PORT) private readonly projectRuns: ProjectRunsExecutionPort,
    @Inject(PROOF_MISSION_EXECUTION_PORT) private readonly proofMissions: ProofMissionExecutionPort,
  ) {}

  createProjectRun(command: CreateProjectRunCommand) {
    return this.dataSource.transaction((manager) => this.createProjectRunInTransaction(manager, command));
  }

  async createProjectRunInTransaction(manager: EntityManager, command: CreateProjectRunCommand) {
    const projectRun = await this.projectRuns.create(manager, command);
    const proofMissionIds = projectRun.created
      ? await this.proofMissions.createForProjectRun(manager, projectRun)
      : [];
    if (projectRun.created && proofMissionIds[0]) {
      await manager.getRepository(ProjectRun).update(
        { id: projectRun.id }, { proofMissionId: proofMissionIds[0] },
      );
    }
    return { projectRun, proofMissionIds };
  }

  invalidateProviderEvidence(
    selector: { installationId: string; repositoryId?: string; pullNumber?: number; headSha?: string },
  ): Promise<void> {
    return this.dataSource.transaction((manager) =>
      this.proofMissions.invalidateForProviderChange(manager, selector));
  }
}
