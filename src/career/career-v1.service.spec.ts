import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CareerV1Service } from './career-v1.service';
import { CandidateProfileSnapshot, CareerDiffSnapshot, ProjectRunCommand, SnapshotState } from '../project-runs/product-spine.entities';

function setup(provider = 'fixture') {
  const config = { get: vi.fn((key: string) => ({ PROJECT_RUNS_ENABLED: 'true', JOB_SOURCE_PROVIDER: provider }[key])) };
  const operations = { createOrReplay: vi.fn().mockResolvedValue({ operation: { id: 'operation-1' }, replayed: false }), get: vi.fn().mockResolvedValue({ id: 'operation-1', state: 'PENDING' }) };
  const entitlements = { exists: vi.fn().mockResolvedValue(true) };
  const targetVersions = { findOne: vi.fn() };
  const empty = { findOne: vi.fn(), find: vi.fn(), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
  const service = new CareerV1Service(config as never, operations as never, entitlements as never, targetVersions as never, empty as never, empty as never, empty as never, empty as never, empty as never);
  return { service, operations, targetVersions };
}

describe('CareerV1Service intake boundary', () => {
  it('rejects unsupported fetched URLs before creating an operation', async () => {
    const subject = setup();
    await expect(subject.service.targetImport('owner-1', 'key', { input: { kind: 'FETCHED_URL', url: 'https://evil.example/jobs/1' } }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(subject.operations.createOrReplay).not.toHaveBeenCalled();
  });

  it('accepts an explicit degraded manual capture without source auto-success', async () => {
    const subject = setup();
    await subject.service.targetImport('owner-1', 'key', { input: { kind: 'MANUAL_CAPTURE', originalUrl: 'https://blocked.example/jobs/1', sourceText: 'A manually captured backend role requiring TypeScript and reliable tests.' } });
    expect(subject.operations.createOrReplay).toHaveBeenCalledWith(expect.objectContaining({ kind: 'JOB_TARGET_IMPORT', input: expect.objectContaining({ kind: 'MANUAL_CAPTURE' }) }));
  });

  it('hides target versions not owned by the caller', async () => {
    const subject = setup(); subject.targetVersions.findOne.mockResolvedValue(null);
    await expect(subject.service.getTargetVersion('owner-2', 'version-1')).rejects.toThrow('not available');
    expect(subject.targetVersions.findOne).toHaveBeenCalledWith({ where: { id: 'version-1', ownerId: 'owner-2' } });
  });

  it('rejects unknown correction fields before snapshot persistence', async () => {
    const subject = setup();
    await expect(subject.service.confirmProfile('owner-1', 'snapshot-1', 'key', { admin: true })).rejects.toThrow('not allowed');
  });

  it('serializes concurrent profile confirmation and atomically replays one resource receipt', async () => {
    const source = { id: 'snapshot-1', ownerId: 'owner-1', state: SnapshotState.Draft, payload: { repositories: [] } };
    let confirmed: Record<string, unknown> | null = null; let receipt: Record<string, unknown> | null = null;
    const profiles = { findOne: vi.fn(async ({ where }) => where.id ? source : confirmed), create: vi.fn((value) => value), save: vi.fn(async (value) => { confirmed = value; return value; }) };
    const commands = { findOne: vi.fn(async () => receipt), create: vi.fn((value) => value), save: vi.fn(async (value) => { receipt = value; return value; }) };
    const manager = { getRepository: (entity: { name: string }) => entity === CandidateProfileSnapshot ? profiles : entity === ProjectRunCommand ? commands : null };
    let queue = Promise.resolve<unknown>(undefined);
    const dataSource = { transaction: vi.fn((callback) => { const result = queue.then(() => callback(manager)); queue = result.then(() => undefined, () => undefined); return result; }) };
    const empty = { findOne: vi.fn(), find: vi.fn(), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const service = new CareerV1Service({} as never, {} as never, {} as never, {} as never, profiles as never, empty as never, empty as never, empty as never, commands as never, dataSource as never);
    const input = { acceptedRepositoryIds: ['9000001'] };
    const [first, second] = await Promise.all([service.confirmProfile('owner-1', 'snapshot-1', '00000000-0000-4000-8000-000000000099', input), service.confirmProfile('owner-1', 'snapshot-1', '00000000-0000-4000-8000-000000000099', input)]);
    expect(second).toEqual(first); expect(profiles.save).toHaveBeenCalledOnce(); expect(commands.save).toHaveBeenCalledOnce();
  });

  it('serializes concurrent diff confirmation with its command receipt', async () => {
    const source = { id: 'diff-1', ownerId: 'owner-1', state: SnapshotState.Draft, careerTargetId: 'target-1', careerTargetVersionId: 'version-1', candidateProfileSnapshotId: 'profile-1', payload: { missing: [] } };
    let confirmed: Record<string, unknown> | null = null; let receipt: Record<string, unknown> | null = null;
    const diffs = { findOne: vi.fn(async ({ where }) => where.id ? source : confirmed), create: vi.fn((value) => value), save: vi.fn(async (value) => { confirmed = value; return value; }) };
    const commands = { findOne: vi.fn(async () => receipt), create: vi.fn((value) => value), save: vi.fn(async (value) => { receipt = value; return value; }) };
    const manager = { getRepository: (entity: { name: string }) => entity === CareerDiffSnapshot ? diffs : entity === ProjectRunCommand ? commands : null };
    let queue = Promise.resolve<unknown>(undefined); const dataSource = { transaction: vi.fn((callback) => { const result = queue.then(() => callback(manager)); queue = result.then(() => undefined, () => undefined); return result; }) };
    const empty = { findOne: vi.fn(), find: vi.fn(), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const service = new CareerV1Service({} as never, {} as never, {} as never, {} as never, empty as never, diffs as never, empty as never, empty as never, commands as never, dataSource as never);
    const input = { acceptedCompetencyIds: ['typescript'] }; const key = '00000000-0000-4000-8000-000000000099';
    const [first, second] = await Promise.all([service.confirmDiff('owner-1', 'diff-1', key, input), service.confirmDiff('owner-1', 'diff-1', key, input)]);
    expect(second).toEqual(first); expect(diffs.save).toHaveBeenCalledOnce(); expect(commands.save).toHaveBeenCalledOnce();
  });
});
