import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProofMission,
  ProofMissionState,
  PublishedProof,
  PublishedProofState,
} from '../career/career.entities';
import { GithubWebhookController } from './github-webhook.controller';
import {
  GithubInstallation,
  GithubInstallationRepository,
  GithubInstallationStatus,
  GithubWebhookDelivery,
  GithubWebhookDeliveryState,
} from './github.entities';

const secret = 'synthetic-webhook-secret-never-log';
const deliveryId = '10000000-0000-4000-8000-000000000001';
const sha = 'a'.repeat(40);
const payload = {
  action: 'synchronize',
  installation: { id: 501 },
  repository: { id: 101 },
  pull_request: { number: 7, head: { sha } },
};

function raw(value: unknown) {
  return Buffer.from(JSON.stringify(value));
}

function signature(body: Buffer) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    findOne: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
    save: vi.fn(async (value: unknown): Promise<unknown> => value),
    update: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ affected: 0 })),
    createQueryBuilder: vi.fn(),
    ...overrides,
  };
}

function createSubject(inserted = true) {
  const installation = { id: 'install-a', githubInstallationId: '501', status: GithubInstallationStatus.Active };
  const mission = {
    id: 'mission-a', installationId: installation.id, githubRepositoryId: '101', pullNumber: 7,
    state: ProofMissionState.Approved, currentVerificationRunId: 'run-a', currentReviewId: 'review-a',
  };
  const installations = repository({ findOne: vi.fn(async () => installation) });
  const memberships = repository();
  const missions = repository();
  const publications = repository();
  const deliveries = repository({
    findOne: vi.fn(async () => ({
      deliveryId,
      state: GithubWebhookDeliveryState.Reconciled,
    })),
  });
  const missionQuery = {
    setLock: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(), getMany: vi.fn(async () => [mission]),
  };
  missions.createQueryBuilder.mockReturnValue(missionQuery);
  const insertQuery = {
    insert: vi.fn().mockReturnThis(), into: vi.fn().mockReturnThis(), values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(), execute: vi.fn(async () => ({ identifiers: inserted ? [{ deliveryId }] : [] })),
  };
  const repos = new Map<unknown, ReturnType<typeof repository>>([
    [GithubInstallation, installations], [GithubInstallationRepository, memberships],
    [GithubWebhookDelivery, deliveries], [ProofMission, missions], [PublishedProof, publications],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repos.get(entity)!),
    createQueryBuilder: vi.fn(() => insertQuery),
  };
  const dataSource = {
    transaction: vi.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
  };
  const config = {
    get: vi.fn((key: string) => key === 'EVIDENCE_EXECUTION_ENABLED' ? 'true' : undefined),
    getOrThrow: vi.fn(() => secret),
  };
  const github = { reconcileInstallation: vi.fn(async () => undefined) };
  return {
    controller: new GithubWebhookController(config as never, dataSource as never, github as never),
    config, dataSource, manager, insertQuery, missionQuery, installations, memberships,
    missions, publications, deliveries, installation, mission, github,
  };
}

async function receive(subject: ReturnType<typeof createSubject>, body: Buffer, options: {
  event?: string; delivery?: string; signature?: string; contentType?: string;
} = {}) {
  return subject.controller.receive(
    { rawBody: body } as never,
    options.contentType ?? 'application/json',
    options.event ?? 'pull_request',
    options.delivery ?? deliveryId,
    options.signature ?? signature(body),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('GithubWebhookController signed delivery boundary', () => {
  it('returns the same unavailable behavior when evidence execution is disabled', async () => {
    const subject = createSubject();
    subject.config.get.mockReturnValue('false');
    await expect(receive(subject, raw(payload))).rejects.toBeInstanceOf(NotFoundException);
    expect(subject.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('verifies the signature over exact raw bytes before parsing or touching persistence', async () => {
    const subject = createSubject();
    const body = raw(payload);
    await expect(receive(subject, body, { signature: `sha256=${'0'.repeat(64)}` }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(subject.controller.receive(
      { rawBody: body } as never,
      'application/json',
      'pull_request',
      deliveryId,
      undefined,
    ))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(subject.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported events, wrong content types, missing raw body, and oversized bodies before persistence', async () => {
    const subject = createSubject();
    const body = raw(payload);
    await expect(receive(subject, body, { event: 'issues' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(receive(subject, body, { event: 'check_suite' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(receive(subject, body, { contentType: 'text/plain' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(subject.controller.receive({} as never, 'application/json', 'pull_request', deliveryId, signature(body)))
      .rejects.toBeInstanceOf(BadRequestException);
    const oversized = Buffer.alloc(256 * 1024 + 1, 0x20);
    await expect(receive(subject, oversized)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(subject.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('persists a signed delivery idempotently and acknowledges replay without repeating invalidation', async () => {
    const first = createSubject(true);
    await expect(receive(first, raw(payload))).resolves.toBeUndefined();
    expect(first.insertQuery.values).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId, eventName: 'pull_request', githubInstallationId: '501', githubRepositoryId: '101',
      pullNumber: 7, headSha: sha, state: GithubWebhookDeliveryState.LocalApplied,
    }));
    expect(first.missions.save).toHaveBeenCalledTimes(1);

    const replay = createSubject(false);
    await expect(receive(replay, raw(payload))).resolves.toBeUndefined();
    expect(replay.missionQuery.getMany).not.toHaveBeenCalled();
    expect(replay.missions.save).not.toHaveBeenCalled();
    expect(replay.publications.update).not.toHaveBeenCalled();
  });

  it('locally invalidates verification, review, and publication before the 204 promise resolves', async () => {
    const subject = createSubject();
    let resolved = false;
    const pending = receive(subject, raw(payload)).then(() => { resolved = true; });
    expect(resolved).toBe(false);
    await pending;

    expect(subject.mission).toMatchObject({
      state: ProofMissionState.Bound, currentVerificationRunId: null, currentReviewId: null,
    });
    expect(subject.publications.update).toHaveBeenCalledWith(
      { missionId: 'mission-a', state: PublishedProofState.Active },
      { state: PublishedProofState.Invalidated },
    );
    expect(subject.missions.save.mock.invocationCallOrder[0]!)
      .toBeLessThan(subject.publications.update.mock.invocationCallOrder[0]!);
  });

  it('fails the request on local application crash so GitHub can retry, then processes the same delivery successfully', async () => {
    const crashed = createSubject(true);
    crashed.missions.save.mockRejectedValueOnce(new Error('synthetic local database failure'));
    await expect(receive(crashed, raw(payload))).rejects.toThrow('synthetic local database failure');

    const retry = createSubject(true);
    await expect(receive(retry, raw(payload))).resolves.toBeUndefined();
    expect(retry.missions.save).toHaveBeenCalledTimes(1);
    expect(retry.publications.update).toHaveBeenCalledTimes(1);
  });

  it('revokes installation access and repository membership before invalidating all dependent missions', async () => {
    const subject = createSubject();
    const body = raw({ action: 'deleted', installation: { id: 501 } });
    await receive(subject, body, { event: 'installation' });

    expect(subject.installation.status).toBe(GithubInstallationStatus.Revoked);
    expect(subject.installation.revokedAt).toBeInstanceOf(Date);
    expect(subject.memberships.update).toHaveBeenCalledWith(
      { installationId: 'install-a', active: true },
      { active: false, removedAt: expect.any(Date) },
    );
    expect(subject.missionQuery.andWhere).not.toHaveBeenCalled();
    expect(subject.publications.update).toHaveBeenCalledWith(
      { missionId: 'mission-a', state: PublishedProofState.Active },
      { state: PublishedProofState.Invalidated },
    );
  });

  it('reconciles provider authorization for unsuspend and repository additions outside the DB lock', async () => {
    const unsuspend = createSubject();
    const unsuspendBody = raw({ action: 'unsuspend', installation: { id: 501 } });
    await receive(unsuspend, unsuspendBody, { event: 'installation' });
    expect(unsuspend.github.reconcileInstallation).toHaveBeenCalledWith('501');
    expect(unsuspend.deliveries.update).toHaveBeenCalledWith(
      { deliveryId },
      expect.objectContaining({
        state: GithubWebhookDeliveryState.Reconciled,
        reconciledAt: expect.any(Date),
      }),
    );
    expect(unsuspend.dataSource.transaction.mock.invocationCallOrder[0]!)
      .toBeLessThan(unsuspend.github.reconcileInstallation.mock.invocationCallOrder[0]!);

    const addition = createSubject();
    const additionBody = raw({
      action: 'added',
      installation: { id: 501 },
      repositories_added: [{ id: 102 }],
      repositories_removed: [],
    });
    await receive(addition, additionBody, { event: 'installation_repositories' });
    expect(addition.github.reconcileInstallation).toHaveBeenCalledWith('501');
    expect(addition.memberships.update).not.toHaveBeenCalled();
  });

  it('applies removals fail closed without requiring provider reconciliation', async () => {
    const subject = createSubject();
    const body = raw({
      action: 'removed',
      installation: { id: 501 },
      repositories_added: [],
      repositories_removed: [{ id: 101 }],
    });
    await receive(subject, body, { event: 'installation_repositories' });

    expect(subject.memberships.update).toHaveBeenCalledWith(
      { installationId: 'install-a', githubRepositoryId: '101' },
      { active: false, removedAt: expect.any(Date) },
    );
    expect(subject.missionQuery.andWhere).toHaveBeenCalledWith(
      'mission.github_repository_id = :repositoryId',
      { repositoryId: '101' },
    );
    expect(subject.github.reconcileInstallation).not.toHaveBeenCalled();
  });

  it('retries failed reconciliation without committing false provider success', async () => {
    const failed = createSubject();
    failed.github.reconcileInstallation.mockRejectedValueOnce(
      new Error('synthetic provider failure'),
    );
    const body = raw({ action: 'unsuspend', installation: { id: 501 } });
    await expect(receive(failed, body, { event: 'installation' }))
      .rejects.toThrow('synthetic provider failure');
    expect(failed.deliveries.update).toHaveBeenCalledWith(
      { deliveryId },
      {
        state: GithubWebhookDeliveryState.ReconcileFailed,
        errorCode: 'PROVIDER_RECONCILIATION_FAILED',
        reconciledAt: null,
      },
    );
    expect(failed.deliveries.update).not.toHaveBeenCalledWith(
      { deliveryId },
      expect.objectContaining({ state: GithubWebhookDeliveryState.Reconciled }),
    );

    const retry = createSubject(false);
    retry.deliveries.findOne.mockResolvedValue({
      deliveryId,
      state: GithubWebhookDeliveryState.ReconcileFailed,
    });
    await receive(retry, body, { event: 'installation' });
    expect(retry.github.reconcileInstallation).toHaveBeenCalledTimes(1);
    expect(retry.deliveries.update).toHaveBeenCalledWith(
      { deliveryId },
      expect.objectContaining({ state: GithubWebhookDeliveryState.Reconciled }),
    );
  });

  it('does not reconcile or reapply an already reconciled positive delivery', async () => {
    const replay = createSubject(false);
    const body = raw({ action: 'unsuspend', installation: { id: 501 } });
    await receive(replay, body, { event: 'installation' });
    expect(replay.github.reconcileInstallation).not.toHaveBeenCalled();
    expect(replay.deliveries.update).not.toHaveBeenCalled();
  });

  it('restricts check invalidation to the current verification run head', async () => {
    const subject = createSubject();
    subject.missionQuery.getMany.mockResolvedValue([]);
    const otherHead = 'b'.repeat(40);
    const body = raw({
      action: 'completed',
      installation: { id: 501 },
      repository: { id: 101 },
      check_run: { head_sha: otherHead },
    });
    await receive(subject, body, { event: 'check_run' });

    expect(subject.missionQuery.innerJoin).toHaveBeenCalledWith(
      expect.any(Function),
      'run',
      'run.id = mission.current_verification_run_id AND run.head_sha = :headSha',
      { headSha: otherHead },
    );
    expect(subject.missions.save).not.toHaveBeenCalled();
    expect(subject.publications.update).not.toHaveBeenCalled();
  });

  it('does not log secrets, signatures, raw payloads, private repository values, or delivery bodies', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const subject = createSubject();
    const privatePayload = { ...payload, repository: { id: 101, full_name: 'synthetic-owner/private-secret-repo' }, token: 'ghs_private' };
    await receive(subject, raw(privatePayload));
    const logged = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    for (const forbidden of [secret, 'ghs_private', 'private-secret-repo', JSON.stringify(privatePayload)]) {
      expect(logged).not.toContain(forbidden);
    }
  });
});
