import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth-user';
import type { PullRequestFacts } from '../github/github.dto';
import { GithubService } from '../github/github.service';
import {
  CAREER_COMPETENCIES,
  detectCareerCompetencies,
  getCareerCompetency,
  normalizeCompetencySlugs,
} from './competency-catalog';
import {
  BindProofPullRequestDto,
  CreateCareerEvidenceDto,
  CreateCareerTargetDto,
  CreateProofMissionDto,
  PublishProofDto,
  PublicProofProfileV1Dto,
  ReplaceProofCriteriaDto,
  ReviewCareerEvidenceDto,
  ReviewProofMissionDto,
  UpdateProofProfileDto,
} from './career.dto';
import {
  CareerEvidence,
  CareerEvidenceStatus,
  CareerTarget,
  CareerTargetStatus,
  CommandIdempotencyKey,
  ProofCriterion,
  ProofCriterionConfig,
  ProofCriterionResult,
  ProofCriterionType,
  ProofMission,
  ProofMissionState,
  ProofProfile,
  ProofProfileState,
  ProofReview,
  ProofReviewDecision,
  ProofVerificationRun,
  ProofVerificationStatus,
  PublishedProof,
  PublishedProofState,
  PublicProofSnapshotV1,
} from './career.entities';

export type CareerDiffStatus = 'VERIFIED' | 'SUBMITTED' | 'MISSING';

const PUBLICATION_LEASE_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class CareerService {
  constructor(
    @InjectRepository(CareerTarget)
    private readonly targets: Repository<CareerTarget>,
    @InjectRepository(CareerEvidence)
    private readonly evidence: Repository<CareerEvidence>,
    @InjectRepository(ProofMission)
    private readonly missions: Repository<ProofMission>,
    @InjectRepository(ProofCriterion)
    private readonly criteria: Repository<ProofCriterion>,
    @InjectRepository(ProofVerificationRun)
    private readonly runs: Repository<ProofVerificationRun>,
    @InjectRepository(ProofReview)
    private readonly reviews: Repository<ProofReview>,
    @InjectRepository(ProofProfile)
    private readonly profiles: Repository<ProofProfile>,
    @InjectRepository(PublishedProof)
    private readonly publications: Repository<PublishedProof>,
    private readonly dataSource: DataSource,
    private readonly github: GithubService,
  ) {}

  listCompetencies() {
    return CAREER_COMPETENCIES.map(({ aliases: _aliases, ...competency }) => competency);
  }

  async createTarget(userId: string, dto: CreateCareerTargetDto): Promise<CareerTarget> {
    const explicit = this.validateCompetencySlugs(dto.competencySlugs);
    const detected = detectCareerCompetencies(`${dto.role}\n${dto.requirements}`);
    const competencySlugs = normalizeCompetencySlugs([...explicit, ...detected]);
    return this.targets.save(
      this.targets.create({
        userId,
        company: dto.company.trim(),
        role: dto.role.trim(),
        postingUrl: dto.postingUrl?.trim() || null,
        requirements: dto.requirements.trim(),
        competencySlugs,
      }),
    );
  }

  listTargets(userId: string): Promise<CareerTarget[]> {
    return this.targets.find({ where: { userId }, order: { updatedAt: 'DESC' } });
  }

  async createEvidence(userId: string, dto: CreateCareerEvidenceDto) {
    const competencySlugs = this.validateCompetencySlugs(dto.competencySlugs);
    const evidence = await this.evidence.save(
      this.evidence.create({
        userId,
        title: dto.title.trim(),
        url: dto.url.trim(),
        kind: dto.kind,
        description: dto.description?.trim() ?? '',
        competencySlugs,
        status: CareerEvidenceStatus.Submitted,
        reviewerId: null,
        reviewNote: null,
        reviewedAt: null,
      }),
    );
    return this.projectCareerEvidenceForOwner(evidence);
  }

  async listEvidence(userId: string) {
    const evidence = await this.evidence.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return evidence.map((item) => this.projectCareerEvidenceForOwner(item));
  }

  async getDiff(userId: string, targetId: string) {
    const target = await this.targets.findOne({ where: { id: targetId, userId } });
    if (!target) throw new NotFoundException('Career target not found');
    const [evidence, missions] = await Promise.all([
      this.listEvidence(userId),
      this.missions.find({ where: { ownerUserId: userId, targetId } }),
    ]);
    const runIds = missions.flatMap((mission) =>
      mission.currentVerificationRunId ? [mission.currentVerificationRunId] : [],
    );
    const currentRuns = runIds.length
      ? await this.runs.find({ where: { id: In(runIds) } })
      : [];
    const runById = new Map(currentRuns.map((run) => [run.id, run]));

    const competencies = target.competencySlugs.map((slug) => {
      const competency = getCareerCompetency(slug);
      if (!competency) throw new BadRequestException(`Unknown career competency: ${slug}`);
      const scoped = missions.filter(
        (mission) => mission.competencySlug === slug && mission.state !== ProofMissionState.Archived,
      );
      const verified = scoped.some((mission) => {
        const run = mission.currentVerificationRunId
          ? runById.get(mission.currentVerificationRunId)
          : undefined;
        return (
          mission.state === ProofMissionState.Approved &&
          Boolean(mission.currentReviewId) &&
          run?.status === ProofVerificationStatus.Pass &&
          run.bindingVersion === mission.bindingVersion &&
          run.criteriaVersion === mission.criteriaVersion
        );
      });
      const submitted = scoped.some((mission) => {
        const run = mission.currentVerificationRunId
          ? runById.get(mission.currentVerificationRunId)
          : undefined;
        return (
          mission.state === ProofMissionState.ReviewPending &&
          run?.status === ProofVerificationStatus.Pass &&
          run.bindingVersion === mission.bindingVersion &&
          run.criteriaVersion === mission.criteriaVersion
        );
      });
      const supportingEvidence = evidence.filter(
        (item) => item.competencySlugs.includes(slug) && item.status !== CareerEvidenceStatus.Rejected,
      );
      const status: CareerDiffStatus = verified ? 'VERIFIED' : submitted ? 'SUBMITTED' : 'MISSING';
      return {
        slug,
        label: competency.label,
        category: competency.category,
        description: competency.description,
        status,
        evidence: supportingEvidence.map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          kind: item.kind,
          status: item.status,
          reviewNote: item.reviewNote,
          creditEligible: false,
        })),
      };
    });
    const verifiedCount = competencies.filter((item) => item.status === 'VERIFIED').length;
    const submittedCount = competencies.filter((item) => item.status === 'SUBMITTED').length;
    const requiredCount = competencies.length;
    return {
      target,
      summary: {
        requiredCount,
        verifiedCount,
        submittedCount,
        missingCount: requiredCount - verifiedCount - submittedCount,
        verifiedPercentage: requiredCount ? Math.round((verifiedCount / requiredCount) * 100) : 0,
      },
      competencies,
    };
  }

  async listReviewQueue(user: AuthUser) {
    this.assertReviewer(user);
    const evidence = await this.evidence.find({
      where: { status: CareerEvidenceStatus.Submitted },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    return evidence.map((item) => this.projectCareerEvidenceForReviewer(item));
  }

  async reviewEvidence(
    user: AuthUser,
    evidenceId: string,
    dto: ReviewCareerEvidenceDto,
  ) {
    this.assertReviewer(user);
    if (![CareerEvidenceStatus.Verified, CareerEvidenceStatus.Rejected].includes(dto.status)) {
      throw new BadRequestException('Review must verify or reject evidence');
    }
    if (dto.status === CareerEvidenceStatus.Rejected && !dto.reviewNote?.trim()) {
      throw new BadRequestException('Rejected evidence requires a review note');
    }
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CareerEvidence);
      const evidence = await repository.findOne({
        where: { id: evidenceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!evidence) throw new NotFoundException('Career evidence not found');
      if (evidence.userId === user.id) throw new ForbiddenException('Self-review is not allowed');
      if (evidence.status !== CareerEvidenceStatus.Submitted) {
        throw new ConflictException('Career evidence has already been reviewed');
      }
      evidence.status = dto.status;
      evidence.reviewerId = user.id;
      evidence.reviewNote = dto.reviewNote?.trim() || null;
      evidence.reviewedAt = new Date();
      const reviewed = await repository.save(evidence);
      return this.projectCareerEvidenceForReviewer(reviewed);
    });
  }

  async createMission(userId: string, dto: CreateProofMissionDto) {
    const target = await this.targets.findOne({
      where: { id: dto.targetId, userId, status: CareerTargetStatus.Active },
    });
    if (!target) throw new NotFoundException('Active career target not found');
    if (!target.competencySlugs.includes(dto.competencySlug)) {
      throw new BadRequestException('Competency does not belong to the target');
    }
    return this.dataSource.transaction(async (manager) => {
      const replay = await this.claimCommand(manager, userId, 'CREATE_MISSION', dto);
      if (replay.replayed && replay.resourceId) {
        return this.getMissionProjection(userId, replay.resourceId, manager);
      }
      const mission = await manager.getRepository(ProofMission).save(
        manager.getRepository(ProofMission).create({
          ownerUserId: userId,
          targetId: dto.targetId,
          competencySlug: dto.competencySlug,
          title: dto.title.trim(),
          summary: dto.summary?.trim() || null,
          state: ProofMissionState.Draft,
          criteriaVersion: 1,
          bindingVersion: 0,
          installationId: null,
          githubRepositoryId: null,
          pullNumber: null,
          repositoryName: null,
          repositoryPrivate: null,
          pullTitle: null,
          pullUrl: null,
          currentVerificationRunId: null,
          currentReviewId: null,
        }),
      );
      replay.resourceId = mission.id;
      await manager.getRepository(CommandIdempotencyKey).save(replay);
      return this.getMissionProjection(userId, mission.id, manager);
    });
  }

  async listMissions(userId: string, targetId?: string) {
    if (targetId && !(await this.targets.exists({ where: { id: targetId, userId } }))) {
      throw new NotFoundException('Career target not found');
    }
    const rows = await this.missions.find({
      where: targetId ? { ownerUserId: userId, targetId } : { ownerUserId: userId },
      order: { updatedAt: 'DESC' },
    });
    return Promise.all(rows.map((mission) => this.getMissionProjection(userId, mission.id)));
  }

  getMission(userId: string, missionId: string) {
    return this.getMissionProjection(userId, missionId);
  }

  async replaceCriteria(userId: string, missionId: string, dto: ReplaceProofCriteriaDto) {
    const inputs = dto.criteria.map((criterion, position) => ({
      position,
      type: criterion.type,
      config: this.validateCriterionConfig(criterion.type, criterion.config),
    }));
    return this.dataSource.transaction(async (manager) => {
      const mission = await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `REPLACE_CRITERIA:${missionId}`,
        dto,
        missionId,
      );
      if (command.replayed) return this.getMissionProjection(userId, missionId, manager);
      if (![ProofMissionState.Draft, ProofMissionState.Bound, ProofMissionState.Returned].includes(mission.state)) {
        throw new ConflictException('Criteria cannot be changed in the current mission state');
      }
      await manager.getRepository(ProofCriterion).delete({ missionId });
      await manager.getRepository(ProofCriterion).save(
        inputs.map((input) => manager.getRepository(ProofCriterion).create({ missionId, ...input })),
      );
      mission.criteriaVersion += 1;
      mission.state = mission.installationId ? ProofMissionState.Bound : ProofMissionState.Draft;
      this.clearEligibility(mission);
      await manager.getRepository(ProofMission).save(mission);
      await this.invalidatePublications(manager, missionId);
      return this.getMissionProjection(userId, missionId, manager);
    });
  }

  async bindPullRequest(userId: string, missionId: string, dto: BindProofPullRequestDto) {
    await this.github.authorizeRepository(userId, dto.installationId, dto.githubRepositoryId);
    const binding = await this.github.resolvePullRequestBinding(
      userId,
      dto.installationId,
      dto.githubRepositoryId,
      dto.pullNumber,
    );
    return this.dataSource.transaction(async (manager) => {
      await this.lockInstallation(manager, userId, dto.installationId, dto.githubRepositoryId);
      const mission = await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `BIND_PR:${missionId}`,
        dto,
        missionId,
      );
      if (command.replayed) return this.getMissionProjection(userId, missionId, manager);
      if (mission.state === ProofMissionState.Archived) throw new ConflictException('Mission is archived');
      mission.installationId = dto.installationId;
      mission.githubRepositoryId = binding.repositoryId;
      mission.pullNumber = binding.pullNumber;
      mission.repositoryName = binding.repositoryName;
      mission.repositoryPrivate = binding.repositoryPrivate;
      mission.pullTitle = binding.pullTitle;
      mission.pullUrl = binding.pullUrl;
      mission.bindingVersion += 1;
      mission.state = ProofMissionState.Bound;
      this.clearEligibility(mission);
      await manager.getRepository(ProofMission).save(mission);
      await this.invalidatePublications(manager, missionId);
      return this.getMissionProjection(userId, missionId, manager);
    });
  }

  async refreshVerification(userId: string, missionId: string, idempotencyKey: string) {
    const snapshot = await this.requireOwnedBoundMission(userId, missionId);
    const facts = await this.github.getPullRequestFacts(
      userId,
      snapshot.installationId!,
      snapshot.githubRepositoryId!,
      snapshot.pullNumber!,
    );
    const criteria = await this.criteria.find({ where: { missionId }, order: { position: 'ASC' } });
    if (!criteria.length) throw new ConflictException('Mission must have criteria before refresh');
    const results = this.evaluateCriteria(criteria, facts);
    const status = this.machineCriteriaPassed(results)
      ? ProofVerificationStatus.Pass
      : ProofVerificationStatus.Fail;
    const criteriaDigest = this.digest(
      criteria.map(({ position, type, config }) => ({ position, type, config })),
    );
    const factsDigest = this.digest({
      ...facts,
      changedPaths: [...facts.changedPaths].sort(),
      checks: [...facts.checks].sort((a, b) => a.name.localeCompare(b.name)),
      statuses: [...facts.statuses].sort((a, b) => a.context.localeCompare(b.context)),
    });

    return this.dataSource.transaction(async (manager) => {
      await this.lockInstallation(
        manager,
        userId,
        snapshot.installationId!,
        snapshot.githubRepositoryId!,
      );
      const mission = await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `REFRESH:${missionId}`,
        { idempotencyKey },
        missionId,
      );
      if (command.replayed) return this.getMissionProjection(userId, missionId, manager);
      this.assertBindingUnchanged(mission, snapshot);
      if (facts.repositoryId !== mission.githubRepositoryId || facts.pullNumber !== mission.pullNumber) {
        throw new ConflictException('Provider facts do not match mission binding');
      }
      const runRepository = manager.getRepository(ProofVerificationRun);
      let run = await runRepository.findOne({
        where: {
          missionId,
          bindingVersion: mission.bindingVersion,
          criteriaVersion: mission.criteriaVersion,
          headSha: facts.headSha,
          criteriaDigest,
          factsDigest,
        },
      });
      if (!run) {
        run = await runRepository.save(
          runRepository.create({
            missionId,
            bindingVersion: mission.bindingVersion,
            criteriaVersion: mission.criteriaVersion,
            headSha: facts.headSha,
            criteriaDigest,
            factsDigest,
            status,
            results,
            observedAt: new Date(),
          }),
        );
      }
      mission.currentVerificationRunId = run.id;
      mission.currentReviewId = null;
      mission.state = ProofMissionState.Bound;
      await manager.getRepository(ProofMission).save(mission);
      await this.invalidatePublications(manager, missionId);
      return this.getMissionProjection(userId, missionId, manager);
    });
  }

  async submitForReview(userId: string, missionId: string, idempotencyKey: string) {
    return this.dataSource.transaction(async (manager) => {
      const mission = await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `SUBMIT:${missionId}`,
        { idempotencyKey },
        missionId,
      );
      if (command.replayed) return this.getMissionProjection(userId, missionId, manager);
      if (![ProofMissionState.Bound, ProofMissionState.Returned].includes(mission.state)) {
        if (mission.state === ProofMissionState.ReviewPending) {
          return this.getMissionProjection(userId, missionId, manager);
        }
        throw new ConflictException('Mission is not ready for review');
      }
      const run = await this.requireCurrentPassingRun(manager, mission);
      if (await manager.getRepository(ProofReview).exists({ where: { verificationRunId: run.id } })) {
        throw new ConflictException('This verification run has already been decided');
      }
      mission.state = ProofMissionState.ReviewPending;
      await manager.getRepository(ProofMission).save(mission);
      return this.getMissionProjection(userId, missionId, manager);
    });
  }

  async listProofReviewQueue(user: AuthUser) {
    this.assertReviewer(user);
    const missions = await this.missions.find({
      where: { state: ProofMissionState.ReviewPending },
      order: { updatedAt: 'ASC' },
      take: 100,
    });
    return Promise.all(missions.map((mission) => this.getMissionProjectionForReviewer(mission.id)));
  }

  async reviewMission(user: AuthUser, missionId: string, dto: ReviewProofMissionDto) {
    this.assertReviewer(user);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const mission = await manager.getRepository(ProofMission).findOne({
        where: { id: missionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!mission) throw new NotFoundException('Proof mission not found');
      if (mission.ownerUserId === user.id) throw new ForbiddenException('Self-review is not allowed');
      const command = await this.claimCommand(
        manager,
        user.id,
        `REVIEW:${missionId}`,
        dto,
        missionId,
      );
      if (command.replayed) {
        return {
          staleHead: false,
          projection: await this.getMissionProjectionForReviewer(missionId, manager),
        };
      }
      if (mission.state !== ProofMissionState.ReviewPending) {
        throw new ConflictException('Mission is not awaiting review');
      }
      const run = await this.requireCurrentPassingRun(manager, mission);
      const head = await this.github.getPullRequestHead(
        mission.ownerUserId,
        mission.installationId!,
        mission.githubRepositoryId!,
        mission.pullNumber!,
      );
      if (head.headSha !== run.headSha) {
        mission.state = ProofMissionState.Bound;
        this.clearEligibility(mission);
        await manager.getRepository(ProofMission).save(mission);
        await this.invalidatePublications(manager, missionId);
        await manager.getRepository(CommandIdempotencyKey).delete(command.id);
        return { staleHead: true, projection: null };
      }
      const reviewRepository = manager.getRepository(ProofReview);
      if (await reviewRepository.exists({ where: { verificationRunId: run.id } })) {
        throw new ConflictException('This verification run has already been reviewed');
      }
      const review = await reviewRepository.save(
        reviewRepository.create({
          missionId,
          verificationRunId: run.id,
          reviewerId: user.id,
          decision: dto.decision,
          note: dto.note?.trim() || null,
        }),
      );
      mission.currentReviewId = review.id;
      mission.state =
        dto.decision === ProofReviewDecision.Approved
          ? ProofMissionState.Approved
          : ProofMissionState.Returned;
      if (dto.decision === ProofReviewDecision.Returned) {
        await this.invalidatePublications(manager, missionId);
      }
      await manager.getRepository(ProofMission).save(mission);
      return {
        staleHead: false,
        projection: await this.getMissionProjectionForReviewer(missionId, manager),
      };
    });
    if (outcome.staleHead) {
      throw new ConflictException('Pull request head changed; refresh and re-review are required');
    }
    return outcome.projection;
  }

  async archiveMission(userId: string, missionId: string, idempotencyKey: string) {
    return this.dataSource.transaction(async (manager) => {
      const mission = await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `ARCHIVE:${missionId}`,
        { idempotencyKey },
        missionId,
      );
      if (command.replayed) return this.getMissionProjection(userId, missionId, manager);
      if (mission.state === ProofMissionState.ReviewPending) {
        throw new ConflictException('A review-pending mission cannot be archived');
      }
      mission.state = ProofMissionState.Archived;
      this.clearEligibility(mission);
      await manager.getRepository(ProofMission).save(mission);
      await this.invalidatePublications(manager, missionId);
      return this.getMissionProjection(userId, missionId, manager);
    });
  }

  async getProofProfile(userId: string) {
    const profile = await this.profiles.findOne({ where: { ownerUserId: userId } });
    if (!profile) return null;
    const proofs = await this.publications.find({
      where: { profileId: profile.id },
      order: { updatedAt: 'DESC' },
    });
    return { ...profile, proofs };
  }

  async updateProofProfile(userId: string, dto: UpdateProofProfileDto) {
    return this.dataSource.transaction(async (manager) => {
      const command = await this.claimCommand(manager, userId, 'UPDATE_PROFILE', dto);
      const repository = manager.getRepository(ProofProfile);
      let profile = await repository.findOne({
        where: { ownerUserId: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (command.replayed) return profile;
      if (!profile) {
        profile = repository.create({
          ownerUserId: userId,
          publicId: randomBytes(20).toString('base64url'),
          state: dto.state,
          displayName: dto.displayName.trim(),
          summary: dto.summary?.trim() || null,
        });
      } else {
        profile.state = dto.state;
        profile.displayName = dto.displayName.trim();
        profile.summary = dto.summary?.trim() || null;
      }
      profile = await repository.save(profile);
      if (dto.state === ProofProfileState.Disabled) {
        await manager.getRepository(PublishedProof).update(
          { profileId: profile.id, state: PublishedProofState.Active },
          { state: PublishedProofState.Unpublished },
        );
      }
      return profile;
    });
  }

  async publishProof(userId: string, missionId: string, dto: PublishProofDto) {
    const snapshot = await this.requireOwnedBoundMission(userId, missionId);
    await this.github.authorizeRepository(
      userId,
      snapshot.installationId!,
      snapshot.githubRepositoryId!,
    );
    const providerHead = await this.github.getPullRequestHead(
      userId,
      snapshot.installationId!,
      snapshot.githubRepositoryId!,
      snapshot.pullNumber!,
    );
    const outcome = await this.dataSource.transaction(async (manager) => {
      await this.lockInstallation(
        manager,
        userId,
        snapshot.installationId!,
        snapshot.githubRepositoryId!,
      );
      const mission = await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `PUBLISH:${missionId}`,
        dto,
        missionId,
      );
      if (command.replayed) {
        const profile = await manager.getRepository(ProofProfile).findOne({
          where: { ownerUserId: userId },
        });
        if (!profile) throw new ConflictException('Proof Profile is unavailable');
        const publication = await manager.getRepository(PublishedProof).findOne({
          where: { profileId: profile.id, missionId },
        });
        if (!publication) throw new ConflictException('Published proof is unavailable');
        return publication;
      }
      this.assertBindingUnchanged(mission, snapshot);
      if (mission.state !== ProofMissionState.Approved || !mission.currentReviewId) {
        throw new ConflictException('Mission does not have a current approval');
      }
      const run = await this.requireCurrentPassingRun(manager, mission);
      if (providerHead.headSha !== run.headSha) {
        mission.state = ProofMissionState.Bound;
        this.clearEligibility(mission);
        await manager.getRepository(ProofMission).save(mission);
        await this.invalidatePublications(manager, missionId);
        await manager.getRepository(CommandIdempotencyKey).delete(command.id);
        return { invalidatedByHeadChange: true } as const;
      }
      const review = await manager.getRepository(ProofReview).findOne({
        where: {
          id: mission.currentReviewId,
          missionId,
          verificationRunId: run.id,
          decision: ProofReviewDecision.Approved,
        },
      });
      if (!review || !review.reviewerId || review.reviewerId === userId) {
        throw new ConflictException('Mission does not have an eligible non-self approval');
      }
      const profile = await manager.getRepository(ProofProfile).findOne({
        where: { ownerUserId: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile || profile.state !== ProofProfileState.Enabled) {
        throw new ConflictException('Proof Profile must be enabled before publishing');
      }
      const criteria = await manager.getRepository(ProofCriterion).find({
        where: { missionId },
        order: { position: 'ASC' },
      });
      const competency = getCareerCompetency(mission.competencySlug);
      if (!competency) throw new ConflictException('Mission competency is unavailable');
      const publicationRepository = manager.getRepository(PublishedProof);
      let publication = await publicationRepository.findOne({
        where: { profileId: profile.id, missionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (publication && publication.validUntil.getTime() <= Date.now()) {
        throw new ConflictException('Publication lease expired; renew the publication lease before publishing');
      }
      const publicProofId = publication?.snapshot.publicProofId ?? randomBytes(20).toString('base64url');
      const safeSnapshot: PublicProofSnapshotV1 = {
        schemaVersion: 1,
        publicProofId,
        title: mission.title,
        summary: mission.summary,
        competencyLabel: competency.label,
        provider: 'GITHUB',
        verification: { status: 'VERIFIED', verifiedAt: review.reviewedAt.toISOString() },
        criteria: {
          passedCount: criteria.filter((criterion) =>
            criterion.type === ProofCriterionType.HumanCheck ||
            run.results.some((result) =>
              result.criterionId === criterion.id &&
              result.type !== ProofCriterionType.HumanCheck &&
              result.passed,
            ),
          ).length,
          totalCount: criteria.length,
          types: [...new Set(criteria.map((criterion) => criterion.type))],
        },
      };
      const validUntil = publication?.validUntil ?? new Date(Date.now() + PUBLICATION_LEASE_MS);
      if (!publication) {
        publication = publicationRepository.create({
          profileId: profile.id,
          missionId,
          verificationRunId: run.id,
          reviewId: review.id,
          state: PublishedProofState.Active,
          schemaVersion: 1,
          snapshot: safeSnapshot,
          validUntil,
        });
      } else {
        publication.verificationRunId = run.id;
        publication.reviewId = review.id;
        publication.state = PublishedProofState.Active;
        publication.schemaVersion = 1;
        publication.snapshot = safeSnapshot;
        publication.validUntil = validUntil;
      }
      return publicationRepository.save(publication);
    });
    if ('invalidatedByHeadChange' in outcome) {
      throw new ConflictException('Pull request head changed; refresh and re-review are required');
    }
    return outcome;
  }

  async unpublishProof(userId: string, missionId: string, idempotencyKey: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `UNPUBLISH:${missionId}`,
        { idempotencyKey },
        missionId,
      );
      if (command.replayed) return { unpublished: true };
      const profile = await manager.getRepository(ProofProfile).findOne({
        where: { ownerUserId: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) return { unpublished: true };
      await manager.getRepository(PublishedProof).update(
        { profileId: profile.id, missionId, state: PublishedProofState.Active },
        { state: PublishedProofState.Unpublished },
      );
      return { unpublished: true };
    });
  }

  async renewPublicationLease(userId: string, missionId: string, idempotencyKey: string) {
    const snapshot = await this.requireOwnedBoundMission(userId, missionId);
    const facts = await this.github.getPullRequestFacts(
      userId,
      snapshot.installationId!,
      snapshot.githubRepositoryId!,
      snapshot.pullNumber!,
    );
    const criteria = await this.criteria.find({
      where: { missionId },
      order: { position: 'ASC' },
    });
    const results = this.evaluateCriteria(criteria, facts);
    const criteriaDigest = this.digest(
      criteria.map(({ position, type, config }) => ({ position, type, config })),
    );
    const factsDigest = this.digest({
      ...facts,
      changedPaths: [...facts.changedPaths].sort(),
      checks: [...facts.checks].sort((a, b) => a.name.localeCompare(b.name)),
      statuses: [...facts.statuses].sort((a, b) => a.context.localeCompare(b.context)),
    });
    const outcome = await this.dataSource.transaction(async (manager) => {
      await this.lockInstallation(
        manager,
        userId,
        snapshot.installationId!,
        snapshot.githubRepositoryId!,
      );
      const mission = await this.lockOwnedMission(manager, userId, missionId);
      const command = await this.claimCommand(
        manager,
        userId,
        `RENEW_PUBLICATION:${missionId}`,
        { idempotencyKey },
        missionId,
      );
      this.assertBindingUnchanged(mission, snapshot);
      const run = await this.requireCurrentPassingRun(manager, mission);
      if (
        mission.state !== ProofMissionState.Approved ||
        !mission.currentReviewId ||
        facts.headSha !== run.headSha ||
        criteriaDigest !== run.criteriaDigest ||
        factsDigest !== run.factsDigest ||
        !this.machineCriteriaPassed(results)
      ) {
        mission.state = ProofMissionState.Bound;
        this.clearEligibility(mission);
        await manager.getRepository(ProofMission).save(mission);
        await this.invalidatePublications(manager, missionId);
        await manager.getRepository(CommandIdempotencyKey).delete(command.id);
        return { renewed: false as const };
      }
      const review = await manager.getRepository(ProofReview).findOne({
        where: {
          id: mission.currentReviewId,
          missionId,
          verificationRunId: run.id,
          decision: ProofReviewDecision.Approved,
        },
      });
      if (!review || !review.reviewerId || review.reviewerId === userId) {
        throw new ConflictException('Mission does not have an eligible non-self approval');
      }
      const profile = await manager.getRepository(ProofProfile).findOne({
        where: { ownerUserId: userId, state: ProofProfileState.Enabled },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) throw new ConflictException('Proof Profile is unavailable');
      const publication = await manager.getRepository(PublishedProof).findOne({
        where: {
          profileId: profile.id,
          missionId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!publication) throw new ConflictException('Active published proof is unavailable');
      if (
        publication.state === PublishedProofState.Active &&
        (
          publication.verificationRunId !== run.id ||
          publication.reviewId !== mission.currentReviewId
        )
      ) {
        throw new ConflictException('Active published proof is unavailable');
      }
      if (!command.replayed) {
        if (publication.state !== PublishedProofState.Active) {
          publication.verificationRunId = run.id;
          publication.reviewId = review.id;
        }
        publication.validUntil = new Date(Date.now() + PUBLICATION_LEASE_MS);
        await manager.getRepository(PublishedProof).save(publication);
      }
      return { renewed: true as const, validUntil: publication.validUntil };
    });
    if (!outcome.renewed) {
      throw new ConflictException('Verification changed; refresh and re-review are required');
    }
    return outcome;
  }

  async getPublicProofProfile(publicId: string): Promise<PublicProofProfileV1Dto> {
    const rows = await this.dataSource.query(
      `SELECT profile.public_id,
              profile.display_name,
              profile.summary AS profile_summary,
              profile.updated_at,
              publication.snapshot
         FROM proof_profiles profile
         JOIN published_proofs publication ON publication.profile_id = profile.id
         JOIN proof_missions mission ON mission.id = publication.mission_id
         JOIN proof_verification_runs run
           ON run.id = publication.verification_run_id AND run.mission_id = mission.id
         JOIN proof_reviews review
           ON review.id = publication.review_id
          AND review.mission_id = mission.id
          AND review.verification_run_id = run.id
         JOIN github_installations installation ON installation.id = mission.installation_id
         JOIN github_installation_repositories repository
           ON repository.installation_id = mission.installation_id
          AND repository.github_repository_id = mission.github_repository_id
        WHERE profile.public_id = $1
          AND profile.state = 'ENABLED'
          AND publication.state = 'ACTIVE'
          AND publication.valid_until > $2
          AND mission.state = 'APPROVED'
          AND mission.current_verification_run_id = run.id
          AND mission.current_review_id = review.id
          AND run.status = 'PASS'
          AND run.binding_version = mission.binding_version
          AND run.criteria_version = mission.criteria_version
          AND review.decision = 'APPROVED'
          AND review.reviewer_id IS NOT NULL
          AND review.reviewer_id <> mission.owner_user_id
          AND installation.status = 'ACTIVE'
          AND repository.active = true
        ORDER BY publication.updated_at DESC`,
      [publicId, new Date()],
    ) as unknown[];
    return this.projectPublicProofProfile(rows);
  }

  async invalidateProviderEligibility(input: {
    installationId: string;
    githubRepositoryId?: string;
    pullNumber?: number;
  }): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT id FROM github_installations WHERE id = $1 FOR UPDATE', [
        input.installationId,
      ]);
      const query = manager
        .getRepository(ProofMission)
        .createQueryBuilder('mission')
        .setLock('pessimistic_write')
        .where('mission.installation_id = :installationId', { installationId: input.installationId });
      if (input.githubRepositoryId) {
        query.andWhere('mission.github_repository_id = :repositoryId', {
          repositoryId: input.githubRepositoryId,
        });
      }
      if (input.pullNumber) query.andWhere('mission.pull_number = :pullNumber', input);
      query.orderBy('mission.id', 'ASC');
      const missions = await query.getMany();
      for (const mission of missions.sort((a, b) => a.id.localeCompare(b.id))) {
        if (mission.state === ProofMissionState.Archived) continue;
        mission.state = ProofMissionState.Bound;
        this.clearEligibility(mission);
        await manager.getRepository(ProofMission).save(mission);
        await this.invalidatePublications(manager, mission.id);
      }
      return missions.length;
    });
  }

  evaluateCriteria(criteria: ProofCriterion[], facts: PullRequestFacts): ProofCriterionResult[] {
    return criteria
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((criterion) => {
        let passed = false;
        let detail = 'Criterion did not pass';
        switch (criterion.type) {
          case ProofCriterionType.MergedPr:
            passed = facts.merged;
            detail = passed ? 'Pull request is merged' : 'Pull request is not merged';
            break;
          case ProofCriterionType.BaseBranch: {
            const branch = (criterion.config as { branch: string }).branch;
            passed = facts.baseBranch === branch;
            detail = passed ? 'Base branch matches' : 'Base branch does not match';
            break;
          }
          case ProofCriterionType.ChangedPath: {
            const glob = (criterion.config as { glob: string }).glob;
            passed = facts.changedPaths.some((path) => this.matchesPathGlob(path, glob));
            detail = passed ? 'A changed path matches' : 'No changed path matches';
            break;
          }
          case ProofCriterionType.NamedCheck: {
            const context = (criterion.config as { context: string }).context;
            const matching = [
              ...facts.checks
                .filter((check) => check.name === context)
                .map((check) => check.successful),
              ...facts.statuses
                .filter((status) => status.context === context)
                .map((status) => status.successful),
            ];
            passed = matching.length > 0 && matching.every(Boolean);
            detail = passed ? 'Named check succeeded' : 'Named check is absent or unsuccessful';
            break;
          }
          case ProofCriterionType.HumanCheck:
            passed = false;
            detail = 'Pending confirmation by a non-self human reviewer';
            break;
        }
        return {
          criterionId: criterion.id,
          position: criterion.position,
          type: criterion.type,
          passed,
          detail,
        };
      });
  }

  private machineCriteriaPassed(results: ProofCriterionResult[]): boolean {
    return results
      .filter((result) => result.type !== ProofCriterionType.HumanCheck)
      .every((result) => result.passed);
  }

  private projectPublicProofProfile(rows: unknown[]): PublicProofProfileV1Dto {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException('Proof Profile not found');
    }
    const first = this.publicRow(rows[0]);
    const profile = {
      publicId: this.stringField(first, 'public_id'),
      displayName: this.stringField(first, 'display_name'),
      summary: this.nullableStringField(first, 'profile_summary'),
    };
    const updatedAt = this.isoDateField(first, 'updated_at');
    if (
      !/^[A-Za-z0-9_-]{27}$/.test(profile.publicId) ||
      profile.displayName.length < 1 ||
      profile.displayName.length > 100 ||
      (profile.summary !== null && profile.summary.length > 1_000)
    ) {
      throw new NotFoundException('Proof Profile not found');
    }
    const proofs = rows.map((value) => {
      const row = this.publicRow(value);
      if (
        this.stringField(row, 'public_id') !== profile.publicId ||
        this.stringField(row, 'display_name') !== profile.displayName ||
        this.nullableStringField(row, 'profile_summary') !== profile.summary ||
        this.isoDateField(row, 'updated_at') !== updatedAt
      ) {
        throw new NotFoundException('Proof Profile not found');
      }
      return this.projectPublicSnapshot(row.snapshot);
    });
    return { schemaVersion: 1, profile, proofs, updatedAt };
  }

  private projectPublicSnapshot(value: unknown): PublicProofProfileV1Dto['proofs'][number] {
    const snapshot = this.publicRow(value);
    if (snapshot.schemaVersion !== 1 || snapshot.provider !== 'GITHUB') {
      throw new NotFoundException('Proof Profile not found');
    }
    const verification = this.publicRow(snapshot.verification);
    const criteria = this.publicRow(snapshot.criteria);
    if (verification.status !== 'VERIFIED') {
      throw new NotFoundException('Proof Profile not found');
    }
    const passedCount = criteria.passedCount;
    const totalCount = criteria.totalCount;
    const types = criteria.types;
    const validTypes = new Set(Object.values(ProofCriterionType));
    if (
      !Number.isInteger(passedCount) ||
      !Number.isInteger(totalCount) ||
      (passedCount as number) < 0 ||
      (totalCount as number) < 1 ||
      (passedCount as number) > (totalCount as number) ||
      !Array.isArray(types) ||
      types.length < 1 ||
      !types.every((type) => typeof type === 'string' && validTypes.has(type as ProofCriterionType)) ||
      new Set(types).size !== types.length
    ) {
      throw new NotFoundException('Proof Profile not found');
    }
    const publicProofId = this.stringField(snapshot, 'publicProofId');
    const title = this.stringField(snapshot, 'title');
    const summary = this.nullableStringField(snapshot, 'summary');
    const competencyLabel = this.stringField(snapshot, 'competencyLabel');
    if (
      !/^[A-Za-z0-9_-]{27}$/.test(publicProofId) ||
      title.length < 1 ||
      title.length > 160 ||
      (summary !== null && summary.length > 1_000) ||
      competencyLabel.length < 1
    ) {
      throw new NotFoundException('Proof Profile not found');
    }
    return {
      publicProofId,
      title,
      summary,
      competencyLabel,
      provider: 'GITHUB',
      verification: {
        status: 'VERIFIED',
        verifiedAt: this.isoDateField(verification, 'verifiedAt'),
      },
      criteria: {
        passedCount: passedCount as number,
        totalCount: totalCount as number,
        types: types as ProofCriterionType[],
      },
    };
  }

  private publicRow(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new NotFoundException('Proof Profile not found');
    }
    return value as Record<string, unknown>;
  }

  private stringField(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (typeof value !== 'string') throw new NotFoundException('Proof Profile not found');
    return value;
  }

  private nullableStringField(row: Record<string, unknown>, key: string): string | null {
    const value = row[key];
    if (value !== null && typeof value !== 'string') {
      throw new NotFoundException('Proof Profile not found');
    }
    return value;
  }

  private isoDateField(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      throw new NotFoundException('Proof Profile not found');
    }
    return date.toISOString();
  }

  private async getMissionProjection(
    ownerUserId: string,
    missionId: string,
    manager?: EntityManager,
  ) {
    const missionRepository = manager?.getRepository(ProofMission) ?? this.missions;
    const mission = await missionRepository.findOne({ where: { id: missionId, ownerUserId } });
    if (!mission) throw new NotFoundException('Proof mission not found');
    return this.projectMission(mission, manager);
  }

  private async getMissionProjectionForReviewer(missionId: string, manager?: EntityManager) {
    const missionRepository = manager?.getRepository(ProofMission) ?? this.missions;
    const criterionRepository = manager?.getRepository(ProofCriterion) ?? this.criteria;
    const runRepository = manager?.getRepository(ProofVerificationRun) ?? this.runs;
    const mission = await missionRepository.findOne({ where: { id: missionId } });
    if (!mission) throw new NotFoundException('Proof mission not found');
    const competency = getCareerCompetency(mission.competencySlug);
    if (!competency) throw new ConflictException('Mission competency is unavailable');
    const [criteria, run] = await Promise.all([
      criterionRepository.find({ where: { missionId }, order: { position: 'ASC' } }),
      mission.currentVerificationRunId
        ? runRepository.findOne({
            where: { id: mission.currentVerificationRunId, missionId },
          })
        : null,
    ]);
    return {
      id: mission.id,
      targetId: mission.targetId,
      title: mission.title,
      summary: mission.summary,
      state: mission.state,
      competencySlug: mission.competencySlug,
      competencyLabel: competency.label,
      ownerDisplayName: this.reviewerAlias(mission.ownerUserId),
      submittedAt: mission.updatedAt.toISOString(),
      criteria: criteria.map(({ position, type, config }) => ({
        position,
        type,
        config: type === ProofCriterionType.HumanCheck
          ? { label: (config as { label: string }).label }
          : {},
      })),
      currentVerificationRun: run
        ? {
            status: run.status,
            observedAt: run.observedAt.toISOString(),
            results: run.results.map(({ position, type, passed, detail }) => ({
              position,
              type,
              passed,
              detail,
            })),
          }
        : null,
    };
  }

  private projectCareerEvidenceForReviewer(evidence: CareerEvidence) {
    return {
      id: evidence.id,
      title: evidence.title,
      url: evidence.url,
      kind: evidence.kind,
      description: evidence.description,
      competencySlugs: evidence.competencySlugs,
      status: evidence.status,
      reviewNote: evidence.reviewNote,
      reviewedAt: evidence.reviewedAt,
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
    };
  }

  private projectCareerEvidenceForOwner(evidence: CareerEvidence) {
    return {
      id: evidence.id,
      title: evidence.title,
      url: evidence.url,
      kind: evidence.kind,
      description: evidence.description,
      competencySlugs: evidence.competencySlugs,
      status: evidence.status,
      reviewNote: evidence.reviewNote,
      reviewedAt: evidence.reviewedAt,
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
    };
  }

  private reviewerAlias(ownerUserId: string): string {
    const pseudonym = createHash('sha256')
      .update('career-proof-reviewer-alias:v1\0')
      .update(ownerUserId)
      .digest('hex')
      .slice(0, 12);
    return `검토자-${pseudonym}`;
  }

  private async projectMission(mission: ProofMission, manager?: EntityManager) {
    const criterionRepository = manager?.getRepository(ProofCriterion) ?? this.criteria;
    const runRepository = manager?.getRepository(ProofVerificationRun) ?? this.runs;
    const reviewRepository = manager?.getRepository(ProofReview) ?? this.reviews;
    const [criteria, run, review] = await Promise.all([
      criterionRepository.find({ where: { missionId: mission.id }, order: { position: 'ASC' } }),
      mission.currentVerificationRunId
        ? runRepository.findOne({ where: { id: mission.currentVerificationRunId, missionId: mission.id } })
        : null,
      mission.currentReviewId
        ? reviewRepository.findOne({ where: { id: mission.currentReviewId, missionId: mission.id } })
        : null,
    ]);
    return {
      id: mission.id,
      targetId: mission.targetId,
      competencySlug: mission.competencySlug,
      title: mission.title,
      summary: mission.summary,
      state: mission.state,
      criteriaVersion: mission.criteriaVersion,
      bindingVersion: mission.bindingVersion,
      binding: mission.installationId
        ? {
            installationId: mission.installationId,
            githubRepositoryId: mission.githubRepositoryId,
            pullNumber: mission.pullNumber,
            repositoryName: mission.repositoryName,
            repositoryPrivate: mission.repositoryPrivate,
            pullTitle: mission.pullTitle,
            pullUrl: mission.pullUrl,
          }
        : null,
      criteria: criteria.map(({ id, position, type, config }) => ({ id, position, type, config })),
      currentVerificationRun: run
        ? {
            id: run.id,
            status: run.status,
            headSha: run.headSha,
            observedAt: run.observedAt.toISOString(),
            stale:
              run.bindingVersion !== mission.bindingVersion ||
              run.criteriaVersion !== mission.criteriaVersion ||
              run.id !== mission.currentVerificationRunId,
            criteria: run.results,
          }
        : null,
      currentReview: review
        ? {
            id: review.id,
            verificationRunId: review.verificationRunId,
            decision: review.decision,
            note: review.note,
            reviewedAt: review.reviewedAt.toISOString(),
          }
        : null,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
    };
  }

  private validateCriterionConfig(
    type: ProofCriterionType,
    config: ProofCriterionConfig,
  ): ProofCriterionConfig {
    const keys = Object.keys(config).sort();
    const requireOnly = (key?: string): string | undefined => {
      if (key === undefined) {
        if (keys.length) throw new BadRequestException('Merged PR criterion config must be empty');
        return undefined;
      }
      if (keys.length !== 1 || keys[0] !== key || typeof (config as Record<string, unknown>)[key] !== 'string') {
        throw new BadRequestException(`Criterion config must contain only ${key}`);
      }
      const rawValue = (config as Record<string, unknown>)[key];
      if (typeof rawValue !== 'string') {
        throw new BadRequestException(`Criterion config must contain only ${key}`);
      }
      const value = rawValue.trim();
      if (!value || value.length > 200) throw new BadRequestException(`Invalid ${key} criterion value`);
      return value;
    };
    switch (type) {
      case ProofCriterionType.MergedPr:
        requireOnly();
        return {};
      case ProofCriterionType.BaseBranch:
        return { branch: requireOnly('branch')! };
      case ProofCriterionType.ChangedPath: {
        const glob = requireOnly('glob')!;
        if (glob.startsWith('/') || glob.includes('..') || /[{}[\]\\]/.test(glob)) {
          throw new BadRequestException('Changed-path glob is outside the supported subset');
        }
        return { glob };
      }
      case ProofCriterionType.NamedCheck:
        return { context: requireOnly('context')! };
      case ProofCriterionType.HumanCheck:
        return { label: requireOnly('label')! };
    }
  }

  private matchesPathGlob(path: string, glob: string): boolean {
    let expression = '^';
    for (let index = 0; index < glob.length; index += 1) {
      const character = glob[index];
      if (character === '*') {
        if (glob[index + 1] === '*') {
          expression += '.*';
          index += 1;
        } else expression += '[^/]*';
      } else if (character === '?') expression += '[^/]';
      else {
        if (character === undefined) {
          throw new BadRequestException('Changed-path glob contains an invalid character');
        }
        expression += character.replace(/[.+^$()|]/g, '\\$&');
      }
    }
    return new RegExp(`${expression}$`).test(path);
  }

  private async claimCommand(
    manager: EntityManager,
    ownerUserId: string,
    command: string,
    request: { idempotencyKey: string },
    resourceId: string | null = null,
  ): Promise<CommandIdempotencyKey & { replayed: boolean }> {
    const repository = manager.getRepository(CommandIdempotencyKey);
    const requestDigest = this.digest(request);
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${ownerUserId}:${command}:${request.idempotencyKey}`,
    ]);
    const existing = await repository.findOne({
      where: { ownerUserId, command, key: request.idempotencyKey },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new ConflictException('Idempotency key was already used for another request');
      }
      return Object.assign(existing, { replayed: true });
    }
    const created = await repository.save(
      repository.create({
        ownerUserId,
        command,
        key: request.idempotencyKey,
        requestDigest,
        resourceId,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      }),
    );
    return Object.assign(created, { replayed: false });
  }

  private async lockOwnedMission(manager: EntityManager, ownerUserId: string, missionId: string) {
    const mission = await manager.getRepository(ProofMission).findOne({
      where: { id: missionId, ownerUserId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!mission) throw new NotFoundException('Proof mission not found');
    return mission;
  }

  private async lockInstallation(
    manager: EntityManager,
    ownerUserId: string,
    installationId: string,
    repositoryId: string,
  ): Promise<void> {
    const rows = (await manager.query(
      `SELECT i.id
         FROM github_installations i
         JOIN github_installation_repositories r
           ON r.installation_id = i.id AND r.github_repository_id = $3
        WHERE i.id = $1 AND i.owner_user_id = $2 AND i.status = 'ACTIVE' AND r.active = true
        FOR UPDATE OF i, r`,
      [installationId, ownerUserId, repositoryId],
    )) as unknown[];
    if (!rows.length) throw new ForbiddenException('GitHub installation or repository is unavailable');
  }

  private async requireOwnedBoundMission(userId: string, missionId: string): Promise<ProofMission> {
    const mission = await this.missions.findOne({ where: { id: missionId, ownerUserId: userId } });
    if (!mission) throw new NotFoundException('Proof mission not found');
    if (!mission.installationId || !mission.githubRepositoryId || !mission.pullNumber) {
      throw new ConflictException('Mission is not bound to a pull request');
    }
    if (mission.state === ProofMissionState.Archived) throw new ConflictException('Mission is archived');
    return mission;
  }

  private async requireCurrentPassingRun(manager: EntityManager, mission: ProofMission) {
    if (!mission.currentVerificationRunId) throw new ConflictException('Current verification is required');
    const run = await manager.getRepository(ProofVerificationRun).findOne({
      where: { id: mission.currentVerificationRunId, missionId: mission.id },
    });
    if (
      !run ||
      run.status !== ProofVerificationStatus.Pass ||
      run.bindingVersion !== mission.bindingVersion ||
      run.criteriaVersion !== mission.criteriaVersion
    ) {
      throw new ConflictException('Current passing verification is required');
    }
    return run;
  }

  private assertBindingUnchanged(current: ProofMission, snapshot: ProofMission): void {
    if (
      current.bindingVersion !== snapshot.bindingVersion ||
      current.criteriaVersion !== snapshot.criteriaVersion ||
      current.installationId !== snapshot.installationId ||
      current.githubRepositoryId !== snapshot.githubRepositoryId ||
      current.pullNumber !== snapshot.pullNumber
    ) {
      throw new ConflictException('Mission binding or criteria changed during provider verification');
    }
  }

  private clearEligibility(mission: ProofMission): void {
    mission.currentVerificationRunId = null;
    mission.currentReviewId = null;
  }

  private async invalidatePublications(manager: EntityManager, missionId: string): Promise<void> {
    await manager.query(
      `SELECT profile.id
         FROM proof_profiles profile
         JOIN proof_missions mission ON mission.owner_user_id = profile.owner_user_id
        WHERE mission.id = $1
        FOR UPDATE OF profile`,
      [missionId],
    );
    await manager
      .getRepository(PublishedProof)
      .createQueryBuilder('publication')
      .setLock('pessimistic_write')
      .where('publication.mission_id = :missionId', { missionId })
      .orderBy('publication.id', 'ASC')
      .getMany();
    await manager.getRepository(PublishedProof).update(
      { missionId, state: PublishedProofState.Active },
      { state: PublishedProofState.Invalidated },
    );
  }

  private digest(value: unknown): string {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private validateCompetencySlugs(slugs: string[]): string[] {
    const normalized = normalizeCompetencySlugs(slugs);
    const unknown = normalized.filter((slug) => !getCareerCompetency(slug));
    if (unknown.length) {
      throw new BadRequestException(`Unknown career competencies: ${unknown.join(', ')}`);
    }
    return normalized;
  }

  private assertReviewer(user: AuthUser): void {
    if (!user.roles.some((role) => ['REVIEWER', 'TEACHER', 'ADMIN'].includes(role.toUpperCase()))) {
      throw new ForbiddenException('Proof review permission is required');
    }
  }
}
