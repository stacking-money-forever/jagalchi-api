import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { LEGACY_AI_JOB_CONTRACTS } from './legacy-ai-job-contract';

const temporaryDirectories: string[] = [];

function manifest() {
  return {
    schemaVersion: 1,
    visibility: 'legacy-server-to-server-through-nest-only',
    jobs: Object.entries(LEGACY_AI_JOB_CONTRACTS).map(([feature, contract]) => ({
      feature,
      view: 'CompatibilityView',
      ...contract,
    })),
  };
}

function run(value: ReturnType<typeof manifest>) {
  const directory = mkdtempSync(resolve(tmpdir(), 'jagalchi-legacy-ai-'));
  temporaryDirectories.push(directory);
  const path = resolve(directory, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return spawnSync(
    process.execPath,
    ['tools/check-legacy-ai-consumer-contract.mjs', path],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('legacy AI producer/consumer checker', () => {
  it('accepts the exact seven-job Django compatibility manifest', () => {
    const result = run(manifest());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('all seven Django consumer contracts');
  });

  it.each([
    ['method', (value: ReturnType<typeof manifest>) => { value.jobs[0]!.method = 'POST' as 'GET'; }],
    ['path', (value: ReturnType<typeof manifest>) => { value.jobs[0]!.path = '/ai/moved'; }],
    ['request', (value: ReturnType<typeof manifest>) => { delete value.jobs[0]!.request.properties.question; }],
    ['response', (value: ReturnType<typeof manifest>) => { delete value.jobs[0]!.response.properties.answer; }],
    ['inventory', (value: ReturnType<typeof manifest>) => { value.jobs.pop(); }],
  ])('rejects %s drift', (_name, mutate) => {
    const value = structuredClone(manifest());
    mutate(value);
    expect(run(value).status).not.toBe(0);
  });
});
