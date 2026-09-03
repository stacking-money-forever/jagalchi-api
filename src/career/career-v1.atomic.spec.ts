import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ProjectFeature } from '../project-runs/product-spine.entities';
import { WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { CareerV1WorkflowHandlers } from './career-v1.handlers';

const operation = () => ({
  id: '10000000-0000-4000-8000-000000000001', ownerId: '20000000-0000-4000-8000-000000000001',
  kind: 'JOB_TARGET_IMPORT', version: 2, state: WorkflowOperationState.Running,
  leaseOwner: 'worker-1', leaseExpiresAt: new Date(Date.now() + 60_000),
});
const result = { resource: { resourceType: 'CAREER_TARGET_VERSION', resourceId: '30000000-0000-4000-8000-000000000001', resourceHref: '/api/career/target-versions/30000000-0000-4000-8000-000000000001' } };

function subject(options: { state?: WorkflowOperationState; version?: number; expired?: boolean; entitled?: boolean; enabled?: boolean; fault?: 'AFTER_DOMAIN' | 'AFTER_RESULT' } = {}) {
  const claimed = operation();
  const stored = { ...claimed, state: options.state ?? claimed.state, version: options.version ?? claimed.version, leaseExpiresAt: options.expired ? new Date(Date.now() - 1) : claimed.leaseExpiresAt };
  const committed = { domain: [] as string[], results: [] as unknown[], operation: { ...stored } };
  const transaction = vi.fn(async (callback: (manager: EntityManager) => Promise<unknown>) => {
    const tx = { domain: [...committed.domain], results: [...committed.results], operation: { ...committed.operation } };
    const manager = {
      domain: tx.domain,
      getRepository: (entity: { name: string }) => {
        if (entity.name === 'WorkflowOperation') return { findOne: vi.fn().mockResolvedValue(tx.operation), save: vi.fn(async (value) => { tx.operation = { ...value }; return value; }) };
        if (entity.name === 'ProjectFeatureEntitlement') return { findOne: vi.fn().mockResolvedValue(options.entitled === false ? null : { feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: null }) };
        if (entity.name === 'WorkflowOperationResult') return { create: (value: unknown) => value, save: vi.fn(async (value) => { tx.results.push(value); return value; }) };
        throw new Error(`unexpected repository ${entity.name}`);
      },
    };
    const value = await callback(manager as unknown as EntityManager);
    committed.domain = tx.domain; committed.results = tx.results; committed.operation = tx.operation;
    return value;
  });
  const instance = Object.create(CareerV1WorkflowHandlers.prototype) as CareerV1WorkflowHandlers;
  Object.assign(instance, {
    dataSource: { transaction }, config: { get: () => options.enabled === false ? 'false' : 'true' },
    injectFault: options.fault ? (point: string) => { if (point === options.fault) throw new Error(`fault:${point}`); } : undefined,
  });
  // This writes only into transaction-local state, just as repository saves do.
  const domain = vi.fn(async (manager: { domain: string[] }) => { manager.domain.push('resource'); return result; });
  return { instance, claimed, committed, transaction, domain };
}

describe('Career V1 atomic workflow completion', () => {
  it('routes every Phase 1 Career handler through the atomic completion boundary', async () => {
    const source = await readFile(new URL('./career-v1.handlers.ts', import.meta.url), 'utf8');
    expect(source.match(/return this\.complete\(operation/g)).toHaveLength(4);
  });

  it.each([
    { state: WorkflowOperationState.CancelRequested, label: 'cancel' },
    { expired: true, label: 'expired lease' },
    { version: 3, label: 'version drift' },
    { entitled: false, label: 'entitlement loss' },
    { enabled: false, label: 'flag rollback' },
  ])('rejects $label before creating a domain resource', async (options) => {
    const fixture = subject(options);
    await expect(fixture.instance['complete'](fixture.claimed as never, new AbortController().signal, fixture.domain)).rejects.toBeTruthy();
    expect(fixture.domain).not.toHaveBeenCalled();
    expect(fixture.committed.results).toHaveLength(0);
  });

  it('rejects an aborted worker before domain persistence', async () => {
    const fixture = subject(); const abort = new AbortController(); abort.abort();
    await expect(fixture.instance['complete'](fixture.claimed as never, abort.signal, fixture.domain)).rejects.toMatchObject({ code: 'SNAPSHOT_STALE' });
    expect(fixture.domain).not.toHaveBeenCalled();
  });

  it.each(['AFTER_DOMAIN', 'AFTER_RESULT'] as const)('rolls back the whole unit on injected %s failure', async (point) => {
    const fixture = subject({ fault: point });
    await expect(fixture.instance['complete'](fixture.claimed as never, new AbortController().signal, fixture.domain)).rejects.toThrow(`fault:${point}`);
    expect(fixture.domain).toHaveBeenCalledOnce();
    expect(fixture.committed.domain).toHaveLength(0);
    expect(fixture.committed.results).toHaveLength(0);
    expect(fixture.committed.operation.state).toBe(WorkflowOperationState.Running);
  });

  it('commits result metadata and SUCCEEDED together after domain work', async () => {
    const fixture = subject();
    await expect(fixture.instance['complete'](fixture.claimed as never, new AbortController().signal, fixture.domain)).resolves.toEqual(result);
    expect(fixture.committed.domain).toEqual(['resource']);
    expect(fixture.committed.results).toHaveLength(1);
    expect(fixture.committed.operation).toMatchObject({ state: WorkflowOperationState.Succeeded, resultType: 'CAREER_TARGET_VERSION', resultId: result.resource.resourceId, leaseOwner: null });
  });

  it('matches PostgreSQL transaction rollback semantics in PGlite', async () => {
    const database = new PGlite();
    await database.exec(`CREATE TABLE op (id int primary key, state text not null); CREATE TABLE domain_resource (id int primary key); CREATE TABLE op_result (operation_id int unique); INSERT INTO op VALUES (1, 'RUNNING');`);
    await database.exec('BEGIN');
    await database.exec(`SELECT * FROM op WHERE id = 1 FOR UPDATE; INSERT INTO domain_resource VALUES (1); INSERT INTO op_result VALUES (1);`);
    await database.exec('ROLLBACK');
    expect((await database.query<{ count: number }>('SELECT count(*)::int AS count FROM domain_resource')).rows[0]?.count).toBe(0);
    expect((await database.query<{ count: number }>('SELECT count(*)::int AS count FROM op_result')).rows[0]?.count).toBe(0);
    expect((await database.query<{ state: string }>('SELECT state FROM op WHERE id = 1')).rows[0]?.state).toBe('RUNNING');
    await database.close();
  });
});
