import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { UserStatus } from '../auth/auth.entities';
import { ProofProfileState } from '../career/career.entities';
import { GithubInstallationStatus } from '../github/github.entities';
import { WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { DevSeedService, validateDevSeedEnvironment } from './dev-seed.service';

function seedUserId(email: string): string {
  const bytes = Buffer.from(createHash('sha256').update(`user:${email}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function repository<T extends Record<string, unknown>>(initial?: T) {
  let value = initial;
  return {
    findOne: vi.fn(async () => value ?? null),
    create: vi.fn((input: T) => input),
    save: vi.fn(async (input: T) => {
      value = input;
      return input;
    }),
    value: () => value,
    set: (input: T) => { value = input; },
  };
}

function setup(options: { production?: boolean; malformed?: 'email' | 'password'; partial?: boolean; localReal?: boolean; realSource?: boolean } = {}) {
  const email = options.malformed === 'email' ? 'not-an-email' : 'local@example.test';
  const password = options.malformed === 'password' ? 'short' : 'local-password-123';
  const existingUser = options.partial ? {
    id: seedUserId(email), email, name: 'Old', passwordHash: null,
    roles: [], status: UserStatus.Suspended,
  } : undefined;
  const users = repository(existingUser);
  const entitlements = repository(options.partial ? { ownerId: existingUser!.id, enabled: false, reason: 'old' } : undefined);
  const featureEntitlements = repository(options.partial ? { userId: existingUser!.id, feature: 'PROJECT_RUNS', enabled: false, expiresAt: new Date(), reason: 'old', updatedBy: 'old' } : undefined);
  const installations = repository(options.partial ? {
    id: 'ignored-by-test', ownerUserId: existingUser!.id, githubInstallationId: '1', githubAccountId: '2',
    accountType: 'USER', status: GithubInstallationStatus.Revoked, suspendedAt: new Date(), revokedAt: new Date(),
  } : undefined);
  const installationRepositories = repository(options.partial ? {
    installationId: 'ignored-by-test', githubRepositoryId: '3', fullName: 'old/repo', private: false,
    active: false, removedAt: new Date(),
  } : undefined);
  const existingTarget = options.partial ? {
    id: '00000000-0000-4000-8000-000000000010',
    requirements: 'Build and verify a production-shaped TypeScript feature with deterministic tests.',
    competencySlugs: ['typescript'],
  } : undefined;
  const targets = repository(existingTarget);
  const existingRoadmap = options.partial ? {
    id: '00000000-0000-4000-8000-000000000020', ownerId: existingUser!.id,
    title: 'Jagalchi Local Execution Roadmap',
    tags: ['local-seed'],
  } : undefined;
  const roadmapRepository = repository(existingRoadmap);
  const config = { get: vi.fn((key: string) => ({
    NODE_ENV: options.production ? 'production' : 'development',
    LOCAL_SEED_EMAIL: email,
    LOCAL_SEED_PASSWORD: password,
    GITHUB_PROVIDER: options.localReal ? 'github' : 'fixture',
    JAGALCHI_LOCAL_MODE: options.localReal ? 'local-real' : options.realSource ? 'local-real-source' : 'local',
    PROJECT_RUNS_ENABLED: 'true',
  })[key as 'NODE_ENV']) };
  const planning = { exists: vi.fn().mockResolvedValue(false), create: vi.fn((value) => value), save: vi.fn(async (value) => value), findOneByOrFail: vi.fn().mockResolvedValue({ id: 'b1000000-0000-4000-8000-000000000001' }) };
  const dataSource = {
    transaction: vi.fn(async (callback) => callback({
      getRepository: (entity: { name: string }) => entity.name === 'GithubInstallation'
        ? installations : entity.name === 'GithubInstallationRepository' ? installationRepositories : planning,
    })),
  };
  const tickets = { openAccount: vi.fn().mockResolvedValue({ balance: 30 }) };
  let profile = options.partial ? { state: ProofProfileState.Disabled, displayName: 'Old' } : null;
  const career = {
    getProofProfile: vi.fn(async () => profile),
    updateProofProfile: vi.fn(async (_ownerId, input) => {
      profile = { state: input.state, displayName: input.displayName };
      return profile;
    }),
    createTarget: vi.fn(async () => {
      const target = {
        id: '00000000-0000-4000-8000-000000000010',
        requirements: 'Build and verify a production-shaped TypeScript feature with deterministic tests.',
        competencySlugs: ['typescript'],
      };
      targets.set(target);
      return target;
    }),
  };
  let roadmap = existingRoadmap;
  const roadmaps = {
    create: vi.fn(async (ownerId) => {
      roadmap = {
        id: '00000000-0000-4000-8000-000000000020', ownerId,
        title: 'Jagalchi Local Execution Roadmap', tags: ['local-seed'],
      };
      roadmapRepository.set(roadmap);
      return roadmap;
    }),
    update: vi.fn(async () => roadmap),
  };
  let operation = {
    id: '00000000-0000-4000-8000-000000000030',
    state: options.partial ? WorkflowOperationState.Succeeded : WorkflowOperationState.Pending,
  };
  const operations = {
    createOrReplay: vi.fn(async () => ({ operation, replayed: operation.state !== WorkflowOperationState.Pending })),
    claim: vi.fn(async () => ({ ...operation, state: WorkflowOperationState.Running })),
    succeed: vi.fn(async () => {
      operation = { ...operation, state: WorkflowOperationState.Succeeded };
      return true;
    }),
  };
  const execution = {
    createProjectRun: vi.fn().mockResolvedValue({
      projectRun: { id: '00000000-0000-4000-8000-000000000040', created: true }, proofMissionIds: [],
    }),
  };
  const service = new DevSeedService(
    config as never, dataSource as never, users as never, entitlements as never, targets as never,
    roadmapRepository as never, tickets as never, career as never, roadmaps as never,
    operations as never, execution as never, featureEntitlements as never,
  );
  return {
    service, config, users, entitlements, featureEntitlements, installations, installationRepositories,
    tickets, career, roadmaps, operations, execution,
  };
}

describe('DevSeedService', () => {
  it('requires both seed credentials before any application context is needed', () => {
    const base = {
      NODE_ENV: 'development', JAGALCHI_LOCAL_MODE: 'local', GITHUB_PROVIDER: 'fixture',
      LOCAL_SEED_EMAIL: 'local@example.test', LOCAL_SEED_PASSWORD: 'local-password-123',
      PROJECT_RUNS_ENABLED: 'true',
    };
    for (const key of ['LOCAL_SEED_EMAIL', 'LOCAL_SEED_PASSWORD'] as const) {
      const environment: Record<string, string | undefined> = { ...base, [key]: undefined };
      expect(() => validateDevSeedEnvironment((name) => environment[name])).toThrow(`${key} is required`);
    }
  });

  it('is idempotent and uses guarded domain services for the starting dataset', async () => {
    const subject = setup();
    const first = await subject.service.seed();
    const second = await subject.service.seed();

    expect(second).toEqual(first);
    expect(first).toEqual({
      schemaVersion: 1,
      userId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      projectRunId: '00000000-0000-4000-8000-000000000040',
      roadmapId: '00000000-0000-4000-8000-000000000020',
    });
    expect(subject.roadmaps.create).toHaveBeenCalledOnce();
    expect(subject.career.createTarget).toHaveBeenCalledOnce();
    expect(subject.career.updateProofProfile).toHaveBeenCalledOnce();
    expect(subject.operations.createOrReplay).toHaveBeenCalledTimes(2);
    expect(subject.operations.claim).toHaveBeenCalledOnce();
    expect(subject.operations.succeed).toHaveBeenCalledOnce();
    expect(subject.execution.createProjectRun).toHaveBeenCalledTimes(2);
    expect(subject.execution.createProjectRun).toHaveBeenCalledWith(expect.objectContaining({
      roadmapId: '00000000-0000-4000-8000-000000000020',
      repository: expect.objectContaining({ mode: 'EXISTING_OWNED', repositoryName: 'fixture/verification-repository' }),
    }));
  });

  it('rejects production before reading or mutating seed resources', async () => {
    const subject = setup({ production: true });
    await expect(subject.service.seed()).rejects.toThrow('not allowed in production');
    expect(subject.users.findOne).not.toHaveBeenCalled();
    expect(subject.execution.createProjectRun).not.toHaveBeenCalled();
  });

  it.each(['email', 'password'] as const)('rejects malformed %s input before mutation', async (malformed) => {
    const subject = setup({ malformed });
    await expect(subject.service.seed()).rejects.toThrow(/LOCAL_SEED_/);
    expect(subject.users.findOne).not.toHaveBeenCalled();
  });

  it('repairs partial preexisting data and still passes Project Run creation through orchestration', async () => {
    const subject = setup({ partial: true });
    await expect(subject.service.seed()).resolves.toMatchObject({ schemaVersion: 1 });
    expect(subject.users.value()).toMatchObject({ name: 'Jagalchi Local User', roles: ['USER'], status: UserStatus.Active });
    expect(subject.entitlements.value()).toMatchObject({ enabled: true, reason: 'dev-seed' });
    expect(subject.featureEntitlements.value()).toMatchObject({ feature: 'PROJECT_RUNS', enabled: true, expiresAt: null });
    expect(subject.installations.value()).toMatchObject({ status: GithubInstallationStatus.Active, revokedAt: null });
    expect(subject.installationRepositories.value()).toMatchObject({ private: true, active: true, removedAt: null });
    expect(subject.career.updateProofProfile).toHaveBeenCalledOnce();
    expect(subject.roadmaps.update).toHaveBeenCalledOnce();
    expect(subject.execution.createProjectRun).toHaveBeenCalledOnce();
    expect(subject.operations.claim).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a non-seed user that happens to use the configured email', async () => {
    const subject = setup({ partial: true });
    subject.users.set({ ...subject.users.value()!, id: '00000000-0000-4000-8000-000000000099' });
    await expect(subject.service.seed()).rejects.toThrow('non-seed user');
    expect(subject.tickets.openAccount).not.toHaveBeenCalled();
  });

  it('uses manual-greenfield starting data in local-real mode without injecting fixture repository facts', async () => {
    const subject = setup({ localReal: true });
    await expect(subject.service.seed()).resolves.toMatchObject({ schemaVersion: 1 });
    expect(subject.config.get).toHaveBeenCalledWith('JAGALCHI_LOCAL_MODE');
    expect(subject.installations.findOne).not.toHaveBeenCalled();
    expect(subject.installationRepositories.findOne).not.toHaveBeenCalled();
    expect(subject.execution.createProjectRun).toHaveBeenCalledOnce();
    expect(subject.execution.createProjectRun).toHaveBeenCalledWith(expect.objectContaining({
      repository: { mode: 'MANUAL_GREENFIELD' },
    }));
  });

  it('keeps deterministic fixture GitHub facts in local-real-source mode', async () => {
    const subject = setup({ realSource: true });
    await subject.service.seed();
    expect(subject.installations.save).toHaveBeenCalled();
    expect(subject.execution.createProjectRun).toHaveBeenCalledWith(expect.objectContaining({ repository: expect.objectContaining({ mode: 'EXISTING_OWNED' }) }));
  });
});
