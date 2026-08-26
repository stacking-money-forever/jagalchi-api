import { NotFoundException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProofReviewDecision } from './career.entities';
import { CareerController } from './career.controller';

function createSubject(flags: {
  evidenceEnabled?: boolean;
  publicProfileEnabled?: boolean;
} = {}) {
  const career = {
    listCompetencies: vi.fn(), listTargets: vi.fn(), createTarget: vi.fn(), getDiff: vi.fn(),
    listEvidence: vi.fn(), createEvidence: vi.fn(), listReviewQueue: vi.fn(), reviewEvidence: vi.fn(),
    listMissions: vi.fn(), createMission: vi.fn(), getMission: vi.fn(), replaceCriteria: vi.fn(),
    bindPullRequest: vi.fn(), refreshVerification: vi.fn(), submitForReview: vi.fn(),
    reviewMission: vi.fn(), archiveMission: vi.fn(), listProofReviewQueue: vi.fn(),
    getProofProfile: vi.fn(), updateProofProfile: vi.fn(), publishProof: vi.fn(),
    renewPublicationLease: vi.fn(), unpublishProof: vi.fn(), getPublicProofProfile: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'EVIDENCE_EXECUTION_ENABLED') {
        return String(flags.evidenceEnabled ?? true);
      }
      if (key === 'PUBLIC_PROOF_PROFILE_ENABLED') {
        return String(flags.publicProfileEnabled ?? true);
      }
      return undefined;
    }),
  };
  return {
    career,
    config,
    controller: new CareerController(career as never, config as never),
  };
}

const owner = { id: '10000000-0000-4000-8000-000000000001', roles: ['USER'] };
const reviewer = { id: '10000000-0000-4000-8000-000000000002', roles: ['ADMIN'] };
const missionId = '20000000-0000-4000-8000-000000000001';
const syntheticSha = 'a'.repeat(40);

describe('CareerController evidence API contract', () => {
  it('keeps the approved HTTP method and path contract for evidence execution commands', () => {
    const routes = [
      ['createMission', RequestMethod.POST, 'proof-missions'],
      ['getMission', RequestMethod.GET, 'proof-missions/:missionId'],
      ['replaceCriteria', RequestMethod.PUT, 'proof-missions/:missionId/criteria'],
      ['bindPullRequest', RequestMethod.POST, 'proof-missions/:missionId/bind'],
      ['refreshVerification', RequestMethod.POST, 'proof-missions/:missionId/refresh'],
      ['submitForReview', RequestMethod.POST, 'proof-missions/:missionId/submit'],
      ['reviewMission', RequestMethod.POST, 'proof-missions/:missionId/review'],
      ['publishProof', RequestMethod.POST, 'proof-profile/publish/:missionId'],
      ['renewPublicationLease', RequestMethod.POST, 'proof-profile/renew/:missionId'],
      ['unpublishProof', RequestMethod.POST, 'proof-profile/unpublish/:missionId'],
      ['getPublicProofProfile', RequestMethod.GET, 'proof-profiles/:publicId'],
    ] as const;
    for (const [name, method, route] of routes) {
      expect(Reflect.getMetadata(METHOD_METADATA, CareerController.prototype[name])).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, CareerController.prototype[name])).toBe(route);
    }
  });

  it('passes authenticated owner identity and target scope rather than accepting ownership from request data', async () => {
    const subject = createSubject();
    subject.career.createMission.mockResolvedValue({ id: missionId });
    const dto = { targetId: '30000000-0000-4000-8000-000000000001', competencySlug: 'typescript', title: 'Synthetic proof', idempotencyKey: 'mission-create-1' };

    await subject.controller.createMission(owner, dto);
    expect(subject.career.createMission).toHaveBeenCalledExactlyOnceWith(owner.id, dto);

    await subject.controller.listMissions(owner, { targetId: dto.targetId });
    expect(subject.career.listMissions).toHaveBeenCalledExactlyOnceWith(owner.id, dto.targetId);
  });

  it('returns NotFound from proof mission handlers when evidence execution is disabled', () => {
    const subject = createSubject({ evidenceEnabled: false });
    const createDto = {
      targetId: '30000000-0000-4000-8000-000000000001',
      competencySlug: 'typescript',
      title: 'Synthetic proof',
      idempotencyKey: 'mission-create-disabled',
    };
    const idempotentDto = { idempotencyKey: 'disabled-command' };
    const handlers = [
      () => subject.controller.listMissions(owner, {}),
      () => subject.controller.createMission(owner, createDto),
      () => subject.controller.getMission(owner, missionId),
      () => subject.controller.replaceCriteria(owner, missionId, {
        criteria: [],
        idempotencyKey: 'criteria-disabled',
      }),
      () => subject.controller.bindPullRequest(owner, missionId, {
        installationId: '40000000-0000-4000-8000-000000000001',
        githubRepositoryId: '101',
        pullNumber: 7,
        idempotencyKey: 'bind-disabled',
      }),
      () => subject.controller.refreshVerification(owner, missionId, idempotentDto),
      () => subject.controller.submitForReview(owner, missionId, idempotentDto),
      () => subject.controller.reviewMission(reviewer, missionId, {
        decision: ProofReviewDecision.Approved,
        idempotencyKey: 'review-disabled',
      }),
      () => subject.controller.archiveMission(owner, missionId, idempotentDto),
    ];

    for (const handler of handlers) expect(handler).toThrow(NotFoundException);
    for (const serviceMethod of [
      subject.career.listMissions,
      subject.career.createMission,
      subject.career.getMission,
      subject.career.replaceCriteria,
      subject.career.bindPullRequest,
      subject.career.refreshVerification,
      subject.career.submitForReview,
      subject.career.reviewMission,
      subject.career.archiveMission,
    ]) {
      expect(serviceMethod).not.toHaveBeenCalled();
    }
  });

  it('forwards idempotency keys on every lifecycle command and never accepts a caller-supplied owner id', async () => {
    const subject = createSubject();
    await subject.controller.refreshVerification(owner, missionId, { idempotencyKey: 'refresh-1' });
    await subject.controller.submitForReview(owner, missionId, { idempotencyKey: 'submit-1' });
    await subject.controller.archiveMission(owner, missionId, { idempotencyKey: 'archive-1' });
    await subject.controller.renewPublicationLease(owner, missionId, { idempotencyKey: 'renew-1' });
    await subject.controller.unpublishProof(owner, missionId, { idempotencyKey: 'unpublish-1' });

    expect(subject.career.refreshVerification).toHaveBeenCalledWith(owner.id, missionId, 'refresh-1');
    expect(subject.career.submitForReview).toHaveBeenCalledWith(owner.id, missionId, 'submit-1');
    expect(subject.career.archiveMission).toHaveBeenCalledWith(owner.id, missionId, 'archive-1');
    expect(subject.career.renewPublicationLease).toHaveBeenCalledWith(owner.id, missionId, 'renew-1');
    expect(subject.career.unpublishProof).toHaveBeenCalledWith(owner.id, missionId, 'unpublish-1');
  });

  it('passes the authenticated reviewer object to the service so role and self-review guards cannot be bypassed', async () => {
    const subject = createSubject();
    const dto = { decision: ProofReviewDecision.Approved, note: 'Synthetic review', idempotencyKey: 'review-1' };
    await subject.controller.reviewMission(reviewer, missionId, dto);
    expect(subject.career.reviewMission).toHaveBeenCalledExactlyOnceWith(reviewer, missionId, dto);
  });

  it('keeps all private mission, review, and publication handlers behind JwtAuthGuard', () => {
    const privateHandlers = [
      'listMissions', 'createMission', 'getMission', 'replaceCriteria', 'bindPullRequest',
      'refreshVerification', 'submitForReview', 'reviewMission', 'archiveMission',
      'listProofReviewQueue', 'getProofProfile', 'updateProofProfile', 'publishProof',
      'renewPublicationLease', 'unpublishProof',
    ] as const;
    for (const name of privateHandlers) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, CareerController.prototype[name]) as unknown[];
      expect(guards, `${name} must be authenticated`).toContain(JwtAuthGuard);
    }
  });

  it('exposes only the random-id public read and applies no-store/noindex response policy', async () => {
    const subject = createSubject();
    const publicId = 'A'.repeat(27);
    const safe = {
      schemaVersion: 1,
      profile: { publicId, displayName: 'Synthetic Builder', summary: null },
      proofs: [{
        schemaVersion: 1, publicProofId: 'B'.repeat(27), title: 'Typed API', summary: null,
        competencyLabel: 'TypeScript', provider: 'GITHUB',
        verification: { status: 'VERIFIED', verifiedAt: '2026-08-25T00:00:00.000Z' },
        criteria: { passedCount: 2, totalCount: 2, types: ['MERGED_PR', 'NAMED_CHECK'] },
      }],
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    subject.career.getPublicProofProfile.mockResolvedValue(safe);

    await expect(subject.controller.getPublicProofProfile(publicId)).resolves.toEqual(safe);
    expect(subject.career.getPublicProofProfile).toHaveBeenCalledExactlyOnceWith(publicId);
    expect(Reflect.getMetadata(GUARDS_METADATA, CareerController.prototype.getPublicProofProfile)).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, CareerController.prototype.getPublicProofProfile)).toBe('proof-profiles/:publicId');
    const headers = Reflect.getMetadata('__headers__', CareerController.prototype.getPublicProofProfile) as Array<{ name: string; value: string }>;
    expect(headers).toEqual(expect.arrayContaining([
      { name: 'Cache-Control', value: 'private, no-store, max-age=0' },
      { name: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ]));

    const serialized = JSON.stringify(safe);
    for (const forbidden of ['email', 'repositoryId', 'repositoryName', 'installationId', 'reviewerId', 'reviewNote', 'webhook', 'token', 'postingUrl', 'requirements', 'logUrl', syntheticSha]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('returns the identical NotFound for public reads when the public-profile flag is disabled', () => {
    const subject = createSubject({ publicProfileEnabled: false });
    const publicId = 'A'.repeat(27);

    expect(() => subject.controller.getPublicProofProfile(publicId)).toThrow(
      new NotFoundException('Proof Profile not found'),
    );
    expect(subject.career.getPublicProofProfile).not.toHaveBeenCalled();
  });
});
