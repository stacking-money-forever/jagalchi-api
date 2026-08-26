import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OAuthIdentity, OAuthProvider } from '../auth/auth.entities';
import {
  ProofMission,
  ProofMissionState,
  PublishedProof,
  PublishedProofState,
} from '../career/career.entities';
import {
  GithubInstallation,
  GithubInstallationClaimAttempt,
  GithubInstallationRepository,
  GithubInstallationStatus,
} from './github.entities';
import { GithubService } from './github.service';

const rawState = 'synthetic-one-time-state-00000000000000000000';
const stateHash = createHash('sha256').update(rawState).digest('hex');
const installation = {
  id: '10000000-0000-4000-8000-000000000001',
  ownerUserId: 'owner-a', githubInstallationId: '501', githubAccountId: '7001',
  accountType: 'USER', status: GithubInstallationStatus.Active,
};
const member = {
  id: '20000000-0000-4000-8000-000000000001', installationId: installation.id,
  githubRepositoryId: '101', fullName: 'synthetic-owner/private-proof', private: true,
  active: true, removedAt: null,
};

function repo(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown): Promise<unknown> => value),
    find: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
    findOne: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
    ...overrides,
  };
}

function createSubject() {
  const installations = repo();
  const repositories = repo();
  const claimAttempts = repo();
  const oauth = repo();
  const mission = {
    id: 'mission-a',
    installationId: installation.id,
    githubRepositoryId: member.githubRepositoryId,
    state: ProofMissionState.Approved,
    currentVerificationRunId: 'run-a',
    currentReviewId: 'review-a',
  };
  const missionQuery = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn(async () => [mission]),
  };
  const missions = repo({
    createQueryBuilder: vi.fn(() => missionQuery),
  });
  const publications = repo({
    update: vi.fn(async (..._args: unknown[]) => ({ affected: 1 })),
  });
  const byEntity = new Map<unknown, ReturnType<typeof repo>>([
    [GithubInstallation, installations],
    [GithubInstallationRepository, repositories],
    [GithubInstallationClaimAttempt, claimAttempts],
    [OAuthIdentity, oauth],
    [ProofMission, missions],
    [PublishedProof, publications],
  ]);
  const manager = { getRepository: vi.fn((entity: unknown) => byEntity.get(entity)!) };
  const dataSource = {
    transaction: vi.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
  };
  const client = {
    getInstallation: vi.fn(), listInstallationRepositories: vi.fn(),
    getPullRequestFacts: vi.fn(), resolvePullRequestBinding: vi.fn(), getPullRequestHead: vi.fn(),
  };
  return {
    service: new GithubService(dataSource as never, client as never, installations as never, repositories as never, claimAttempts as never),
    dataSource, installations, repositories, claimAttempts, oauth, client, manager,
    mission, missionQuery, missions, publications,
  };
}

function validAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-a', userId: 'owner-a', stateHash, returnPath: '/career',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'), consumedAt: null, ...overrides,
  };
}

describe('GithubService installation and repository authorization', () => {
  it('stores only a hash for one-time setup state and rejects unsafe return origins', async () => {
    const subject = createSubject();
    const created = await subject.service.createSetupState('owner-a', '/career?from=mission');
    expect(created.state).toHaveLength(43);
    expect(created.returnPath).toBe('/career?from=mission');
    expect(subject.claimAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-a', stateHash: createHash('sha256').update(created.state).digest('hex'), consumedAt: null,
    }));
    expect(subject.claimAttempts.create.mock.calls[0][0]).not.toHaveProperty('state');

    for (const unsafe of ['https://attacker.invalid/career', '//attacker.invalid/career', '/career\\escape', '/admin']) {
      await expect(subject.service.createSetupState('owner-a', unsafe)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('binds a personal installation only when its numeric account matches the owner verified GitHub identity', async () => {
    const subject = createSubject();
    subject.claimAttempts.findOne.mockResolvedValue(validAttempt());
    subject.oauth.findOne.mockResolvedValue({ userId: 'owner-a', provider: OAuthProvider.Github, providerUserId: '07001' });
    subject.client.getInstallation.mockResolvedValue({ installationId: '501', accountId: '7001', accountType: 'USER' });
    subject.client.listInstallationRepositories.mockResolvedValue([{ repositoryId: '101', fullName: member.fullName, private: true }]);
    subject.installations.findOne.mockResolvedValue(null);
    subject.installations.save.mockImplementation(async (value: unknown) => ({
      id: installation.id,
      ...(value as object),
    }));

    await expect(subject.service.claimInstallation('owner-a', rawState, '501')).resolves.toEqual({
      installationId: installation.id, githubInstallationId: '501', repositoryCount: 1, returnPath: '/career',
    });
    expect(subject.oauth.findOne).toHaveBeenCalledWith({ where: { userId: 'owner-a', provider: OAuthProvider.Github } });
    expect(subject.repositories.save).toHaveBeenCalledWith([expect.objectContaining({
      installationId: installation.id, githubRepositoryId: '101', active: true,
    })]);
    expect(subject.claimAttempts.save).toHaveBeenCalledWith(expect.objectContaining({ consumedAt: expect.any(Date) }));
  });

  it.each([
    ['replayed', validAttempt({ consumedAt: new Date('2026-08-25T00:00:00.000Z') })],
    ['wrong owner', validAttempt({ userId: 'owner-b' })],
    ['expired', validAttempt({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
  ])('rejects a %s installation claim before contacting GitHub', async (_label, attempt) => {
    const subject = createSubject();
    subject.claimAttempts.findOne.mockResolvedValue(attempt);
    await expect(subject.service.claimInstallation('owner-a', rawState, '501')).rejects.toBeInstanceOf(ForbiddenException);
    expect(subject.client.getInstallation).not.toHaveBeenCalled();
  });

  it('rejects organization installations, identity mismatches, and installations already claimed by another owner', async () => {
    const organization = createSubject();
    organization.claimAttempts.findOne.mockResolvedValue(validAttempt());
    organization.oauth.findOne.mockResolvedValue({ userId: 'owner-a', provider: OAuthProvider.Github, providerUserId: '7001' });
    organization.client.getInstallation.mockResolvedValue({ installationId: '501', accountId: '7001', accountType: 'ORGANIZATION' });
    await expect(organization.service.claimInstallation('owner-a', rawState, '501')).rejects.toBeInstanceOf(ForbiddenException);

    const mismatch = createSubject();
    mismatch.claimAttempts.findOne.mockResolvedValue(validAttempt());
    mismatch.oauth.findOne.mockResolvedValue({ userId: 'owner-a', provider: OAuthProvider.Github, providerUserId: '7002' });
    mismatch.client.getInstallation.mockResolvedValue({ installationId: '501', accountId: '7001', accountType: 'USER' });
    await expect(mismatch.service.claimInstallation('owner-a', rawState, '501')).rejects.toBeInstanceOf(ForbiddenException);

    const conflict = createSubject();
    conflict.claimAttempts.findOne.mockResolvedValue(validAttempt());
    conflict.oauth.findOne.mockResolvedValue({ userId: 'owner-a', provider: OAuthProvider.Github, providerUserId: '7001' });
    conflict.client.getInstallation.mockResolvedValue({ installationId: '501', accountId: '7001', accountType: 'USER' });
    conflict.client.listInstallationRepositories.mockResolvedValue([]);
    conflict.installations.findOne.mockResolvedValue({ ...installation, ownerUserId: 'owner-b' });
    await expect(conflict.service.claimInstallation('owner-a', rawState, '501')).rejects.toBeInstanceOf(ConflictException);
  });

  it('checks owner, active installation, and current repository membership on every provider call', async () => {
    const subject = createSubject();
    subject.installations.findOne.mockImplementation(async ({ where }) =>
      where.ownerUserId === 'owner-a' ? installation : null);
    subject.repositories.findOne.mockResolvedValue(member);
    subject.client.getPullRequestFacts.mockResolvedValue({ repositoryId: '101', pullNumber: 7, headSha: 'a'.repeat(40) });

    await subject.service.getPullRequestFacts('owner-a', installation.id, '101', 7);
    expect(subject.installations.findOne).toHaveBeenCalledWith({ where: { id: installation.id, ownerUserId: 'owner-a' } });
    expect(subject.repositories.findOne).toHaveBeenCalledWith({ where: {
      installationId: installation.id, githubRepositoryId: '101', active: true,
    } });
    expect(subject.client.getPullRequestFacts).toHaveBeenCalledWith('501', {
      repositoryId: '101', fullName: member.fullName, private: true,
    }, 7);

    await expect(subject.service.authorizeRepository('owner-b', installation.id, '101'))
      .rejects.toMatchObject({ code: 'INSTALLATION_NOT_FOUND' });
  });

  it('fails closed for suspended installations and removed repositories without contacting the client', async () => {
    const suspended = createSubject();
    suspended.installations.findOne.mockResolvedValue({ ...installation, status: GithubInstallationStatus.Suspended });
    await expect(suspended.service.authorizeRepository('owner-a', installation.id, '101'))
      .rejects.toMatchObject({ code: 'INSTALLATION_INACTIVE' });

    const removed = createSubject();
    removed.installations.findOne.mockResolvedValue(installation);
    removed.repositories.findOne.mockResolvedValue(null);
    await expect(removed.service.resolvePullRequestBinding('owner-a', installation.id, '101', 7))
      .rejects.toMatchObject({ code: 'REPOSITORY_NOT_AUTHORIZED' });
    expect(removed.client.resolvePullRequestBinding).not.toHaveBeenCalled();
  });

  it('atomically deactivates removed repository membership and invalidates its verified credit during synchronization', async () => {
    const subject = createSubject();
    const removed = { ...member, active: true, removedAt: null };
    subject.installations.findOne.mockResolvedValue(installation);
    subject.client.listInstallationRepositories.mockResolvedValue([]);
    subject.repositories.find.mockResolvedValue([removed]);

    await subject.service.synchronizeRepositories('owner-a', installation.id);
    expect(removed.active).toBe(false);
    expect(removed.removedAt).toBeInstanceOf(Date);
    expect(subject.repositories.save).toHaveBeenCalledWith([removed]);
    expect(subject.mission).toMatchObject({
      state: ProofMissionState.Bound,
      currentVerificationRunId: null,
      currentReviewId: null,
    });
    expect(subject.missionQuery.andWhere).toHaveBeenCalledWith(
      'mission.github_repository_id = :repositoryId',
      { repositoryId: '101' },
    );
    expect(subject.publications.update).toHaveBeenCalledWith(
      { missionId: 'mission-a', state: PublishedProofState.Active },
      { state: PublishedProofState.Invalidated },
    );
    expect(subject.repositories.save.mock.invocationCallOrder[0]!)
      .toBeLessThan(subject.missions.save.mock.invocationCallOrder[0]!);
  });

  it('does not invalidate credit for unchanged membership or provider additions', async () => {
    const subject = createSubject();
    const unchanged = { ...member };
    subject.installations.findOne.mockResolvedValue(installation);
    subject.client.listInstallationRepositories.mockResolvedValue([
      { repositoryId: '101', fullName: member.fullName, private: true },
      { repositoryId: '102', fullName: 'synthetic-owner/new-proof', private: true },
    ]);
    subject.repositories.find.mockResolvedValue([unchanged]);

    await subject.service.synchronizeRepositories('owner-a', installation.id);

    expect(subject.repositories.save).toHaveBeenCalledWith([
      expect.objectContaining({ githubRepositoryId: '101', active: true }),
      expect.objectContaining({ githubRepositoryId: '102', active: true }),
    ]);
    expect(subject.missionQuery.getMany).not.toHaveBeenCalled();
    expect(subject.missions.save).not.toHaveBeenCalled();
    expect(subject.publications.update).not.toHaveBeenCalled();
  });

  it('fails reconciliation when dependent publication invalidation fails', async () => {
    const subject = createSubject();
    subject.installations.findOne.mockResolvedValue(installation);
    subject.client.listInstallationRepositories.mockResolvedValue([]);
    subject.repositories.find.mockResolvedValue([{ ...member }]);
    subject.publications.update.mockRejectedValueOnce(
      new Error('synthetic publication invalidation failure'),
    );

    await expect(subject.service.synchronizeRepositories('owner-a', installation.id))
      .rejects.toThrow('synthetic publication invalidation failure');
  });

  it('reconciles a claimed installation from provider truth and restores complete authorization', async () => {
    const subject = createSubject();
    const suspended = {
      ...installation,
      status: GithubInstallationStatus.Suspended,
      suspendedAt: new Date(),
      revokedAt: new Date(),
    };
    const removed = { ...member, active: false, removedAt: new Date() };
    subject.installations.findOne.mockResolvedValue(suspended);
    subject.client.getInstallation.mockResolvedValue({
      installationId: '501',
      accountId: '07001',
      accountType: 'USER',
    });
    subject.client.listInstallationRepositories.mockResolvedValue([
      { repositoryId: '101', fullName: member.fullName, private: true },
      { repositoryId: '102', fullName: 'synthetic-owner/new-proof', private: true },
    ]);
    subject.repositories.find.mockResolvedValue([removed]);

    await subject.service.reconcileInstallation('501');

    expect(suspended).toMatchObject({
      status: GithubInstallationStatus.Active,
      suspendedAt: null,
      revokedAt: null,
    });
    expect(subject.installations.save).toHaveBeenCalledWith(suspended);
    expect(subject.repositories.save).toHaveBeenCalledWith([
      expect.objectContaining({ githubRepositoryId: '101', active: true, removedAt: null }),
      expect.objectContaining({ githubRepositoryId: '102', active: true, removedAt: null }),
    ]);
    expect(subject.missions.save).not.toHaveBeenCalled();
    expect(subject.publications.update).not.toHaveBeenCalled();
  });

  it('invalidates removed repository credit during webhook-triggered provider reconciliation', async () => {
    const subject = createSubject();
    const removed = { ...member };
    subject.installations.findOne.mockResolvedValue(installation);
    subject.client.getInstallation.mockResolvedValue({
      installationId: '501',
      accountId: '7001',
      accountType: 'USER',
    });
    subject.client.listInstallationRepositories.mockResolvedValue([]);
    subject.repositories.find.mockResolvedValue([removed]);

    await subject.service.reconcileInstallation('501');

    expect(removed).toMatchObject({ active: false, removedAt: expect.any(Date) });
    expect(subject.mission).toMatchObject({
      state: ProofMissionState.Bound,
      currentVerificationRunId: null,
      currentReviewId: null,
    });
    expect(subject.publications.update).toHaveBeenCalledWith(
      { missionId: 'mission-a', state: PublishedProofState.Active },
      { state: PublishedProofState.Invalidated },
    );
  });

  it('treats unclaimed installations as no-ops and rejects provider identity changes', async () => {
    const unclaimed = createSubject();
    unclaimed.installations.findOne.mockResolvedValue(null);
    await expect(unclaimed.service.reconcileInstallation('501')).resolves.toBeUndefined();
    expect(unclaimed.client.getInstallation).not.toHaveBeenCalled();

    const mismatch = createSubject();
    mismatch.installations.findOne.mockResolvedValue(installation);
    mismatch.client.getInstallation.mockResolvedValue({
      installationId: '501',
      accountId: '7002',
      accountType: 'USER',
    });
    await expect(mismatch.service.reconcileInstallation('501'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mismatch.client.listInstallationRepositories).not.toHaveBeenCalled();
    expect(mismatch.dataSource.transaction).not.toHaveBeenCalled();
  });
});
