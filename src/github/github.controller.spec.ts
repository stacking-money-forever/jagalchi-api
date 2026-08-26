import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { GithubInstallationStatus } from './github.entities';
import { GithubController, GithubInstallationClaimDto } from './github.controller';

function createController() {
  const github = {
    claimInstallation: vi.fn(),
    createSetupState: vi.fn(),
    listPullRequests: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) => key === 'EVIDENCE_EXECUTION_ENABLED' ? 'true' : undefined),
    getOrThrow: vi.fn((key: string) => {
      if (key === 'GITHUB_APP_SETUP_URL') return 'https://github.com/apps/jagalchi/installations/new';
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  const identities = {
    findOne: vi.fn(),
  };
  const installations = {
    findOne: vi.fn(),
  };
  const repositories = {
    find: vi.fn(),
  };
  const controller = new GithubController(
    github as never,
    config as never,
    identities as never,
    installations as never,
    repositories as never,
  );
  return { controller, github, identities, installations, repositories };
}

describe('GithubController', () => {
  it('validates optional callback fields independently', async () => {
    const invalidState = Object.assign(new GithubInstallationClaimDto(), { state: 'short' });
    const invalidInstallation = Object.assign(
      new GithubInstallationClaimDto(),
      { installationId: '0' },
    );

    expect((await validate(invalidState)).map(({ property }) => property)).toContain('state');
    expect((await validate(invalidInstallation)).map(({ property }) => property)).toContain(
      'installationId',
    );
  });

  it('initiates setup only when callback fields are absent', async () => {
    const { controller, github, identities } = createController();
    identities.findOne.mockResolvedValue({ providerUserId: '9007199254740997' });
    github.createSetupState.mockResolvedValue({
      state: 's'.repeat(32),
      expiresAt: new Date('2026-08-25T01:00:00Z'),
    });

    const result = await controller.installationClaim(
      { id: 'owner-user-id' } as never,
      { returnTo: '/career/proofs' },
    );

    expect(github.createSetupState).toHaveBeenCalledWith('owner-user-id', '/career/proofs');
    expect(github.claimInstallation).not.toHaveBeenCalled();
    expect(result).toEqual({
      setupUrl: `https://github.com/apps/jagalchi/installations/new?state=${'s'.repeat(32)}`,
      stateExpiresAt: new Date('2026-08-25T01:00:00Z'),
    });
  });

  it('claims an installation only with the complete callback command', async () => {
    const { controller, github, identities } = createController();
    github.claimInstallation.mockResolvedValue({ installationId: 'installation-record-id' });

    const result = await controller.installationClaim(
      { id: 'owner-user-id' } as never,
      { state: 's'.repeat(32), installationId: '9007199254740995' },
    );

    expect(result).toEqual({ installationId: 'installation-record-id' });
    expect(github.claimInstallation).toHaveBeenCalledWith(
      'owner-user-id',
      's'.repeat(32),
      '9007199254740995',
    );
    expect(identities.findOne).not.toHaveBeenCalled();
    expect(github.createSetupState).not.toHaveBeenCalled();
  });

  it.each([
    { state: 's'.repeat(32) },
    { installationId: '9007199254740995' },
    {
      returnTo: '/career',
      state: 's'.repeat(32),
      installationId: '9007199254740995',
    },
  ])('rejects partial or mixed installation claim command %#', async (body) => {
    const { controller, github, identities } = createController();

    await expect(
      controller.installationClaim({ id: 'owner-user-id' } as never, body),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(identities.findOne).not.toHaveBeenCalled();
    expect(github.createSetupState).not.toHaveBeenCalled();
    expect(github.claimInstallation).not.toHaveBeenCalled();
  });

  it('delegates pull listing through the owner-authorized service contract', async () => {
    const { controller, github, installations } = createController();
    const pulls = [{
      repositoryId: '9007199254740993',
      pullNumber: 7,
      title: 'Synthetic PR',
      state: 'OPEN' as const,
      merged: false,
      baseBranch: 'main',
      headSha: 'a'.repeat(40),
      htmlUrl: 'https://github.com/synthetic-owner/proof-repo/pull/7',
    }];
    installations.findOne.mockResolvedValue({
      id: 'installation-record-id',
      githubInstallationId: '9007199254740995',
      status: GithubInstallationStatus.Active,
    });
    github.listPullRequests.mockResolvedValue(pulls);

    const result = await controller.listPullRequests(
      { id: 'owner-user-id' } as never,
      '9007199254740993',
      { state: 'all' },
    );

    expect(github.listPullRequests).toHaveBeenCalledWith(
      'owner-user-id',
      'installation-record-id',
      '9007199254740993',
      'all',
    );
    expect(result).toBe(pulls);
    expectTypeOf(result).resolves.toMatchTypeOf(pulls);
  });

  it('projects the numeric provider account identity honestly as a string accountId', async () => {
    const { controller, identities, installations, repositories } = createController();
    identities.findOne.mockResolvedValue({ providerUserId: '9007199254740997' });
    installations.findOne.mockResolvedValue({
      id: 'installation-record-id',
      githubAccountId: '9007199254740997',
      status: GithubInstallationStatus.Active,
    });
    repositories.find.mockResolvedValue([]);

    const result = await controller.getSetup({ id: 'owner-user-id' } as never);

    expect(result.installation).toEqual({
      id: 'installation-record-id',
      status: GithubInstallationStatus.Active,
      accountId: '9007199254740997',
    });
    expect(result.installation).not.toHaveProperty('accountLogin');
    expectTypeOf(result.installation!.accountId).toEqualTypeOf<string>();
  });
});
