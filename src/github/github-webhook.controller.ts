import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  PayloadTooLargeException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  ProofMission,
  ProofMissionState,
  ProofVerificationRun,
  PublishedProof,
  PublishedProofState,
} from '../career/career.entities';
import {
  GithubInstallation,
  GithubInstallationRepository,
  GithubInstallationStatus,
  GithubWebhookDelivery,
  GithubWebhookDeliveryState,
} from './github.entities';
import { GithubService } from './github.service';

const MAX_WEBHOOK_BYTES = 256 * 1024;
const WEBHOOK_THROTTLER_SKIPS = {
  default: true,
  ip: true,
} as const;
const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_ID = /^[1-9]\d*$/;
const SHA = /^[0-9a-f]{40}$/i;
const ALLOWED_EVENTS = new Set([
  'pull_request',
  'check_run',
  'status',
  'installation',
  'installation_repositories',
]);

type JsonObject = Record<string, unknown>;

interface GithubWebhookRequest {
  rawBody?: Buffer;
}

interface NormalizedWebhook {
  githubInstallationId: string | null;
  githubRepositoryId: string | null;
  pullNumber: number | null;
  headSha: string | null;
  action: string | null;
  removedRepositoryIds: string[];
  hasRepositoryAdditions: boolean;
}

@Controller('github/webhooks')
export class GithubWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly github: GithubService,
  ) {}

  @Post()
  @HttpCode(204)
  @SkipThrottle(WEBHOOK_THROTTLER_SKIPS)
  async receive(
    @Req() request: GithubWebhookRequest,
    @Headers('content-type') contentType: string | undefined,
    @Headers('x-github-event') eventName: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): Promise<void> {
    if (this.config.get<string>('EVIDENCE_EXECUTION_ENABLED') !== 'true') {
      throw new NotFoundException();
    }
    if (!contentType || !/^application\/json(?:\s*;.*)?$/i.test(contentType)) {
      throw new BadRequestException('GitHub webhook content type must be application/json');
    }
    const rawBody = request.rawBody;
    if (!rawBody) throw new BadRequestException('GitHub webhook raw body is required');
    if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
      throw new PayloadTooLargeException('GitHub webhook body exceeds limit');
    }
    if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
      throw new BadRequestException('Unsupported GitHub webhook event');
    }
    if (!deliveryId || !DELIVERY_ID.test(deliveryId)) {
      throw new BadRequestException('Invalid GitHub delivery identifier');
    }
    this.verifySignature(rawBody, signature);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('Invalid GitHub webhook JSON');
    }
    const normalized = this.normalize(eventName, payload);
    await this.applyDelivery(deliveryId, eventName, normalized);
  }

  private async applyDelivery(
    deliveryId: string,
    eventName: string,
    normalized: NormalizedWebhook,
  ): Promise<void> {
    const requiresReconciliation =
      (eventName === 'installation' && normalized.action === 'unsuspend') ||
      (eventName === 'installation_repositories' && normalized.hasRepositoryAdditions);
    const shouldReconcile = await this.dataSource.transaction(async (manager) => {
      const installation = normalized.githubInstallationId
        ? await manager.getRepository(GithubInstallation).findOne({
            where: { githubInstallationId: normalized.githubInstallationId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(GithubWebhookDelivery)
        .values({
          deliveryId,
          eventName,
          installationId: installation?.id ?? null,
          githubInstallationId: normalized.githubInstallationId,
          githubRepositoryId: normalized.githubRepositoryId,
          pullNumber: normalized.pullNumber,
          headSha: normalized.headSha,
          state: GithubWebhookDeliveryState.LocalApplied,
          errorCode: null,
          reconciledAt: null,
        })
        .orIgnore()
        .execute();
      if (inserted.identifiers.length === 0) {
        if (!requiresReconciliation) return false;
        const delivery = await manager.getRepository(GithubWebhookDelivery).findOne({
          where: { deliveryId },
          lock: { mode: 'pessimistic_write' },
        });
        return delivery?.state !== GithubWebhookDeliveryState.Reconciled;
      }
      if (!installation) return requiresReconciliation;

      if (eventName === 'installation') {
        if (normalized.action === 'deleted') {
          installation.status = GithubInstallationStatus.Revoked;
          installation.revokedAt = new Date();
          await manager.getRepository(GithubInstallationRepository).update(
            { installationId: installation.id, active: true },
            { active: false, removedAt: new Date() },
          );
          await manager.getRepository(GithubInstallation).save(installation);
          await this.invalidate(manager, installation.id, null, null, null);
        } else if (normalized.action === 'suspend') {
          installation.status = GithubInstallationStatus.Suspended;
          installation.suspendedAt = new Date();
          await manager.getRepository(GithubInstallation).save(installation);
          await this.invalidate(manager, installation.id, null, null, null);
        }
        return requiresReconciliation;
      }

      if (eventName === 'installation_repositories') {
        for (const repositoryId of normalized.removedRepositoryIds) {
          await manager.getRepository(GithubInstallationRepository).update(
            { installationId: installation.id, githubRepositoryId: repositoryId },
            { active: false, removedAt: new Date() },
          );
          await this.invalidate(manager, installation.id, repositoryId, null, null);
        }
        return requiresReconciliation;
      }

      await this.invalidate(
        manager,
        installation.id,
        normalized.githubRepositoryId,
        normalized.pullNumber,
        eventName === 'pull_request' ? null : normalized.headSha,
      );
      return false;
    });
    if (!shouldReconcile || !normalized.githubInstallationId) return;

    try {
      await this.github.reconcileInstallation(normalized.githubInstallationId);
    } catch (error) {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(GithubWebhookDelivery).update(
          { deliveryId },
          {
            state: GithubWebhookDeliveryState.ReconcileFailed,
            errorCode: 'PROVIDER_RECONCILIATION_FAILED',
            reconciledAt: null,
          },
        );
      });
      throw error;
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(GithubWebhookDelivery).update(
        { deliveryId },
        {
          state: GithubWebhookDeliveryState.Reconciled,
          errorCode: null,
          reconciledAt: new Date(),
        },
      );
    });
  }

  private async invalidate(
    manager: EntityManager,
    installationId: string,
    repositoryId: string | null,
    pullNumber: number | null,
    headSha: string | null,
  ): Promise<void> {
    const query = manager
      .getRepository(ProofMission)
      .createQueryBuilder('mission')
      .setLock('pessimistic_write')
      .where('mission.installation_id = :installationId', { installationId })
      .orderBy('mission.id', 'ASC');
    if (repositoryId) {
      query.andWhere('mission.github_repository_id = :repositoryId', { repositoryId });
    }
    if (pullNumber) query.andWhere('mission.pull_number = :pullNumber', { pullNumber });
    if (headSha) {
      query.innerJoin(
        ProofVerificationRun,
        'run',
        'run.id = mission.current_verification_run_id AND run.head_sha = :headSha',
        { headSha },
      );
    }
    const missions = await query.getMany();
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

  private normalize(eventName: string, value: unknown): NormalizedWebhook {
    const payload = this.object(value);
    const installationValue = payload.installation;
    const installation = installationValue === null || installationValue === undefined
      ? null
      : this.object(installationValue);
    const repositoryValue = payload.repository;
    const repository = repositoryValue === null || repositoryValue === undefined
      ? null
      : this.object(repositoryValue);
    const githubInstallationId = installation ? this.decimalId(installation.id) : null;
    const githubRepositoryId = repository ? this.decimalId(repository.id) : null;
    const action = typeof payload.action === 'string' && payload.action.length <= 40
      ? payload.action
      : null;
    let pullNumber: number | null = null;
    let headSha: string | null = null;
    let removedRepositoryIds: string[] = [];
    let hasRepositoryAdditions = false;

    if (eventName === 'pull_request') {
      const pull = this.object(payload.pull_request);
      pullNumber = this.positiveInteger(pull.number);
      headSha = this.sha(this.object(pull.head).sha);
      if (!githubInstallationId || !githubRepositoryId || !action) {
        throw new BadRequestException('Incomplete pull_request webhook');
      }
    } else if (eventName === 'check_run') {
      const check = this.object(payload.check_run);
      headSha = this.sha(check.head_sha);
      if (!githubInstallationId || !githubRepositoryId || !action) {
        throw new BadRequestException(`Incomplete ${eventName} webhook`);
      }
    } else if (eventName === 'status') {
      headSha = this.sha(payload.sha);
      if (!githubInstallationId || !githubRepositoryId) {
        throw new BadRequestException('Incomplete status webhook');
      }
    } else if (eventName === 'installation') {
      if (!githubInstallationId || !action) {
        throw new BadRequestException('Incomplete installation webhook');
      }
    } else {
      if (!githubInstallationId || !action) {
        throw new BadRequestException('Incomplete installation_repositories webhook');
      }
      const removed = payload.repositories_removed;
      if (!Array.isArray(removed) || removed.length > 500) {
        throw new BadRequestException('Invalid removed repository list');
      }
      removedRepositoryIds = removed.map((item) => this.decimalId(this.object(item).id));
      const added = payload.repositories_added;
      if (!Array.isArray(added) || added.length > 500) {
        throw new BadRequestException('Invalid added repository list');
      }
      hasRepositoryAdditions = added.length > 0;
    }

    return {
      githubInstallationId,
      githubRepositoryId,
      pullNumber,
      headSha,
      action,
      removedRepositoryIds: [...new Set(removedRepositoryIds)],
      hasRepositoryAdditions,
    };
  }

  private verifySignature(rawBody: Buffer, signature: string | undefined): void {
    if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
    const secret = this.config.getOrThrow<string>('GITHUB_APP_WEBHOOK_SECRET');
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const supplied = Buffer.from(signature.slice(7), 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
  }

  private object(value: unknown): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Invalid GitHub webhook payload');
    }
    return value as JsonObject;
  }

  private decimalId(value: unknown): string {
    const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof id !== 'string' || !DECIMAL_ID.test(id)) {
      throw new BadRequestException('Invalid GitHub identifier');
    }
    return id;
  }

  private positiveInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new BadRequestException('Invalid GitHub pull number');
    }
    return value;
  }

  private sha(value: unknown): string {
    if (typeof value !== 'string' || !SHA.test(value)) {
      throw new BadRequestException('Invalid GitHub head SHA');
    }
    return value.toLowerCase();
  }
}
