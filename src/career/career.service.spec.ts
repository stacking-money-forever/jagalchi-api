import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  CareerEvidence,
  CareerEvidenceKind,
  CareerEvidenceStatus,
  CareerTargetStatus,
  CommandIdempotencyKey,
  ProofCriterion,
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
} from './career.entities';
import { CareerService } from './career.service';

const now = new Date('2026-08-25T00:00:00.000Z');
const sha = 'a'.repeat(40);

function repository(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown): Promise<unknown> => value),
    find: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
    findOne: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
    exists: vi.fn(async (..._args: unknown[]): Promise<unknown> => false),
    delete: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ affected: 0 })),
    update: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ affected: 0 })),
    createQueryBuilder: vi.fn(),
    ...overrides,
  };
}

function createSubject() {
  const targets = repository();
  const evidence = repository();
  const missions = repository();
  const criteria = repository();
  const runs = repository();
  const reviews = repository();
  const profiles = repository();
  const publications = repository();
  const commands = repository();
  publications.createQueryBuilder.mockReturnValue({
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn(async () => []),
  });
  const github = {
    authorizeRepository: vi.fn(),
    resolvePullRequestBinding: vi.fn(),
    getPullRequestFacts: vi.fn(),
    getPullRequestHead: vi.fn(),
  };
  const repositories = new Map<unknown, ReturnType<typeof repository>>([
    [CareerEvidence, evidence],
    [ProofMission, missions],
    [ProofCriterion, criteria],
    [ProofVerificationRun, runs],
    [ProofReview, reviews],
    [ProofProfile, profiles],
    [PublishedProof, publications],
    [CommandIdempotencyKey, commands],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repositories.get(entity) ?? repository()),
    query: vi.fn(async () => [{ id: 'locked-synthetic-row' }]),
  };
  const dataSource = {
    transaction: vi.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    query: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
  };
  const service = new CareerService(
    targets as never,
    evidence as never,
    missions as never,
    criteria as never,
    runs as never,
    reviews as never,
    profiles as never,
    publications as never,
    dataSource as never,
    github as never,
  );
  return {
    service,
    targets,
    evidence,
    missions,
    criteria,
    runs,
    reviews,
    profiles,
    publications,
    commands,
    github,
    manager,
    dataSource,
    repositories,
  };
}

const facts = {
  repositoryId: '101',
  pullNumber: 7,
  headSha: sha,
  merged: true,
  baseBranch: 'main',
  changedPaths: ['src/proof.ts', 'tests/proof.spec.ts'],
  checks: [{ name: 'ci/test', successful: true }],
  statuses: [{ context: 'deploy', successful: true }],
};

function criterion(id: string, position: number, type: ProofCriterionType, config: object) {
  return { id, missionId: 'mission-1', position, type, config } as never;
}

function createApprovedPublicationSubject() {
  const subject = createSubject();
  const criteria = [criterion('machine', 0, ProofCriterionType.MergedPr, {})];
  const mission = {
    id: 'mission-1',
    ownerUserId: 'owner-a',
    competencySlug: 'typescript',
    title: 'Reviewed mission title',
    summary: 'Reviewed mission summary',
    state: ProofMissionState.Approved,
    installationId: 'install-a',
    githubRepositoryId: '101',
    pullNumber: 7,
    bindingVersion: 1,
    criteriaVersion: 1,
    currentVerificationRunId: 'run-a',
    currentReviewId: 'review-a',
  };
  const digest = (value: unknown) =>
    (subject.service as unknown as { digest(input: unknown): string }).digest(value);
  const run = {
    id: 'run-a',
    missionId: mission.id,
    status: ProofVerificationStatus.Pass,
    headSha: sha,
    bindingVersion: 1,
    criteriaVersion: 1,
    criteriaDigest: digest(criteria.map(({ position, type, config }) => ({ position, type, config }))),
    factsDigest: digest(facts),
    results: [{
      criterionId: 'machine',
      position: 0,
      type: ProofCriterionType.MergedPr,
      passed: true,
      detail: 'Pull request is merged',
    }],
  };
  const review = {
    id: 'review-a',
    missionId: mission.id,
    verificationRunId: run.id,
    reviewerId: 'reviewer-a',
    decision: ProofReviewDecision.Approved,
    reviewedAt: now,
  };
  const profile = {
    id: 'profile-a',
    ownerUserId: 'owner-a',
    state: ProofProfileState.Enabled,
  };
  subject.missions.findOne.mockResolvedValue(mission);
  subject.runs.findOne.mockResolvedValue(run);
  subject.reviews.findOne.mockResolvedValue(review);
  subject.profiles.findOne.mockResolvedValue(profile);
  subject.criteria.find.mockResolvedValue(criteria);
  subject.github.getPullRequestHead.mockResolvedValue({ headSha: sha });
  subject.github.getPullRequestFacts.mockResolvedValue(facts);
  return { ...subject, mission, run, review, profile, criteria };
}

describe('CareerService evidence-execution boundaries', () => {
  it('creates missions only for an active target owned by the caller and a target competency', async () => {
    const subject = createSubject();
    subject.targets.findOne.mockResolvedValueOnce(null);
    await expect(subject.service.createMission('owner-a', {
      targetId: 'target-b', competencySlug: 'typescript', title: 'Synthetic mission', idempotencyKey: 'create-a',
    })).rejects.toBeInstanceOf(NotFoundException);

    subject.targets.findOne.mockResolvedValueOnce({
      id: 'target-a', userId: 'owner-a', status: CareerTargetStatus.Active, competencySlugs: ['react'],
    });
    await expect(subject.service.createMission('owner-a', {
      targetId: 'target-a', competencySlug: 'typescript', title: 'Synthetic mission', idempotencyKey: 'create-b',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reuse of an idempotency key for a different mission command payload', async () => {
    const subject = createSubject();
    subject.targets.findOne.mockResolvedValue({
      id: 'target-a', userId: 'owner-a', status: CareerTargetStatus.Active,
      competencySlugs: ['typescript'],
    });
    subject.commands.findOne.mockResolvedValue({
      id: 'command-a', ownerUserId: 'owner-a', command: 'CREATE_MISSION',
      key: 'mission-create-reused', requestDigest: 'digest-for-a-different-request',
      resourceId: 'mission-existing',
    });

    await expect(subject.service.createMission('owner-a', {
      targetId: 'target-a', competencySlug: 'typescript', title: 'New payload',
      idempotencyKey: 'mission-create-reused',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(subject.missions.save).not.toHaveBeenCalled();
  });

  it('credits an approval only to the exact target and competency with a current same-version passing run', async () => {
    const subject = createSubject();
    subject.targets.findOne.mockResolvedValue({
      id: 'target-a', userId: 'owner-a', competencySlugs: ['react', 'typescript'],
    });
    subject.evidence.find.mockResolvedValue([{ id: 'manual', title: 'Untrusted URL', url: 'https://example.invalid/proof', kind: CareerEvidenceKind.Other, competencySlugs: ['typescript'], status: CareerEvidenceStatus.Verified, reviewNote: null }]);
    subject.missions.find.mockResolvedValue([
      { id: 'mission-a', ownerUserId: 'owner-a', targetId: 'target-a', competencySlug: 'react', state: ProofMissionState.Approved, currentReviewId: 'review-a', currentVerificationRunId: 'run-a', bindingVersion: 2, criteriaVersion: 3 },
      { id: 'mission-other-target', ownerUserId: 'owner-a', targetId: 'target-other', competencySlug: 'typescript', state: ProofMissionState.Approved, currentReviewId: 'review-b', currentVerificationRunId: 'run-b', bindingVersion: 1, criteriaVersion: 1 },
    ]);
    subject.runs.find.mockResolvedValue([{ id: 'run-a', status: ProofVerificationStatus.Pass, bindingVersion: 2, criteriaVersion: 3 }]);

    const diff = await subject.service.getDiff('owner-a', 'target-a');
    expect(diff.competencies.map(({ slug, status }) => [slug, status])).toEqual([
      ['react', 'VERIFIED'],
      ['typescript', 'MISSING'],
    ]);
    expect(diff.competencies[1]?.evidence[0]).toMatchObject({ id: 'manual', creditEligible: false });
    expect(subject.missions.find).toHaveBeenCalledWith({ where: { ownerUserId: 'owner-a', targetId: 'target-a' } });
  });

  it('evaluates the complete finite criterion set with exact names and fail-closed check conclusions', () => {
    const subject = createSubject();
    const matrix = [
      criterion('merged', 4, ProofCriterionType.MergedPr, {}),
      criterion('base', 0, ProofCriterionType.BaseBranch, { branch: 'main' }),
      criterion('path', 1, ProofCriterionType.ChangedPath, { glob: 'src/**' }),
      criterion('check', 2, ProofCriterionType.NamedCheck, { context: 'ci/test' }),
      criterion('human', 3, ProofCriterionType.HumanCheck, { label: 'Readable change' }),
    ];
    const passing = subject.service.evaluateCriteria(matrix, facts);
    expect(passing.map(({ type, passed }) => [type, passed])).toEqual([
      [ProofCriterionType.BaseBranch, true],
      [ProofCriterionType.ChangedPath, true],
      [ProofCriterionType.NamedCheck, true],
      [ProofCriterionType.HumanCheck, false],
      [ProofCriterionType.MergedPr, true],
    ]);
    expect(passing.find(({ type }) => type === ProofCriterionType.HumanCheck)?.detail)
      .toBe('Pending confirmation by a non-self human reviewer');

    for (const unsuccessful of [
      { name: 'ci/test', successful: false },
      { name: 'ci/test', successful: true },
    ]) {
      const result = subject.service.evaluateCriteria(
        [criterion('check', 0, ProofCriterionType.NamedCheck, { context: 'ci/test' })],
        { ...facts, checks: [unsuccessful, { name: 'ci/test', successful: unsuccessful.successful }], statuses: unsuccessful.successful ? [{ context: 'ci/test', successful: false }] : [] },
      );
      expect(result.at(0)?.passed).toBe(false);
    }
    expect(subject.service.evaluateCriteria(
      [criterion('check', 0, ProofCriterionType.NamedCheck, { context: 'missing' })], facts,
    ).at(0)?.passed).toBe(false);
  });

  it('marks a machine run passing from non-human criteria while keeping human checks pending', async () => {
    const subject = createSubject();
    const mission = {
      id: 'mission-a',
      ownerUserId: 'owner-a',
      state: ProofMissionState.Bound,
      installationId: 'install-a',
      githubRepositoryId: '101',
      pullNumber: 7,
      bindingVersion: 1,
      criteriaVersion: 1,
      currentVerificationRunId: null,
      currentReviewId: null,
    };
    const missionCriteria = [
      criterion('machine', 0, ProofCriterionType.MergedPr, {}),
      criterion('human', 1, ProofCriterionType.HumanCheck, { label: 'Readable change' }),
    ];
    subject.missions.findOne.mockResolvedValue(mission);
    subject.criteria.find.mockResolvedValue(missionCriteria);
    subject.github.getPullRequestFacts.mockResolvedValue(facts);
    subject.runs.findOne.mockResolvedValue(null);
    subject.runs.save.mockImplementation(async (value: unknown) => ({
      ...(value as object),
      id: 'run-a',
    }));

    await subject.service.refreshVerification('owner-a', mission.id, 'refresh-key');

    expect(subject.runs.save).toHaveBeenCalledWith(expect.objectContaining({
      status: ProofVerificationStatus.Pass,
      results: [
        expect.objectContaining({
          criterionId: 'machine',
          passed: true,
        }),
        expect.objectContaining({
          criterionId: 'human',
          type: ProofCriterionType.HumanCheck,
          passed: false,
          detail: 'Pending confirmation by a non-self human reviewer',
        }),
      ],
    }));
  });

  it('creates and submits a restored criterion as a new run at its current version', async () => {
    const subject = createSubject();
    const mission = {
      id: 'mission-a',
      ownerUserId: 'owner-a',
      state: ProofMissionState.Bound,
      installationId: 'install-a',
      githubRepositoryId: '101',
      pullNumber: 7,
      bindingVersion: 1,
      criteriaVersion: 3,
      currentVerificationRunId: null as string | null,
      currentReviewId: null,
    };
    const restoredCriteria = [
      criterion('criterion-restored', 0, ProofCriterionType.MergedPr, {}),
    ];
    const versionOneRun = {
      id: 'run-v1',
      missionId: mission.id,
      bindingVersion: 1,
      criteriaVersion: 1,
      headSha: facts.headSha,
      status: ProofVerificationStatus.Pass,
    };
    let versionThreeRun: Record<string, unknown> | null = null;
    subject.missions.findOne.mockResolvedValue(mission);
    subject.criteria.find.mockResolvedValue(restoredCriteria);
    subject.github.getPullRequestFacts.mockResolvedValue(facts);
    subject.runs.findOne.mockImplementation(async (options: {
      where: Record<string, unknown>;
    }) => {
      if (options.where.id === 'run-v3') return versionThreeRun;
      if ('headSha' in options.where) {
        return 'criteriaVersion' in options.where ? null : versionOneRun;
      }
      return null;
    });
    subject.runs.save.mockImplementation(async (value: unknown) => {
      versionThreeRun = { ...(value as object), id: 'run-v3' };
      return versionThreeRun;
    });

    await subject.service.refreshVerification('owner-a', mission.id, 'refresh-v3');

    expect(subject.runs.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        missionId: mission.id,
        bindingVersion: 1,
        criteriaVersion: 3,
        headSha: facts.headSha,
        criteriaDigest: expect.any(String),
        factsDigest: expect.any(String),
      }),
    });
    expect(subject.runs.save).toHaveBeenCalledWith(expect.objectContaining({
      criteriaVersion: 3,
      status: ProofVerificationStatus.Pass,
    }));
    expect(mission.currentVerificationRunId).toBe('run-v3');

    await subject.service.submitForReview('owner-a', mission.id, 'submit-v3');

    expect(mission.state).toBe(ProofMissionState.ReviewPending);
  });

  it('enforces reviewer roles and universal self-review prohibition, including ADMIN', async () => {
    const subject = createSubject();
    await expect(subject.service.listProofReviewQueue({ id: 'owner-a', roles: ['USER'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    subject.missions.find.mockResolvedValue([]);
    for (const role of ['REVIEWER', 'TEACHER', 'ADMIN']) {
      await expect(subject.service.listProofReviewQueue({ id: `reviewer-${role}`, roles: [role] }))
        .resolves.toEqual([]);
    }

    subject.evidence.findOne.mockResolvedValue({ id: 'evidence-a', userId: 'owner-a', status: CareerEvidenceStatus.Submitted });
    await expect(subject.service.reviewEvidence(
      { id: 'owner-a', roles: ['ADMIN'] },
      'evidence-a',
      { status: CareerEvidenceStatus.Verified },
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('serializes owner evidence lists without owner or reviewer identifiers', async () => {
    const subject = createSubject();
    const ownerId = '00000000-0000-4000-8000-000000000001';
    const reviewerId = '00000000-0000-4000-8000-000000000002';
    subject.evidence.find.mockResolvedValue([{
      id: 'evidence-a',
      userId: ownerId,
      title: 'Evidence title',
      url: 'https://example.test/evidence',
      kind: CareerEvidenceKind.Article,
      description: 'Evidence description',
      competencySlugs: ['typescript'],
      status: CareerEvidenceStatus.Verified,
      reviewerId,
      reviewNote: 'Verified evidence',
      reviewedAt: now,
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      updatedAt: now,
    }]);

    const result = await subject.service.listEvidence(ownerId);
    const serialized = JSON.stringify(result);

    expect(subject.evidence.find).toHaveBeenCalledWith({
      where: { userId: ownerId },
      order: { createdAt: 'DESC' },
    });
    for (const forbidden of ['userId', 'reviewerId', ownerId, reviewerId]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(result[0]).toEqual(expect.objectContaining({
      status: CareerEvidenceStatus.Verified,
      reviewNote: 'Verified evidence',
      reviewedAt: now,
    }));
  });

  it('serializes created owner evidence without owner or reviewer identifiers', async () => {
    const subject = createSubject();
    const ownerId = '00000000-0000-4000-8000-000000000001';
    const createdAt = new Date('2026-08-24T00:00:00.000Z');
    subject.evidence.save.mockResolvedValue({
      id: 'evidence-a',
      userId: ownerId,
      title: 'Evidence title',
      url: 'https://example.test/evidence',
      kind: CareerEvidenceKind.Article,
      description: 'Evidence description',
      competencySlugs: ['typescript'],
      status: CareerEvidenceStatus.Submitted,
      reviewerId: null,
      reviewNote: null,
      reviewedAt: null,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await subject.service.createEvidence(ownerId, {
      title: ' Evidence title ',
      url: ' https://example.test/evidence ',
      kind: CareerEvidenceKind.Article,
      description: ' Evidence description ',
      competencySlugs: ['typescript'],
    });
    const serialized = JSON.stringify(result);

    expect(subject.evidence.save).toHaveBeenCalledWith(expect.objectContaining({
      userId: ownerId,
      reviewerId: null,
    }));
    for (const forbidden of ['userId', 'reviewerId', ownerId]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(result).toEqual(expect.objectContaining({
      title: 'Evidence title',
      url: 'https://example.test/evidence',
      description: 'Evidence description',
      status: CareerEvidenceStatus.Submitted,
      reviewNote: null,
      reviewedAt: null,
      createdAt,
      updatedAt: createdAt,
    }));
  });

  it('projects legacy reviewer evidence without owner or reviewer identifiers', async () => {
    const subject = createSubject();
    const submitted = {
      id: 'evidence-a',
      userId: '00000000-0000-4000-8000-000000000001',
      title: 'Evidence title',
      url: 'https://example.test/evidence',
      kind: CareerEvidenceKind.Article,
      description: 'Evidence description',
      competencySlugs: ['typescript'],
      status: CareerEvidenceStatus.Submitted,
      reviewerId: null,
      reviewNote: null,
      reviewedAt: null,
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      updatedAt: now,
    };
    subject.evidence.find.mockResolvedValue([submitted]);

    const [queued] = await subject.service.listReviewQueue({
      id: 'reviewer-a',
      roles: ['REVIEWER'],
    });
    expect(queued).toEqual({
      id: submitted.id,
      title: submitted.title,
      url: submitted.url,
      kind: submitted.kind,
      description: submitted.description,
      competencySlugs: submitted.competencySlugs,
      status: submitted.status,
      reviewNote: null,
      reviewedAt: null,
      createdAt: submitted.createdAt,
      updatedAt: submitted.updatedAt,
    });
    expect(queued).not.toHaveProperty('userId');
    expect(queued).not.toHaveProperty('reviewerId');

    subject.evidence.findOne.mockResolvedValue(submitted);
    const reviewed = await subject.service.reviewEvidence(
      { id: 'reviewer-a', roles: ['REVIEWER'] },
      submitted.id,
      { status: CareerEvidenceStatus.Verified },
    );
    expect(reviewed).toEqual({
      id: submitted.id,
      title: submitted.title,
      url: submitted.url,
      kind: submitted.kind,
      description: submitted.description,
      competencySlugs: submitted.competencySlugs,
      status: CareerEvidenceStatus.Verified,
      reviewNote: null,
      reviewedAt: expect.any(Date),
      createdAt: submitted.createdAt,
      updatedAt: submitted.updatedAt,
    });
    expect(reviewed).not.toHaveProperty('userId');
    expect(reviewed).not.toHaveProperty('reviewerId');
  });

  it('returns an exact reviewer-safe mission DTO with stable, separated pseudonyms', async () => {
    const subject = createSubject();
    const mission = {
      id: 'mission-a',
      ownerUserId: '00000000-0000-4000-8000-000000000001',
      targetId: 'target-a',
      competencySlug: 'typescript',
      title: 'Synthetic mission',
      summary: 'Synthetic summary',
      state: ProofMissionState.ReviewPending,
      criteriaVersion: 1,
      bindingVersion: 1,
      installationId: 'install-a',
      githubRepositoryId: '101',
      pullNumber: 7,
      repositoryName: 'synthetic-owner/private-repo',
      repositoryPrivate: true,
      pullTitle: 'Synthetic pull request',
      pullUrl: 'https://github.com/synthetic-owner/private-repo/pull/7',
      currentVerificationRunId: 'run-a',
      currentReviewId: null,
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      updatedAt: now,
    };
    const run = {
      id: 'run-a',
      missionId: mission.id,
      bindingVersion: 1,
      criteriaVersion: 1,
      headSha: 'a'.repeat(40),
      criteriaDigest: 'b'.repeat(64),
      factsDigest: 'c'.repeat(64),
      status: ProofVerificationStatus.Pass,
      observedAt: new Date('2026-08-24T23:00:00.000Z'),
      results: [{
        criterionId: 'criterion-machine',
        position: 0,
        type: ProofCriterionType.NamedCheck,
        passed: true,
        detail: 'Named check succeeded',
      }],
    };
    subject.missions.find.mockResolvedValue([mission]);
    subject.missions.findOne.mockResolvedValue(mission);
    subject.criteria.find.mockResolvedValue([
      criterion('criterion-machine', 0, ProofCriterionType.NamedCheck, {
        context: 'private-provider-check',
      }),
      criterion('criterion-human', 1, ProofCriterionType.HumanCheck, {
        label: 'Readable implementation',
      }),
    ]);
    subject.runs.findOne.mockResolvedValue(run);

    const [first] = await subject.service.listProofReviewQueue({
      id: 'reviewer-a',
      roles: ['REVIEWER'],
    });
    const [second] = await subject.service.listProofReviewQueue({
      id: 'reviewer-b',
      roles: ['REVIEWER'],
    });

    expect(first).toEqual({
      id: mission.id,
      targetId: mission.targetId,
      title: mission.title,
      summary: mission.summary,
      state: mission.state,
      competencySlug: 'typescript',
      competencyLabel: 'TypeScript',
      ownerDisplayName: expect.stringMatching(/^검토자-[0-9a-f]{12}$/),
      submittedAt: now.toISOString(),
      criteria: [
        { position: 0, type: ProofCriterionType.NamedCheck, config: {} },
        {
          position: 1,
          type: ProofCriterionType.HumanCheck,
          config: { label: 'Readable implementation' },
        },
      ],
      currentVerificationRun: {
        status: ProofVerificationStatus.Pass,
        observedAt: run.observedAt.toISOString(),
        results: [{
          position: 0,
          type: ProofCriterionType.NamedCheck,
          passed: true,
          detail: 'Named check succeeded',
        }],
      },
    });
    expect(second.ownerDisplayName).toBe(first.ownerDisplayName);

    const privateSerialization = JSON.stringify(first);
    for (const privateValue of [
      mission.ownerUserId,
      mission.installationId,
      mission.githubRepositoryId,
      mission.repositoryName,
      mission.pullUrl,
      run.id,
      run.headSha,
      run.criteriaDigest,
      run.factsDigest,
      'private-provider-check',
      'criterion-machine',
    ]) {
      expect(privateSerialization).not.toContain(privateValue);
    }

    const otherOwner = {
      ...mission,
      ownerUserId: '00000000-0000-4000-8000-000000000002',
    };
    subject.missions.find.mockResolvedValue([otherOwner]);
    subject.missions.findOne.mockResolvedValue(otherOwner);
    const [separated] = await subject.service.listProofReviewQueue({
      id: 'reviewer-a',
      roles: ['REVIEWER'],
    });
    expect(separated.ownerDisplayName).not.toBe(first.ownerDisplayName);
  });

  it('fails reviewer projection when the mission competency is unavailable', async () => {
    const subject = createSubject();
    const mission = {
      id: 'mission-a',
      competencySlug: 'removed-competency',
      state: ProofMissionState.ReviewPending,
      updatedAt: now,
    };
    subject.missions.find.mockResolvedValue([mission]);
    subject.missions.findOne.mockResolvedValue(mission);

    await expect(subject.service.listProofReviewQueue({
      id: 'reviewer-a',
      roles: ['REVIEWER'],
    })).rejects.toThrow('Mission competency is unavailable');
  });

  it('rejects illegal lifecycle transitions and makes already-pending submission idempotent', async () => {
    const subject = createSubject();
    const draft = { id: 'mission-a', ownerUserId: 'owner-a', state: ProofMissionState.Draft };
    subject.missions.findOne.mockResolvedValue(draft);
    await expect(subject.service.archiveMission('owner-a', 'mission-a', 'archive-key')).resolves.toBeDefined();
    expect(subject.publications.update).toHaveBeenCalledWith(
      { missionId: 'mission-a', state: 'ACTIVE' },
      { state: 'INVALIDATED' },
    );

    const pending = { id: 'mission-a', ownerUserId: 'owner-a', state: ProofMissionState.ReviewPending };
    subject.missions.findOne.mockResolvedValue(pending);
    await expect(subject.service.submitForReview('owner-a', 'mission-a', 'submit-retry'))
      .resolves.toMatchObject({ id: 'mission-a', state: ProofMissionState.ReviewPending });
    await expect(subject.service.archiveMission('owner-a', 'mission-a', 'archive-key-2')).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a fresh review when the provider head changes and clears eligibility before returning the conflict', async () => {
    const subject = createSubject();
    const mission = {
      id: 'mission-a', ownerUserId: 'owner-a', state: ProofMissionState.ReviewPending,
      installationId: 'install-a', githubRepositoryId: '101', pullNumber: 7,
      currentVerificationRunId: 'run-a', currentReviewId: null, bindingVersion: 1, criteriaVersion: 1,
    };
    subject.missions.findOne.mockResolvedValue(mission);
    subject.runs.findOne.mockResolvedValue({ id: 'run-a', missionId: mission.id, status: ProofVerificationStatus.Pass, headSha: sha, bindingVersion: 1, criteriaVersion: 1 });
    subject.github.getPullRequestHead.mockResolvedValue({ headSha: 'b'.repeat(40) });

    await expect(subject.service.reviewMission(
      { id: 'reviewer-a', roles: ['REVIEWER'] }, mission.id,
      { decision: ProofReviewDecision.Approved, idempotencyKey: 'review-key' },
    )).rejects.toThrow('refresh and re-review');
    expect(mission).toMatchObject({ state: ProofMissionState.Bound, currentVerificationRunId: null, currentReviewId: null });
    expect(subject.reviews.save).not.toHaveBeenCalled();
  });

  it('rebinds only after repository authorization, uses canonical provider fields, and removes prior review credit', async () => {
    const subject = createSubject();
    const mission = {
      id: 'mission-a', ownerUserId: 'owner-a', targetId: 'target-a',
      competencySlug: 'typescript', title: 'Synthetic mission', summary: null,
      state: ProofMissionState.Approved, installationId: 'install-old',
      githubRepositoryId: '100', pullNumber: 6, bindingVersion: 1, criteriaVersion: 1,
      currentVerificationRunId: 'run-old', currentReviewId: 'review-old',
    };
    subject.missions.findOne.mockResolvedValue(mission);
    subject.github.resolvePullRequestBinding.mockResolvedValue({
      repositoryId: '101', pullNumber: 7,
      repositoryName: 'synthetic-owner/canonical-repo', repositoryPrivate: true,
      pullTitle: 'Canonical synthetic PR',
      pullUrl: 'https://github.com/synthetic-owner/canonical-repo/pull/7',
    });

    const dto = {
      installationId: 'install-a',
      githubRepositoryId: '101',
      pullNumber: 7,
      idempotencyKey: 'bind-1',
    };
    await subject.service.bindPullRequest('owner-a', mission.id, dto);

    expect(subject.github.authorizeRepository).toHaveBeenCalledExactlyOnceWith(
      'owner-a', 'install-a', '101',
    );
    expect(subject.github.resolvePullRequestBinding).toHaveBeenCalledExactlyOnceWith(
      'owner-a', 'install-a', '101', 7,
    );
    expect(mission).toMatchObject({
      state: ProofMissionState.Bound,
      repositoryName: 'synthetic-owner/canonical-repo',
      pullUrl: 'https://github.com/synthetic-owner/canonical-repo/pull/7',
      bindingVersion: 2,
      currentVerificationRunId: null,
      currentReviewId: null,
    });
    expect(subject.publications.update).toHaveBeenCalledWith(
      { missionId: mission.id, state: 'ACTIVE' },
      { state: 'INVALIDATED' },
    );
  });

  it('uses one indistinguishable query and response for every unavailable public profile case', async () => {
    const subject = createSubject();
    for (const publicId of [
      'malformed',
      'U'.repeat(27),
      'D'.repeat(27),
      'P'.repeat(27),
      'E'.repeat(27),
      'I'.repeat(27),
    ]) {
      await expect(subject.service.getPublicProofProfile(publicId))
        .rejects.toMatchObject({ message: 'Proof Profile not found' });
    }
    expect(subject.profiles.findOne).not.toHaveBeenCalled();
    expect(subject.publications.createQueryBuilder).not.toHaveBeenCalled();
    expect(subject.dataSource.query).toHaveBeenCalledTimes(6);
    const queryShapes = subject.dataSource.query.mock.calls.map(([query]) => query);
    expect(new Set(queryShapes).size).toBe(1);
    for (const [, parameters] of subject.dataSource.query.mock.calls) {
      expect(parameters).toEqual([expect.any(String), expect.any(Date)]);
    }
  });

  it('runtime-projects stored snapshots to the exact public DTO allowlist', async () => {
    const subject = createSubject();
    const publicId = 'A'.repeat(27);
    const snapshot = {
      schemaVersion: 1 as const,
      publicProofId: 'B'.repeat(27),
      title: 'Synthetic proof',
      summary: null,
      competencyLabel: 'TypeScript',
      provider: 'GITHUB' as const,
      verification: { status: 'VERIFIED' as const, verifiedAt: now.toISOString() },
      criteria: {
        passedCount: 2,
        totalCount: 2,
        types: [ProofCriterionType.MergedPr],
        privateCriterionIds: ['criterion-a'],
      },
      reviewerId: 'reviewer-a',
      repositoryName: 'private/repo',
    };
    subject.dataSource.query.mockResolvedValue([{
      public_id: publicId,
      display_name: 'Synthetic Builder',
      profile_summary: null,
      updated_at: now,
      snapshot,
      owner_user_id: 'owner-a',
      email: 'private@example.invalid',
    }]);

    const result = await subject.service.getPublicProofProfile(publicId);
    expect(result).toEqual({
      schemaVersion: 1,
      profile: { publicId, displayName: 'Synthetic Builder', summary: null },
      proofs: [{
        publicProofId: 'B'.repeat(27),
        title: 'Synthetic proof',
        summary: null,
        competencyLabel: 'TypeScript',
        provider: 'GITHUB',
        verification: { status: 'VERIFIED', verifiedAt: now.toISOString() },
        criteria: {
          passedCount: 2,
          totalCount: 2,
          types: [ProofCriterionType.MergedPr],
        },
      }],
      updatedAt: now.toISOString(),
    });
    expect(Object.keys(result).sort()).toEqual(['profile', 'proofs', 'schemaVersion', 'updatedAt']);
    expect(Object.keys(result.profile).sort()).toEqual(['displayName', 'publicId', 'summary']);
    expect(Object.keys(result.proofs[0]!).sort()).toEqual([
      'competencyLabel', 'criteria', 'provider', 'publicProofId', 'summary', 'title', 'verification',
    ]);
    expect(Object.keys(result.proofs[0]!.verification).sort()).toEqual(['status', 'verifiedAt']);
    expect(Object.keys(result.proofs[0]!.criteria).sort()).toEqual([
      'passedCount', 'totalCount', 'types',
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'private@example.invalid', 'private/repo', 'reviewer-a', 'privateCriterionIds',
      'ownerUserId', 'missionId', 'installationId', 'githubRepositoryId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain('"schemaVersion":1,"publicProofId"');
  });

  it('fails closed when a public query returns a malformed stored snapshot', async () => {
    const subject = createSubject();
    subject.dataSource.query.mockResolvedValue([{
      public_id: 'A'.repeat(27),
      display_name: 'Synthetic Builder',
      profile_summary: null,
      updated_at: now,
      snapshot: {
        schemaVersion: 1,
        publicProofId: 'B'.repeat(27),
        title: 'Synthetic proof',
        summary: null,
        competencyLabel: 'TypeScript',
        provider: 'GITHUB',
        verification: { status: 'VERIFIED', verifiedAt: 'not-a-date' },
        criteria: { passedCount: 3, totalCount: 2, types: [ProofCriterionType.MergedPr] },
      },
    }]);

    await expect(subject.service.getPublicProofProfile('A'.repeat(27)))
      .rejects.toMatchObject({ message: 'Proof Profile not found' });
  });

  it('publishes immutable reviewed claims and counts human checks only through the current non-self approval', async () => {
    const subject = createSubject();
    const mission = {
      id: 'mission-a',
      ownerUserId: 'owner-a',
      competencySlug: 'typescript',
      title: 'Reviewed mission title',
      summary: 'Reviewed mission summary',
      state: ProofMissionState.Approved,
      installationId: 'install-a',
      githubRepositoryId: '101',
      pullNumber: 7,
      bindingVersion: 1,
      criteriaVersion: 1,
      currentVerificationRunId: 'run-a',
      currentReviewId: 'review-latest',
    };
    const run = {
      id: 'run-a',
      missionId: mission.id,
      status: ProofVerificationStatus.Pass,
      headSha: sha,
      bindingVersion: 1,
      criteriaVersion: 1,
      results: [
        {
          criterionId: 'machine',
          position: 0,
          type: ProofCriterionType.MergedPr,
          passed: true,
          detail: 'Pull request is merged',
        },
        {
          criterionId: 'human',
          position: 1,
          type: ProofCriterionType.HumanCheck,
          passed: false,
          detail: 'Pending confirmation by a non-self human reviewer',
        },
      ],
    };
    const review = {
      id: 'review-latest',
      missionId: mission.id,
      verificationRunId: run.id,
      reviewerId: 'reviewer-a',
      decision: ProofReviewDecision.Approved,
      reviewedAt: now,
    };
    subject.missions.findOne.mockResolvedValue(mission);
    subject.runs.findOne.mockResolvedValue(run);
    subject.reviews.findOne.mockResolvedValue(review);
    subject.profiles.findOne.mockResolvedValue({
      id: 'profile-a',
      ownerUserId: 'owner-a',
      state: ProofProfileState.Enabled,
    });
    subject.criteria.find.mockResolvedValue([
      criterion('machine', 0, ProofCriterionType.MergedPr, {}),
      criterion('human', 1, ProofCriterionType.HumanCheck, { label: 'Readable change' }),
    ]);
    subject.publications.findOne.mockResolvedValue(null);
    subject.github.getPullRequestHead.mockResolvedValue({ headSha: sha });

    const result = await subject.service.publishProof('owner-a', mission.id, {
      idempotencyKey: 'publish-proof',
      title: 'Owner override',
      summary: 'Owner override summary',
    } as never);

    expect(subject.reviews.findOne).toHaveBeenCalledWith({
      where: {
        id: 'review-latest',
        missionId: mission.id,
        verificationRunId: run.id,
        decision: ProofReviewDecision.Approved,
      },
    });
    expect(result).toMatchObject({
      reviewId: 'review-latest',
      snapshot: {
        title: 'Reviewed mission title',
        summary: 'Reviewed mission summary',
        criteria: { passedCount: 2, totalCount: 2 },
      },
    });
    expect(run.results[1]).toMatchObject({
      type: ProofCriterionType.HumanCheck,
      passed: false,
    });
    expect(result).toMatchObject({
      state: PublishedProofState.Active,
      validUntil: expect.any(Date),
    });
  });

  it('leaves an elapsed publication unchanged and directs publish callers to lease renewal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const subject = createApprovedPublicationSubject();
      const publication = {
        profileId: subject.profile.id,
        missionId: subject.mission.id,
        verificationRunId: subject.run.id,
        reviewId: subject.review.id,
        state: PublishedProofState.Active,
        validUntil: new Date(now.getTime() - 1),
        snapshot: { publicProofId: 'B'.repeat(27) },
      };
      subject.publications.findOne.mockResolvedValue(publication);

      await expect(subject.service.publishProof('owner-a', subject.mission.id, {
        idempotencyKey: 'republish-expired',
        title: 'Ignored owner title',
        summary: 'Ignored owner summary',
      } as never)).rejects.toMatchObject({
        message: 'Publication lease expired; renew the publication lease before publishing',
      });

      expect(publication).toMatchObject({
        state: PublishedProofState.Active,
        validUntil: new Date(now.getTime() - 1),
      });
      expect(subject.publications.save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludes an elapsed ACTIVE lease publicly, renews it from unchanged facts, and preserves its claim on republish', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const subject = createApprovedPublicationSubject();
      const publicId = 'A'.repeat(27);
      const publication = {
        profileId: subject.profile.id,
        missionId: subject.mission.id,
        verificationRunId: subject.run.id,
        reviewId: subject.review.id,
        state: PublishedProofState.Active,
        validUntil: new Date(now.getTime() - 1),
        snapshot: {
          schemaVersion: 1,
          publicProofId: 'B'.repeat(27),
          title: 'Reviewed mission title',
          summary: 'Reviewed mission summary',
          competencyLabel: 'TypeScript',
          provider: 'GITHUB',
          verification: { status: 'VERIFIED', verifiedAt: now.toISOString() },
          criteria: {
            passedCount: 1,
            totalCount: 1,
            types: [ProofCriterionType.MergedPr],
          },
        },
      };
      subject.publications.find.mockResolvedValue([publication]);
      subject.publications.findOne.mockResolvedValue(publication);

      const ownerProfile = await subject.service.getProofProfile('owner-a');
      expect(ownerProfile?.proofs).toEqual([publication]);
      expect(ownerProfile?.proofs[0]).toMatchObject({
        state: PublishedProofState.Active,
        validUntil: new Date(now.getTime() - 1),
      });

      await expect(subject.service.getPublicProofProfile(publicId))
        .rejects.toMatchObject({ message: 'Proof Profile not found' });
      expect(subject.dataSource.query).toHaveBeenLastCalledWith(
        expect.stringContaining('publication.valid_until > $2'),
        [publicId, now],
      );

      const renewal = await subject.service.renewPublicationLease(
        'owner-a',
        subject.mission.id,
        'renew-elapsed',
      );
      expect(renewal).toEqual({
        renewed: true,
        validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
      const renewedUntil = publication.validUntil;
      expect(subject.publications.save).toHaveBeenCalledWith(publication);

      const republished = await subject.service.publishProof('owner-a', subject.mission.id, {
        idempotencyKey: 'republish-renewed',
        title: 'Owner cannot replace reviewed title',
        summary: 'Owner cannot replace reviewed summary',
      } as never);
      expect(republished).toBe(publication);
      expect(republished.validUntil).toBe(renewedUntil);
      expect(republished.snapshot).toMatchObject({
        publicProofId: 'B'.repeat(27),
        title: 'Reviewed mission title',
        summary: 'Reviewed mission summary',
        verification: { status: 'VERIFIED', verifiedAt: now.toISOString() },
      });

      subject.dataSource.query.mockResolvedValue([{
        public_id: publicId,
        display_name: 'Synthetic Builder',
        profile_summary: null,
        updated_at: now,
        snapshot: republished.snapshot,
      }]);
      await expect(subject.service.getPublicProofProfile(publicId)).resolves.toMatchObject({
        profile: { publicId },
        proofs: [{
          publicProofId: 'B'.repeat(27),
          title: 'Reviewed mission title',
          summary: 'Reviewed mission summary',
        }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('renews an elapsed UNPUBLISHED lease without publishing, then requires explicit publish opt-in', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const subject = createApprovedPublicationSubject();
      const publication = {
        profileId: subject.profile.id,
        missionId: subject.mission.id,
        verificationRunId: subject.run.id,
        reviewId: subject.review.id,
        state: PublishedProofState.Unpublished,
        validUntil: new Date(now.getTime() - 1),
        snapshot: {
          publicProofId: 'B'.repeat(27),
        },
      };
      subject.publications.findOne.mockResolvedValue(publication);

      await expect(subject.service.publishProof('owner-a', subject.mission.id, {
        idempotencyKey: 'publish-before-renewal',
      } as never)).rejects.toMatchObject({
        message: 'Publication lease expired; renew the publication lease before publishing',
      });

      await expect(subject.service.renewPublicationLease(
        'owner-a',
        subject.mission.id,
        'renew-unpublished',
      )).resolves.toEqual({
        renewed: true,
        validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
      expect(publication.state).toBe(PublishedProofState.Unpublished);
      expect(subject.publications.findOne).toHaveBeenCalledWith({
        where: {
          profileId: subject.profile.id,
          missionId: subject.mission.id,
        },
        lock: { mode: 'pessimistic_write' },
      });

      await expect(subject.service.publishProof('owner-a', subject.mission.id, {
        idempotencyKey: 'publish-after-renewal',
      } as never)).resolves.toMatchObject({
        state: PublishedProofState.Active,
        validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('relinks an elapsed INVALIDATED publication to a fresh eligible run without publishing it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const subject = createApprovedPublicationSubject();
      subject.mission.currentVerificationRunId = 'run-fresh';
      subject.mission.currentReviewId = 'review-fresh';
      subject.run.id = 'run-fresh';
      subject.review.id = 'review-fresh';
      subject.review.verificationRunId = 'run-fresh';
      const publication = {
        profileId: subject.profile.id,
        missionId: subject.mission.id,
        verificationRunId: 'run-invalidated',
        reviewId: 'review-invalidated',
        state: PublishedProofState.Invalidated,
        validUntil: new Date(now.getTime() - 1),
        schemaVersion: 1,
        snapshot: {
          schemaVersion: 1,
          publicProofId: 'B'.repeat(27),
          title: 'Invalidated snapshot title',
          summary: null,
          competencyLabel: 'TypeScript',
          provider: 'GITHUB',
          verification: { status: 'VERIFIED', verifiedAt: now.toISOString() },
          criteria: {
            passedCount: 1,
            totalCount: 1,
            types: [ProofCriterionType.MergedPr],
          },
        },
      };
      subject.publications.findOne.mockResolvedValue(publication);

      await expect(subject.service.renewPublicationLease(
        'owner-a',
        subject.mission.id,
        'recover-invalidated',
      )).resolves.toEqual({
        renewed: true,
        validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
      expect(publication).toMatchObject({
        verificationRunId: 'run-fresh',
        reviewId: 'review-fresh',
        state: PublishedProofState.Invalidated,
        validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });

      await expect(subject.service.publishProof('owner-a', subject.mission.id, {
        idempotencyKey: 'publish-recovered-invalidated',
      } as never)).resolves.toBe(publication);
      expect(publication).toMatchObject({
        verificationRunId: 'run-fresh',
        reviewId: 'review-fresh',
        state: PublishedProofState.Active,
        validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        snapshot: {
          title: 'Reviewed mission title',
          summary: 'Reviewed mission summary',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates an elapsed publication instead of renewing when provider facts changed', async () => {
    const subject = createApprovedPublicationSubject();
    subject.github.getPullRequestFacts.mockResolvedValue({
      ...facts,
      changedPaths: [...facts.changedPaths, 'src/changed-after-review.ts'],
    });

    await expect(subject.service.renewPublicationLease(
      'owner-a',
      subject.mission.id,
      'renew-changed',
    )).rejects.toMatchObject({
      message: 'Verification changed; refresh and re-review are required',
    });

    expect(subject.mission).toMatchObject({
      state: ProofMissionState.Bound,
      currentVerificationRunId: null,
      currentReviewId: null,
    });
    expect(subject.publications.update).toHaveBeenCalledWith(
      { missionId: subject.mission.id, state: PublishedProofState.Active },
      { state: PublishedProofState.Invalidated },
    );
  });
});
