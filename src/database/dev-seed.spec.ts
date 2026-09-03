import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seed = vi.hoisted(() => vi.fn().mockResolvedValue({
  schemaVersion: 1,
  userId: '00000000-0000-4000-8000-000000000001',
  projectRunId: '00000000-0000-4000-8000-000000000002',
  roadmapId: '00000000-0000-4000-8000-000000000003',
}));
const close = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: vi.fn().mockResolvedValue({ get: () => ({ seed }), close }) },
}));
vi.mock('../app.module', () => ({ AppModule: class AppModule {} }));

import { runDevSeed } from './dev-seed';
import { NestFactory } from '@nestjs/core';

describe('dev:seed CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_SEED_EMAIL = 'local@example.test';
    process.env.LOCAL_SEED_PASSWORD = 'local-password-123';
    process.env.JAGALCHI_LOCAL_MODE = 'local';
    process.env.GITHUB_PROVIDER = 'fixture';
    process.env.PROJECT_RUNS_ENABLED = 'true';
  });

  afterEach(() => {
    for (const key of ['NODE_ENV', 'LOCAL_SEED_EMAIL', 'LOCAL_SEED_PASSWORD', 'JAGALCHI_LOCAL_MODE', 'GITHUB_PROVIDER', 'PROJECT_RUNS_ENABLED']) {
      delete process.env[key];
    }
    vi.restoreAllMocks();
  });

  it('prints exactly one public JSON line without credentials or private fixture facts', async () => {
    const originalArgv = process.argv;
    process.argv = [...process.argv, '--json'];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runDevSeed();
    } finally {
      process.argv = originalArgv;
    }
    expect(write).toHaveBeenCalledOnce();
    const output = String(write.mock.calls[0]?.[0]);
    expect(output).toBe('{"schemaVersion":1,"userId":"00000000-0000-4000-8000-000000000001","projectRunId":"00000000-0000-4000-8000-000000000002","roadmapId":"00000000-0000-4000-8000-000000000003"}\n');
    expect(output).not.toMatch(/password|token|fixture\/|@example/);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects production before creating a Nest application context', async () => {
    process.env.NODE_ENV = 'production';
    const originalArgv = process.argv;
    process.argv = [...process.argv, '--json'];
    try {
      await expect(runDevSeed()).rejects.toThrow('not allowed in production');
    } finally {
      process.argv = originalArgv;
    }
    expect(NestFactory.createApplicationContext).not.toHaveBeenCalled();
  });
});
