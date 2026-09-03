import { describe, expect, it, vi } from 'vitest';
import { FixtureVerificationProvider } from '../verification-providers';
import { VerificationInvalidationService } from './verification-invalidation.service';

describe('VerificationInvalidationService', () => {
  it('invalidates only publications from fixture events and never updates immutable snapshots', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('RETURNING provider_event_id') ? [{ provider_event_id: 'event' }] : sql.includes('RETURNING generation') ? [{ generation: 1 }] : sql.includes('RETURNING publication.id') ? [{ id: 'publication' }] : []);
    const transaction = vi.fn((callback) => callback({ query }));
    const provider = new FixtureVerificationProvider('drift');
    const service = new VerificationInvalidationService({ transaction } as never, provider);
    await expect(service.advanceFixtureAndInvalidate()).resolves.toBe(2);
    expect(transaction).toHaveBeenCalledTimes(2);
    for (const [sql] of query.mock.calls) {
      expect(String(sql)).not.toMatch(/^UPDATE proof_snapshots/i);
      expect(sql).not.toMatch(/UPDATE proof_snapshots/i);
    }
    expect(query.mock.calls.some(([sql]) => String(sql).includes('ON CONFLICT (provider, provider_event_id) DO NOTHING'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('repository_invalidation_watermarks.generation + 1'))).toBe(true);
  });

  it('rejects future publication when snapshot generation trails the durable watermark', async () => {
    const snapshot = { id: 'snapshot-1', invalidationGeneration: 1, payload: { provider: 'fixture', repositoryId: '9000001' } };
    const manager = { query: vi.fn(), getRepository: vi.fn((entity: { name: string }) => entity.name === 'ProofSnapshot' ? { findOne: vi.fn().mockResolvedValue(snapshot) } : { findOne: vi.fn().mockResolvedValue({ generation: 2 }) }) };
    const service = new VerificationInvalidationService({} as never, new FixtureVerificationProvider('drift'));
    await expect(service.assertSnapshotPublishable(manager as never, 'snapshot-1')).rejects.toMatchObject({ response: { code: 'VERIFICATION_STALE' } });
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['fixture:9000001']);
  });

  it('does not advance generation for an exact durable event replay and rejects a changed replay', async () => {
    const exactQuery = vi.fn(async (sql: string) => sql.includes('RETURNING provider_event_id') ? [] : sql.includes(' AS matches ') ? [{ matches: true }] : []);
    const exactProvider = new FixtureVerificationProvider('drift');
    const exact = new VerificationInvalidationService({ transaction: (callback) => callback({ query: exactQuery }) } as never, exactProvider);
    await expect(exact.advanceFixtureAndInvalidate()).resolves.toBe(0);
    expect(exactQuery.mock.calls.some(([sql]) => String(sql).includes('repository_invalidation_watermarks'))).toBe(false);

    const changedQuery = vi.fn(async (sql: string) => sql.includes('RETURNING provider_event_id') ? [] : sql.includes(' AS matches ') ? [{ matches: false }] : []);
    const changedProvider = new FixtureVerificationProvider('drift');
    const changed = new VerificationInvalidationService({ transaction: (callback) => callback({ query: changedQuery }) } as never, changedProvider);
    await expect(changed.advanceFixtureAndInvalidate()).rejects.toMatchObject({ response: { code: 'PROVIDER_EVENT_REPLAY_MISMATCH' } });
  });
});
