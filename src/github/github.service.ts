import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OAuthIdentity, OAuthProvider } from '../auth/auth.entities';
import {
  ProofMission,
  ProofMissionState,
  PublishedProof,
  PublishedProofState,
} from '../career/career.entities';
import { GithubClient, type GithubPullRequestSummary } from './github.client';
import {
  GithubInstallationClaim,
  GithubPullRequestBinding,
  GithubRepositoryIdentity,
  GithubSetupState,
  PullRequestFacts,
} from './github.dto';
import {
  GithubInstallation,
  GithubInstallationClaimAttempt,
  GithubInstallationRepository,
  GithubInstallationStatus,
} from './github.entities';

export type GithubAuthorizationErrorCode =
  | 'INSTALLATION_NOT_FOUND'
  | 'INSTALLATION_INACTIVE'
  | 'REPOSITORY_NOT_AUTHORIZED';

export class GithubAuthorizationError extends Error {
  constructor(readonly code: GithubAuthorizationErrorCode) {
    super(`GitHub authorization failed (${code})`);
    this.name = 'GithubAuthorizationError';
  }
}

const CLAIM_TTL_MS = 10 * 60 * 1_000;
const DECIMAL_ID_PATTERN = /^[1-9]\d*$/;
const SETUP_RETURN_PATHS = new Set(['/career']);

interface AuthorizedRepository {
  installation: GithubInstallation;
  repository: GithubInstallationRepository;
}

@Injectable()
export class GithubService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly client: GithubClient,
    @InjectRepository(GithubInstallation)
    private readonly installations: Repository<GithubInstallation>,
    @InjectRepository(GithubInstallationRepository)
    private readonly repositories: Repository<GithubInstallationRepository>,
    @InjectRepository(GithubInstallationClaimAttempt)
    private readonly claimAttempts: Repository<GithubInstallationClaimAttempt>,
  ) {}

  async createSetupState(userId: string, returnPath: string): Promise<GithubSetupState> {
    const safeReturnPath = this.requireSafeReturnPath(returnPath);
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
    await this.claimAttempts.save(
      this.claimAttempts.create({
        userId,
        stateHash: this.hashState(state),
        returnPath: safeReturnPath,
        expiresAt,
        consumedAt: null,
      }),
    );
    return { state, expiresAt: expiresAt.toISOString(), returnPath: safeReturnPath };
  }

  async claimInstallation(
    ownerUserId: string,
    rawState: string,
    githubInstallationId: string,
  ): Promise<GithubInstallationClaim> {
    const stateHash = this.hashState(rawState);
    const canonicalInstallationId = this.requireDecimalId(githubInstallationId);

    return this.dataSource.transaction(async (manager) => {
      const attempt = await manager.getRepository(GithubInstallationClaimAttempt).findOne({
        where: { stateHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !attempt ||
        attempt.userId !== ownerUserId ||
        attempt.consumedAt ||
        attempt.expiresAt.getTime() <= Date.now()
      ) {
        throw new ForbiddenException('Invalid or expired GitHub setup state');
      }

      const identity = await manager.getRepository(OAuthIdentity).findOne({
        where: { userId: ownerUserId, provider: OAuthProvider.Github },
      });
      if (!identity) throw new ForbiddenException('Verified GitHub identity required');

      const providerInstallation = await this.client.getInstallation(canonicalInstallationId);
      if (providerInstallation.accountType !== 'USER') {
        throw new ForbiddenException('Only personal GitHub installations are supported');
      }
      if (
        this.canonicalNumericIdentity(identity.providerUserId) !==
        this.canonicalNumericIdentity(providerInstallation.accountId)
      ) {
        throw new ForbiddenException('GitHub installation identity mismatch');
      }

      const providerRepositories = await this.client.listInstallationRepositories(
        canonicalInstallationId,
      );
      let installation = await manager.getRepository(GithubInstallation).findOne({
        where: { githubInstallationId: canonicalInstallationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (installation && installation.ownerUserId !== ownerUserId) {
        throw new ConflictException('GitHub installation is already claimed');
      }
      if (!installation) {
        installation = manager.getRepository(GithubInstallation).create({
          ownerUserId,
          githubInstallationId: canonicalInstallationId,
          githubAccountId: providerInstallation.accountId,
          accountType: 'USER',
          status: GithubInstallationStatus.Active,
          suspendedAt: null,
          revokedAt: null,
        });
      } else {
        installation.githubAccountId = providerInstallation.accountId;
        installation.status = GithubInstallationStatus.Active;
        installation.suspendedAt = null;
        installation.revokedAt = null;
      }
      installation = await manager.getRepository(GithubInstallation).save(installation);
      await this.replaceRepositoryMembership(manager, installation.id, providerRepositories);
      attempt.consumedAt = new Date();
      await manager.getRepository(GithubInstallationClaimAttempt).save(attempt);

      return {
        installationId: installation.id,
        githubInstallationId: installation.githubInstallationId,
        repositoryCount: providerRepositories.length,
        returnPath: attempt.returnPath,
      };
    });
  }

  async synchronizeRepositories(ownerUserId: string, installationId: string): Promise<void> {
    const installation = await this.installations.findOne({
      where: { id: installationId, ownerUserId },
    });
    if (!installation) throw new GithubAuthorizationError('INSTALLATION_NOT_FOUND');
    if (installation.status !== GithubInstallationStatus.Active) {
      throw new GithubAuthorizationError('INSTALLATION_INACTIVE');
    }
    const providerRepositories = await this.client.listInstallationRepositories(
      installation.githubInstallationId,
    );
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.getRepository(GithubInstallation).findOne({
        where: { id: installationId, ownerUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new GithubAuthorizationError('INSTALLATION_NOT_FOUND');
      if (locked.status !== GithubInstallationStatus.Active) {
        throw new GithubAuthorizationError('INSTALLATION_INACTIVE');
      }
      await this.replaceRepositoryMembership(manager, locked.id, providerRepositories);
    });
  }

  async reconcileInstallation(githubInstallationId: string): Promise<void> {
    const canonicalInstallationId = this.requireDecimalId(githubInstallationId);
    const claimed = await this.installations.findOne({
      where: { githubInstallationId: canonicalInstallationId },
    });
    if (!claimed) return;

    const providerInstallation = await this.client.getInstallation(canonicalInstallationId);
    if (
      providerInstallation.accountType !== 'USER' ||
      claimed.accountType !== 'USER' ||
      this.canonicalNumericIdentity(providerInstallation.accountId) !==
        this.canonicalNumericIdentity(claimed.githubAccountId)
    ) {
      throw new ForbiddenException('GitHub installation identity mismatch');
    }
    const providerRepositories = await this.client.listInstallationRepositories(
      canonicalInstallationId,
    );

    await this.dataSource.transaction(async (manager) => {
      const installation = await manager.getRepository(GithubInstallation).findOne({
        where: { githubInstallationId: canonicalInstallationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !installation ||
        installation.ownerUserId !== claimed.ownerUserId ||
        installation.accountType !== 'USER' ||
        this.canonicalNumericIdentity(installation.githubAccountId) !==
          this.canonicalNumericIdentity(providerInstallation.accountId)
      ) {
        throw new ForbiddenException('GitHub installation identity mismatch');
      }
      installation.status = GithubInstallationStatus.Active;
      installation.suspendedAt = null;
      installation.revokedAt = null;
      await manager.getRepository(GithubInstallation).save(installation);
      await this.replaceRepositoryMembership(
        manager,
        installation.id,
        providerRepositories,
      );
    });
  }

  async authorizeRepository(
    ownerUserId: string,
    installationId: string,
    repositoryId: string,
  ): Promise<void> {
    await this.getAuthorizedRepository(ownerUserId, installationId, repositoryId);
  }

  async getPullRequestFacts(
    ownerUserId: string,
    installationId: string,
    repositoryId: string,
    pullNumber: number,
  ): Promise<PullRequestFacts> {
    const authorized = await this.getAuthorizedRepository(
      ownerUserId,
      installationId,
      repositoryId,
    );
    return this.client.getPullRequestFacts(
      authorized.installation.githubInstallationId,
      this.toRepositoryIdentity(authorized.repository),
      pullNumber,
    );
  }

  async listPullRequests(
    ownerUserId: string,
    installationId: string,
    repositoryId: string,
    state: 'open' | 'closed' | 'all',
  ): Promise<GithubPullRequestSummary[]> {
    const authorized = await this.getAuthorizedRepository(
      ownerUserId,
      installationId,
      repositoryId,
    );
    return this.client.listPullRequests(
      authorized.installation.githubInstallationId,
      this.toRepositoryIdentity(authorized.repository),
      state,
    );
  }

  async resolvePullRequestBinding(
    ownerUserId: string,
    installationId: string,
    repositoryId: string,
    pullNumber: number,
  ): Promise<GithubPullRequestBinding> {
    const authorized = await this.getAuthorizedRepository(
      ownerUserId,
      installationId,
      repositoryId,
    );
    return this.client.resolvePullRequestBinding(
      authorized.installation.githubInstallationId,
      this.toRepositoryIdentity(authorized.repository),
      pullNumber,
    );
  }

  async getPullRequestHead(
    ownerUserId: string,
    installationId: string,
    repositoryId: string,
    pullNumber: number,
  ): Promise<{ headSha: string }> {
    const authorized = await this.getAuthorizedRepository(
      ownerUserId,
      installationId,
      repositoryId,
    );
    const { headSha } = await this.client.getPullRequestHead(
      authorized.installation.githubInstallationId,
      this.toRepositoryIdentity(authorized.repository),
      pullNumber,
    );
    return { headSha };
  }

  private async getAuthorizedRepository(
    ownerUserId: string,
    installationId: string,
    repositoryId: string,
  ): Promise<AuthorizedRepository> {
    const canonicalRepositoryId = this.requireDecimalId(repositoryId);
    const installation = await this.installations.findOne({
      where: { id: installationId, ownerUserId },
    });
    if (!installation) throw new GithubAuthorizationError('INSTALLATION_NOT_FOUND');
    if (installation.status !== GithubInstallationStatus.Active) {
      throw new GithubAuthorizationError('INSTALLATION_INACTIVE');
    }
    const repository = await this.repositories.findOne({
      where: {
        installationId: installation.id,
        githubRepositoryId: canonicalRepositoryId,
        active: true,
      },
    });
    if (!repository) throw new GithubAuthorizationError('REPOSITORY_NOT_AUTHORIZED');
    return { installation, repository };
  }

  private async replaceRepositoryMembership(
    manager: EntityManager,
    installationId: string,
    providerRepositories: GithubRepositoryIdentity[],
  ): Promise<void> {
    const repository = manager.getRepository(GithubInstallationRepository);
    const existing = await repository.find({
      where: { installationId },
      order: { githubRepositoryId: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    const byProviderId = new Map(existing.map((item) => [item.githubRepositoryId, item]));
    const activeIds = new Set(providerRepositories.map((item) => item.repositoryId));
    const removedRepositoryIds: string[] = [];
    const now = new Date();

    for (const item of existing) {
      if (!activeIds.has(item.githubRepositoryId) && item.active) {
        item.active = false;
        item.removedAt = now;
        removedRepositoryIds.push(item.githubRepositoryId);
      }
    }
    for (const providerRepository of providerRepositories) {
      const item = byProviderId.get(providerRepository.repositoryId);
      if (item) {
        item.fullName = providerRepository.fullName;
        item.private = providerRepository.private;
        item.active = true;
        item.removedAt = null;
      } else {
        existing.push(
          repository.create({
            installationId,
            githubRepositoryId: providerRepository.repositoryId,
            fullName: providerRepository.fullName,
            private: providerRepository.private,
            active: true,
            removedAt: null,
          }),
        );
      }
    }
    if (existing.length > 0) await repository.save(existing);
    for (const repositoryId of removedRepositoryIds.sort()) {
      await this.invalidateRepositoryCredit(manager, installationId, repositoryId);
    }
  }

  private async invalidateRepositoryCredit(
    manager: EntityManager,
    installationId: string,
    repositoryId: string,
  ): Promise<void> {
    const missions = await manager
      .getRepository(ProofMission)
      .createQueryBuilder('mission')
      .setLock('pessimistic_write')
      .where('mission.installation_id = :installationId', { installationId })
      .andWhere('mission.github_repository_id = :repositoryId', { repositoryId })
      .orderBy('mission.id', 'ASC')
      .getMany();
    for (const mission of missions) {
      if (mission.state === ProofMissionState.Archived) continue;
      mission.currentVerificationRunId = null;
      mission.currentReviewId = null;
      mission.state = ProofMissionState.Bound;
      await manager.getRepository(ProofMission).save(mission);
      await manager.getRepository(PublishedProof).update(
        { missionId: mission.id, state: PublishedProofState.Active },
        { state: PublishedProofState.Invalidated },
      );
    }
  }

  private toRepositoryIdentity(
    repository: GithubInstallationRepository,
  ): GithubRepositoryIdentity {
    return {
      repositoryId: repository.githubRepositoryId,
      fullName: repository.fullName,
      private: repository.private,
    };
  }

  private requireSafeReturnPath(value: string): string {
    if (
      value.length === 0 ||
      value.length > 500 ||
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.includes('\\') ||
      value.includes('\0')
    ) {
      throw new ForbiddenException('Invalid GitHub setup return path');
    }
    const parsed = new URL(value, 'https://jagalchi.invalid');
    if (
      parsed.origin !== 'https://jagalchi.invalid' ||
      !SETUP_RETURN_PATHS.has(parsed.pathname)
    ) {
      throw new ForbiddenException('Invalid GitHub setup return path');
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  private hashState(rawState: string): string {
    if (rawState.length < 32 || rawState.length > 128) {
      throw new ForbiddenException('Invalid GitHub setup state');
    }
    return createHash('sha256').update(rawState).digest('hex');
  }

  private requireDecimalId(value: string): string {
    if (!DECIMAL_ID_PATTERN.test(value)) {
      throw new NotFoundException('GitHub resource not found');
    }
    return value;
  }

  private canonicalNumericIdentity(value: string): string {
    if (!/^\d+$/.test(value)) throw new ForbiddenException('Invalid GitHub identity');
    return BigInt(value).toString(10);
  }
}
