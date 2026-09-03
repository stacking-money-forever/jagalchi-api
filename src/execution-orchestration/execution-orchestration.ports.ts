import type { EntityManager } from 'typeorm';
import type { ProjectRunProjection } from '../project-runs/project-run.entity';
import type { RepositoryMode } from '../project-runs/product-spine.entities';

export interface CreateProjectRunCommand {
  ownerId: string;
  proposalId: string;
  catalogVersion: string;
  targetId: string;
  competencySlugs: string[];
  projection: Omit<ProjectRunProjection, 'id' | 'state' | 'version'>;
  operationId: string;
  roadmapId?: string;
  roadmap?: { title: string; description: string; graph: Record<string, unknown> };
  planSnapshotId?: string;
  planSnapshot?: { projectProposalId: string; careerDiffSnapshotId: string; candidateProfileSnapshotId: string; blueprintVersionId: string; catalogVersion: string; payload: Record<string, unknown> };
  repository?: { mode: RepositoryMode; installationId?: string; githubRepositoryId?: string; repositoryName?: string; repositoryPrivate?: boolean; bindingVersion?: number; pullNumber?: number; expectedHeadSha?: string };
}

export interface CreatedProjectRun {
  id: string;
  ownerId: string;
  targetId: string;
  competencySlugs: string[];
  created: boolean;
}

export interface ProjectRunsExecutionPort {
  create(manager: EntityManager, command: CreateProjectRunCommand): Promise<CreatedProjectRun>;
}

export interface ProofMissionExecutionPort {
  createForProjectRun(manager: EntityManager, run: CreatedProjectRun): Promise<string[]>;
  invalidateForProviderChange(
    manager: EntityManager,
    selector: { installationId: string; repositoryId?: string; pullNumber?: number; headSha?: string },
  ): Promise<void>;
}

export const PROJECT_RUNS_EXECUTION_PORT = Symbol('PROJECT_RUNS_EXECUTION_PORT');
export const PROOF_MISSION_EXECUTION_PORT = Symbol('PROOF_MISSION_EXECUTION_PORT');
