import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { User, UserStatus } from '../auth/auth.entities';
import { hashPassword, verifyPassword } from '../auth/password';
import { CareerService } from '../career/career.service';
import { CareerTarget, ProofMission, ProofProfileState } from '../career/career.entities';
import { ExecutionOrchestrationService } from '../execution-orchestration/execution-orchestration.service';
import {
  GithubInstallation,
  GithubInstallationRepository,
  GithubInstallationStatus,
} from '../github/github.entities';
import { ProjectRunEntitlement } from '../project-runs/project-run-entitlement.entity';
import type { ProjectRunProjection } from '../project-runs/project-run.entity';
import { ProjectRun } from '../project-runs/project-run.entity';
import {
  CandidateProfileSnapshot, CareerDiffSnapshot, ProjectBlueprintVersion, ProjectFeature,
  ProjectFeatureEntitlement, ProjectPlanSnapshot, ProjectProposal, ProjectProposalSet,
  RepositoryMode, SnapshotState,
} from '../project-runs/product-spine.entities';
import { RoadmapVisibility, Roadmap } from '../roadmaps/entities/roadmap.entities';
import { RoadmapsService } from '../roadmaps/roadmaps.service';
import { TicketsService } from '../tickets/tickets.service';
import { WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { WorkflowOperationService } from '../workflow-operations/workflow-operation.service';

export interface DevSeedResult {
  schemaVersion: 1;
  userId: string;
  projectRunId: string;
  roadmapId: string;
}

export interface DevSeedEnvironment {
  email: string;
  password: string;
  seedFixtureRepository: boolean;
}

export function validateDevSeedEnvironment(get: (key: string) => string | undefined): DevSeedEnvironment {
  if (get('NODE_ENV') === 'production') throw new Error('dev:seed is not allowed in production');
  const email = get('LOCAL_SEED_EMAIL')?.trim().toLowerCase();
  const password = get('LOCAL_SEED_PASSWORD');
  if (!email) throw new Error('LOCAL_SEED_EMAIL is required');
  if (!password) throw new Error('LOCAL_SEED_PASSWORD is required');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('LOCAL_SEED_EMAIL is malformed');
  }
  if (password.length < 10 || password.length > 128) {
    throw new Error('LOCAL_SEED_PASSWORD must be 10-128 characters');
  }
  const mode = get('JAGALCHI_LOCAL_MODE');
  const githubProvider = get('GITHUB_PROVIDER');
  if (get('PROJECT_RUNS_ENABLED') !== 'true') {
    throw new Error('dev:seed requires PROJECT_RUNS_ENABLED=true');
  }
  if ((mode === 'local' || mode === 'ci' || mode === 'ci-real-source') && githubProvider === 'fixture') {
    return { email, password, seedFixtureRepository: true };
  }
  if (mode === 'local-real-source' && githubProvider === 'fixture') {
    return { email, password, seedFixtureRepository: true };
  }
  if (mode === 'local-real' && githubProvider === 'github') {
    return { email, password, seedFixtureRepository: false };
  }
  throw new Error('dev:seed requires a compatible local mode and GitHub provider');
}

const SEED_NAME = 'Jagalchi Local User';
const SEED_TARGET_COMPANY = 'Jagalchi Local Seed';
const SEED_TARGET_ROLE = 'Project Builder';
const SEED_ROADMAP_TITLE = 'Jagalchi Local Execution Roadmap';
const SEED_REQUIREMENTS = 'Build and verify a production-shaped TypeScript feature with deterministic tests.';

@Injectable()
export class DevSeedService {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ProjectRunEntitlement)
    private readonly entitlements: Repository<ProjectRunEntitlement>,
    @InjectRepository(CareerTarget) private readonly targets: Repository<CareerTarget>,
    @InjectRepository(Roadmap) private readonly roadmapRepository: Repository<Roadmap>,
    private readonly tickets: TicketsService,
    private readonly career: CareerService,
    private readonly roadmaps: RoadmapsService,
    private readonly operations: WorkflowOperationService,
    private readonly execution: ExecutionOrchestrationService,
    @InjectRepository(ProjectFeatureEntitlement)
    private readonly featureEntitlements?: Repository<ProjectFeatureEntitlement>,
    @InjectRepository(ProjectRun) private readonly projectRuns?: Repository<ProjectRun>,
    @InjectRepository(ProofMission) private readonly proofMissions?: Repository<ProofMission>,
  ) {}

  async seed(): Promise<DevSeedResult> {
    const environment = validateDevSeedEnvironment((key) => this.config.get<string>(key));
    const { email, password } = environment;
    const user = await this.reconcileUser(email, password);
    await this.tickets.openAccount(user.id);
    await this.reconcileEntitlement(user.id);
    await this.reconcileProofProfile(user.id);
    if (environment.seedFixtureRepository) await this.reconcileFixtureRepository(user.id);
    const target = await this.reconcileTarget(user.id);
    const planSnapshotId = await this.reconcilePlanningSnapshots(user.id, target.id);
    const roadmap = await this.reconcileRoadmap(user.id);
    const projectRunId = await this.reconcileProjectRun(user.id, target.id, roadmap.id, planSnapshotId, environment.seedFixtureRepository);
    return { schemaVersion: 1, userId: user.id, projectRunId, roadmapId: roadmap.id };
  }

  private async reconcileUser(email: string, password: string): Promise<User> {
    const seedUserId = this.uuid(`user:${email}`);
    let user = await this.users.findOne({ where: { email } });
    if (!user) {
      user = this.users.create({
        id: seedUserId, email, name: SEED_NAME,
        bio: null, profileImageUrl: null, externalLinks: {},
        passwordHash: await hashPassword(password), roles: ['USER'], status: UserStatus.Active,
      });
      return this.users.save(user);
    }
    if (user.id !== seedUserId) throw new Error('LOCAL_SEED_EMAIL belongs to a non-seed user');
    let changed = false;
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      user.passwordHash = await hashPassword(password);
      changed = true;
    }
    if (user.status !== UserStatus.Active) {
      user.status = UserStatus.Active;
      changed = true;
    }
    if (!user.roles.includes('USER')) {
      user.roles = [...user.roles, 'USER'];
      changed = true;
    }
    if (user.name !== SEED_NAME) {
      user.name = SEED_NAME;
      changed = true;
    }
    return changed ? this.users.save(user) : user;
  }

  private async reconcileEntitlement(ownerId: string): Promise<void> {
    let entitlement = await this.entitlements.findOne({ where: { ownerId } });
    if (!entitlement) {
      entitlement = this.entitlements.create({ ownerId, enabled: true, reason: 'dev-seed' });
    } else {
      entitlement.enabled = true;
      entitlement.reason = 'dev-seed';
    }
    await this.entitlements.save(entitlement);
    if (this.featureEntitlements) {
      await this.featureEntitlements.save(this.featureEntitlements.create({
        userId: ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: null,
        reason: 'dev-seed', updatedBy: 'dev-seed',
      }));
    }
  }

  private async reconcileProofProfile(ownerId: string): Promise<void> {
    const current = await this.career.getProofProfile(ownerId);
    if (current?.state === ProofProfileState.Enabled && current.displayName === SEED_NAME) return;
    await this.career.updateProofProfile(ownerId, {
      idempotencyKey: 'dev-seed-proof-profile-v1',
      state: ProofProfileState.Enabled,
      displayName: SEED_NAME,
      summary: 'Local project execution seed.',
    });
  }

  private async reconcileFixtureRepository(ownerId: string): Promise<void> {
    const installationId = this.uuid(`github-installation:${ownerId}`);
    const githubInstallationId = this.decimalId(`github-installation:${ownerId}`);
    const githubAccountId = this.decimalId(`github-account:${ownerId}`);
    const githubRepositoryId = '9000001';
    await this.dataSource.transaction(async (manager) => {
      const installations = manager.getRepository(GithubInstallation);
      const repositories = manager.getRepository(GithubInstallationRepository);
      let installation = await installations.findOne({ where: { id: installationId } });
      if (!installation) {
        installation = installations.create({
          id: installationId, ownerUserId: ownerId, githubInstallationId, githubAccountId,
          accountType: 'USER', status: GithubInstallationStatus.Active,
          suspendedAt: null, revokedAt: null,
        });
      } else {
        installation.ownerUserId = ownerId;
        installation.status = GithubInstallationStatus.Active;
        installation.suspendedAt = null;
        installation.revokedAt = null;
      }
      await installations.save(installation);
      let repository = await repositories.findOne({
        where: { installationId, githubRepositoryId },
      });
      if (!repository) {
        repository = repositories.create({
          installationId, githubRepositoryId, fullName: 'fixture/verification-repository',
          private: true, active: true, removedAt: null,
        });
      } else {
        repository.fullName = 'fixture/verification-repository';
        repository.private = true;
        repository.active = true;
        repository.removedAt = null;
      }
      await repositories.save(repository);
    });
  }

  private async reconcileTarget(ownerId: string): Promise<CareerTarget> {
    const existing = await this.targets.findOne({
      where: { userId: ownerId, company: SEED_TARGET_COMPANY, role: SEED_TARGET_ROLE },
    });
    if (existing) {
      if (existing.requirements !== SEED_REQUIREMENTS || !existing.competencySlugs?.includes('typescript')) {
        throw new Error('Reserved local seed target belongs to non-seed data');
      }
      return existing;
    }
    return this.career.createTarget(ownerId, {
      company: SEED_TARGET_COMPANY,
      role: SEED_TARGET_ROLE,
      requirements: SEED_REQUIREMENTS,
      competencySlugs: ['typescript'],
    });
  }

  private async reconcileRoadmap(ownerId: string): Promise<Roadmap> {
    const graph = {
      schemaVersion: 1 as const,
      nodes: [{
        id: 'seed-task-1', type: 'jagalchi-node' as const, position: { x: 0, y: 0 },
        data: { title: 'Complete the verified local task', state: 'READY' },
      }],
      edges: [],
    };
    const existing = await this.roadmapRepository.findOne({
      where: { ownerId, title: SEED_ROADMAP_TITLE },
    });
    if (existing) {
      if (!existing.tags?.includes('local-seed')) {
        throw new Error('Reserved local seed Roadmap belongs to non-seed data');
      }
      if (this.projectRuns && await this.projectRuns.exists({ where: { roadmapId: existing.id } })) {
        return existing;
      }
      return this.roadmaps.update(ownerId, existing.id, {
        description: 'Deterministic local Project Run starting dataset.',
        tags: ['local-seed', 'project-run'],
        visibility: RoadmapVisibility.Private,
        graph,
      });
    }
    return this.roadmaps.create(ownerId, {
      title: SEED_ROADMAP_TITLE,
      description: 'Deterministic local Project Run starting dataset.',
      tags: ['local-seed', 'project-run'],
      visibility: RoadmapVisibility.Private,
      graph,
    });
  }

  private async reconcilePlanningSnapshots(ownerId: string, targetId: string): Promise<string> {
    const profileId = this.uuid(`profile-snapshot:${ownerId}`);
    const diffId = this.uuid(`diff-snapshot:${ownerId}:${targetId}`);
    const setId = this.uuid(`proposal-set:${ownerId}:${targetId}`);
    const planId = this.uuid(`plan-snapshot:${ownerId}:${targetId}`);
    const blueprintIds = [
      'b1000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000003',
      'b1000000-0000-4000-8000-000000000004',
    ];
    await this.dataSource.transaction(async (manager) => {
      const profile = manager.getRepository(CandidateProfileSnapshot);
      if (!await profile.exists({ where: { id: profileId } })) await profile.save(profile.create({ id: profileId, ownerId, state: SnapshotState.Confirmed, sourceSnapshotId: null, schemaVersion: 1, payload: { source: 'dev-seed', confirmed: true } }));
      const diff = manager.getRepository(CareerDiffSnapshot);
      if (!await diff.exists({ where: { id: diffId } })) await diff.save(diff.create({ id: diffId, ownerId, careerTargetId: targetId, careerTargetVersionId: this.uuid(`target-version:${targetId}`), candidateProfileSnapshotId: profileId, state: SnapshotState.Confirmed, sourceSnapshotId: null, schemaVersion: 1, payload: { observed: [], inferred: [], missing: ['typescript'] } }));
      const sets = manager.getRepository(ProjectProposalSet);
      if (!await sets.exists({ where: { id: setId } })) await sets.save(sets.create({ id: setId, ownerId, careerDiffSnapshotId: diffId, schemaVersion: 1, payload: { source: 'dev-seed' } }));
      const proposals = manager.getRepository(ProjectProposal);
      for (let rank = 1; rank <= 3; rank += 1) {
        const id = this.uuid(`proposal:${setId}:${rank}`);
        const blueprintId = blueprintIds[rank - 1]!;
        if (!await proposals.exists({ where: { id } })) await proposals.save(proposals.create({ id, proposalSetId: setId, blueprintVersionId: blueprintId, rank, payload: { id: `local-seed-proposal-${rank}`, title: `Local seed proposal ${rank}`, projectBlueprintId: `blueprint-${rank}`, projectBlueprintVersion: 1, repositoryMode: rank === 1 ? 'MANUAL_GREENFIELD' : 'EXISTING_OWNED', citedGapIds: rank === 1 ? ['gap-1'] : [], citationIds: ['source-1'], boundedOutcome: 'Deliver a verified local feature slice.', nonGoals: ['No external provider access.'], durationHours: 20, difficulty: 'MEDIUM', evidenceRules: ['test:deterministic contract suite'], confidence: 1, rejectionReasons: [] } }));
      }
      const plans = manager.getRepository(ProjectPlanSnapshot);
      if (!await plans.exists({ where: { id: planId } })) await plans.save(plans.create({ id: planId, ownerId, projectProposalId: this.uuid(`proposal:${setId}:1`), careerDiffSnapshotId: diffId, candidateProfileSnapshotId: profileId, blueprintVersionId: blueprintIds[0]!, catalogVersion: 'v1', schemaVersion: 1, payload: { taskIds: ['seed-task-1'] } }));
      for (const blueprintId of blueprintIds) await manager.getRepository(ProjectBlueprintVersion).findOneByOrFail({ id: blueprintId });
    });
    return planId;
  }

  private async reconcileProjectRun(ownerId: string, targetId: string, roadmapId: string, planSnapshotId: string, fixtureRepository: boolean): Promise<string> {
    const kind = `DEV_SEED_PROJECT_RUN:${ownerId}`;
    const operationResult = await this.operations.createOrReplay({
      ownerId,
      route: '/internal/dev-seed/project-run',
      idempotencyKey: 'dev-seed-project-run-v1',
      kind,
      input: { schemaVersion: 1, targetId, roadmapId },
    });
    let workerId: string | undefined;
    if (operationResult.operation.state === WorkflowOperationState.Pending) {
      workerId = `dev-seed:${process.pid}`;
      const claimed = await this.operations.claim(workerId, 60_000, [kind]);
      if (!claimed || claimed.id !== operationResult.operation.id) {
        throw new Error('dev:seed could not claim its Project Run operation');
      }
    } else if (operationResult.operation.state !== WorkflowOperationState.Succeeded) {
      throw new Error('dev:seed Project Run operation is not recoverable');
    }
    const projection: Omit<ProjectRunProjection, 'id' | 'state' | 'version'> = {
      target: { company: SEED_TARGET_COMPANY, role: SEED_TARGET_ROLE },
      currentTaskId: null,
      recommendedTaskId: 'seed-task-1',
      plan: { id: 'local-seed-plan-v1', schemaVersion: 1 },
      map: {
        nodes: [{ id: 'seed-task-1', title: 'Complete the verified local task', milestoneId: 'seed-milestone-1', state: 'READY' }],
        edges: [],
      },
      tasks: [{
        id: 'seed-task-1', title: 'Complete the verified local task', state: 'READY', required: true,
        milestoneId: 'seed-milestone-1', prerequisiteIds: [],
        purpose: 'Exercise the real Project Run and Proof boundaries locally.',
        acceptanceCriteria: ['The configured verification adapter passes.'],
        evidenceRequirements: ['A bound pull request and required check pass.'],
      }],
      proof: null,
    };
    const created = await this.execution.createProjectRun({
      ownerId, proposalId: 'local-seed-proposal-v1', catalogVersion: 'local-seed-v1',
      targetId, competencySlugs: ['typescript'], projection,
      operationId: operationResult.operation.id,
      roadmapId,
      planSnapshotId,
      repository: fixtureRepository ? {
        mode: RepositoryMode.ExistingOwned,
        installationId: this.uuid(`github-installation:${ownerId}`),
        githubRepositoryId: '9000001',
        repositoryName: 'fixture/verification-repository', repositoryPrivate: true,
        bindingVersion: 1, pullNumber: 17, expectedHeadSha: 'a'.repeat(40),
      } : { mode: RepositoryMode.ManualGreenfield },
    });
    if (this.projectRuns && this.proofMissions) {
      const run = await this.projectRuns.findOne({ where: { id: created.projectRun.id, ownerId } });
      if (run && !run.proofMissionId) {
        const mission = await this.proofMissions.findOne({
          where: { ownerUserId: ownerId, targetId, competencySlug: 'typescript' },
          order: { createdAt: 'ASC' },
        });
        if (mission) { run.proofMissionId = mission.id; await this.projectRuns.save(run); }
      }
    }
    if (workerId) {
      const completed = await this.operations.succeed(
        operationResult.operation.id,
        workerId,
        { projectRunId: created.projectRun.id, roadmapId },
        { type: 'PROJECT_RUN', id: created.projectRun.id, href: `/api/project-runs/${created.projectRun.id}`, schemaVersion: 1 },
      );
      if (!completed) throw new Error('dev:seed lost its Project Run operation lease');
    }
    return created.projectRun.id;
  }

  private uuid(value: string): string {
    const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private decimalId(value: string): string {
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 14);
    return String(1_000_000_000_000_000n + (BigInt(`0x${digest}`) % 8_000_000_000_000_000n));
  }
}
