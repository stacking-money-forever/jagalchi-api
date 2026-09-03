import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FixtureVerificationProvider } from '../verification-providers';
import { VERIFICATION_PROVIDER } from './task-verification.handler';
import { ProofSnapshot, RepositoryInvalidationWatermark } from './product-spine.entities';

@Injectable()
export class VerificationInvalidationService {
  constructor(private readonly dataSource: DataSource, @Inject(VERIFICATION_PROVIDER) private readonly provider: FixtureVerificationProvider) {}
  async advanceFixtureAndInvalidate(): Promise<number> {
    this.provider.advanceDrift(); let affected = 0;
    for (const event of this.provider.takeInvalidationEvents()) {
      affected += await this.dataSource.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${event.provider}:${event.repositoryId}`]);
        const inserted = await manager.query(`INSERT INTO provider_invalidation_events (provider, provider_event_id, repository_id, pull_number, head_sha, kind, observed_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING provider_event_id`, [event.provider, event.providerEventId, event.repositoryId, event.pullNumber, event.headSha, event.kind, event.observedAt, JSON.stringify(event)]);
        if (!Array.isArray(inserted) || inserted.length === 0) {
          const replay = await manager.query(`SELECT repository_id = $3 AND pull_number IS NOT DISTINCT FROM $4 AND head_sha IS NOT DISTINCT FROM $5 AND kind = $6 AND observed_at = $7::timestamptz AND payload = $8::jsonb AS matches FROM provider_invalidation_events WHERE provider = $1 AND provider_event_id = $2`, [event.provider, event.providerEventId, event.repositoryId, event.pullNumber, event.headSha, event.kind, event.observedAt, JSON.stringify(event)]);
          if (replay[0]?.matches !== true) throw new ConflictException({ code: 'PROVIDER_EVENT_REPLAY_MISMATCH', message: 'Provider event replay does not match the immutable event' });
          return 0;
        }
        const watermarks = await manager.query(`INSERT INTO repository_invalidation_watermarks (provider, repository_id, generation, last_event_id, observed_at) VALUES ($1,$2,1,$3,$4) ON CONFLICT (provider, repository_id) DO UPDATE SET generation = repository_invalidation_watermarks.generation + 1, last_event_id = EXCLUDED.last_event_id, observed_at = GREATEST(repository_invalidation_watermarks.observed_at, EXCLUDED.observed_at), updated_at = now() RETURNING generation`, [event.provider, event.repositoryId, event.providerEventId, event.observedAt]);
        const generation = Number(watermarks[0]?.generation);
        const invalidated = await manager.query(`UPDATE proof_publications publication SET validity = 'INVALIDATED', updated_at = now() FROM proof_snapshots snapshot WHERE publication.proof_snapshot_id = snapshot.id AND publication.validity = 'ACTIVE' AND snapshot.payload ->> 'repositoryId' = $1 AND snapshot.invalidation_generation < $2 AND snapshot.payload ->> 'provider' = $3 RETURNING publication.id`, [event.repositoryId, generation, event.provider]);
        return Array.isArray(invalidated) ? invalidated.length : 0;
      });
    }
    return affected;
  }

  async assertSnapshotPublishable(manager: EntityManager, snapshotId: string): Promise<ProofSnapshot> {
    const snapshot = await manager.getRepository(ProofSnapshot).findOne({ where: { id: snapshotId }, lock: { mode: 'pessimistic_read' } });
    if (!snapshot) throw new ConflictException({ code: 'PROOF_SNAPSHOT_NOT_FOUND', message: 'Proof snapshot is unavailable' });
    const repositoryId = String(snapshot.payload.repositoryId ?? ''); const provider = String(snapshot.payload.provider ?? '');
    if (!repositoryId || !provider) throw new ConflictException({ code: 'PROOF_SNAPSHOT_INVALID', message: 'Proof snapshot has no repository fence' });
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${provider}:${repositoryId}`]);
    const watermark = await manager.getRepository(RepositoryInvalidationWatermark).findOne({ where: { provider, repositoryId }, lock: { mode: 'pessimistic_read' } });
    if ((watermark?.generation ?? 0) !== snapshot.invalidationGeneration) throw new ConflictException({ code: 'VERIFICATION_STALE', message: 'Proof snapshot was observed before the latest provider invalidation' });
    return snapshot;
  }
}
