import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProofMission, ProofMissionState, PublishedProof, PublishedProofState } from '../career/career.entities';
import { ProjectRun, ProjectRunState } from '../project-runs/project-run.entity';
import type { CreateProjectRunCommand, ProjectRunsExecutionPort, ProofMissionExecutionPort, CreatedProjectRun } from './execution-orchestration.ports';
import type { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { assertProjectRunProjection } from '../project-runs/project-run.projection';
import { ProjectPlanSnapshot, ProjectRepositoryBinding, ProjectTask, RepositoryMode } from '../project-runs/product-spine.entities';
import { ProjectFeature, ProjectFeatureEntitlement } from '../project-runs/product-spine.entities';
import { IsNull, MoreThan } from 'typeorm';
import { Roadmap, RoadmapVisibility } from '../roadmaps/entities/roadmap.entities';

@Injectable()
export class ProjectRunsExecutionAdapter implements ProjectRunsExecutionPort {
  constructor(private readonly config: ConfigService) {}

  async create(manager: EntityManager, command: CreateProjectRunCommand): Promise<CreatedProjectRun> {
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') {
      throw new ServiceUnavailableException({ code: 'PROJECT_RUNS_DISABLED', message: 'Project Runs are unavailable' });
    }
    const entitlement = await manager.getRepository(ProjectFeatureEntitlement).findOne({ where: [
      { userId: command.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
      { userId: command.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
    ], lock: { mode: 'pessimistic_read' } });
    if (!entitlement) throw new NotFoundException('Project Run entitlement not found');
    const repository = manager.getRepository(ProjectRun);
    const existing = await repository.findOne({ where: { sourceOperationId: command.operationId } });
    if (existing) {
      if (!existing.roadmapId && command.roadmapId) existing.roadmapId = command.roadmapId;
      if (!existing.planSnapshotId && command.planSnapshotId) existing.planSnapshotId = command.planSnapshotId;
      if ((command.roadmapId && existing.roadmapId === command.roadmapId) || (command.planSnapshotId && existing.planSnapshotId === command.planSnapshotId)) await repository.save(existing);
      const taskRepository = manager.getRepository(ProjectTask);
      for (const task of command.projection.tasks) {
        if (!await taskRepository.exists({ where: { projectRunId: existing.id, taskKey: task.id } })) {
          await taskRepository.save(taskRepository.create({ projectRunId: existing.id, taskKey: task.id, title: task.title, state: task.state, required: task.required, milestoneId: task.milestoneId, prerequisiteIds: task.prerequisiteIds, purpose: task.purpose, acceptanceCriteria: task.acceptanceCriteria, evidenceRequirements: task.evidenceRequirements, blockedFrom: null, blockReasonCode: null, blockNote: null, version: 1, startedAt: null }));
        }
      }
      const bindingRepository = manager.getRepository(ProjectRepositoryBinding);
      if (!await bindingRepository.exists({ where: { projectRunId: existing.id } })) {
        const binding = command.repository ?? { mode: RepositoryMode.ManualGreenfield };
        await bindingRepository.save(bindingRepository.create({ projectRunId: existing.id, mode: binding.mode, installationId: binding.installationId ?? null, githubRepositoryId: binding.githubRepositoryId ?? null, repositoryName: binding.repositoryName ?? null, repositoryPrivate: binding.repositoryPrivate ?? null, bindingVersion: binding.bindingVersion ?? 1, pullNumber: binding.pullNumber ?? null, expectedHeadSha: binding.expectedHeadSha ?? null }));
      }
      return { id: existing.id, ownerId: existing.ownerId, targetId: command.targetId, competencySlugs: command.competencySlugs, created: false };
    }
    const id = randomUUID();
    const roadmap = command.roadmap ? await manager.getRepository(Roadmap).save(manager.getRepository(Roadmap).create({ ownerId: command.ownerId, title: command.roadmap.title, description: command.roadmap.description, tags: ['project-run'], visibility: RoadmapVisibility.Private, graph: command.roadmap.graph, directoryId: null, forkedFromId: null })) : null;
    const planSnapshot = command.planSnapshot
      ? await manager.getRepository(ProjectPlanSnapshot).save(manager.getRepository(ProjectPlanSnapshot).create({ ownerId: command.ownerId, schemaVersion: 1, ...command.planSnapshot }))
      : null;
    const projection = { ...command.projection, id, state: ProjectRunState.Ready, version: 1 };
    assertProjectRunProjection(projection);
    const entity = repository.create({
      id,
      sourceOperationId: command.operationId,
      ownerId: command.ownerId, state: ProjectRunState.Ready, version: 1,
      projection, currentTaskId: null, roadmapId: command.roadmapId ?? roadmap?.id ?? null,
      proofMissionId: null, planSnapshotId: command.planSnapshotId ?? planSnapshot?.id ?? null,
    });
    const saved = await repository.save(entity);
    const taskRepository = manager.getRepository(ProjectTask);
    await taskRepository.save(command.projection.tasks.map((task) => taskRepository.create({
      projectRunId: saved.id, taskKey: task.id, title: task.title, state: task.state,
      required: task.required, milestoneId: task.milestoneId, prerequisiteIds: task.prerequisiteIds,
      purpose: task.purpose, acceptanceCriteria: task.acceptanceCriteria,
      evidenceRequirements: task.evidenceRequirements, blockedFrom: null, blockReasonCode: null,
      blockNote: null, version: 1, startedAt: null,
    })));
    const binding = command.repository ?? { mode: RepositoryMode.ManualGreenfield };
    const bindingRepository = manager.getRepository(ProjectRepositoryBinding);
    await bindingRepository.save(bindingRepository.create({
      projectRunId: saved.id, mode: binding.mode,
      installationId: binding.installationId ?? null, githubRepositoryId: binding.githubRepositoryId ?? null,
      repositoryName: binding.repositoryName ?? null, repositoryPrivate: binding.repositoryPrivate ?? null,
      bindingVersion: binding.bindingVersion ?? 1, pullNumber: binding.pullNumber ?? null,
      expectedHeadSha: binding.expectedHeadSha ?? null,
    }));
    return { id: saved.id, ownerId: saved.ownerId, targetId: command.targetId, competencySlugs: command.competencySlugs, created: true };
  }
}

@Injectable()
export class ProofMissionExecutionAdapter implements ProofMissionExecutionPort {
  async createForProjectRun(manager: EntityManager, run: CreatedProjectRun): Promise<string[]> {
    const repository = manager.getRepository(ProofMission);
    const missions = run.competencySlugs.map((competencySlug) => repository.create({
      ownerUserId: run.ownerId, targetId: run.targetId, competencySlug,
      title: `Project run proof: ${competencySlug}`, summary: null, state: ProofMissionState.Draft,
      criteriaVersion: 1, bindingVersion: 0, installationId: null, githubRepositoryId: null,
      pullNumber: null, repositoryName: null, repositoryPrivate: null, pullTitle: null, pullUrl: null,
      currentVerificationRunId: null, currentReviewId: null,
    }));
    return (await repository.save(missions)).map(({ id }) => id);
  }

  async invalidateForProviderChange(
    manager: EntityManager,
    selector: { installationId: string; repositoryId?: string; pullNumber?: number },
  ): Promise<void> {
    const query = manager.getRepository(ProofMission).createQueryBuilder('mission')
      .setLock('pessimistic_write')
      .where('mission.installation_id = :installationId', { installationId: selector.installationId });
    if (selector.repositoryId) query.andWhere('mission.github_repository_id = :repositoryId', selector);
    if (selector.pullNumber) query.andWhere('mission.pull_number = :pullNumber', selector);
    for (const mission of await query.orderBy('mission.id', 'ASC').getMany()) {
      if (mission.state === ProofMissionState.Archived) continue;
      mission.state = ProofMissionState.Bound;
      mission.currentVerificationRunId = null;
      mission.currentReviewId = null;
      await manager.getRepository(ProofMission).save(mission);
      await manager.getRepository(PublishedProof).update(
        { missionId: mission.id, state: PublishedProofState.Active },
        { state: PublishedProofState.Invalidated },
      );
    }
  }
}
