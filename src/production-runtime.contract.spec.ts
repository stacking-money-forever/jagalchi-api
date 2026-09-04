import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

const PRODUCTION_COMPOSE_COMMANDS = {
  api: ['node', 'dist/main.js'],
  migrate: ['node', 'dist/database/run-migrations.js'],
  worker: ['node', 'dist/worker.js'],
  workerHealth: ['node', 'dist/workflow/health-check.js'],
} as const;

const PRODUCTION_COMPOSE_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'DATABASE_SSL',
  'DATABASE_SSL_CA',
  'DATABASE_SYNCHRONIZE',
  'DATABASE_POOL_MAX',
  'DATABASE_CONNECTION_TIMEOUT_MS',
  'DATABASE_QUERY_TIMEOUT_MS',
  'DATABASE_STATEMENT_TIMEOUT_MS',
  'TRUST_PROXY_HOPS',
  'JWT_ACCESS_SECRET',
  'AI_AUTH_JWT_SECRET',
  'VERIFICATION_CODE_SECRET',
  'RATE_LIMIT_HASH_SECRET',
  'AI_FEATURES_ENABLED',
  'AI_PROVIDER',
  'UPLOADS_ENABLED',
  'EVIDENCE_EXECUTION_ENABLED',
  'GITHUB_PROVIDER',
  'JOB_SOURCE_PROVIDER',
  'PROJECT_RUNS_ENABLED',
  'PUBLIC_PROOF_PROFILE_ENABLED',
  'OAUTH_ENABLED',
  'OAUTH_GOOGLE_CLIENT_ID',
  'OAUTH_GOOGLE_CLIENT_SECRET',
  'OAUTH_GITHUB_CLIENT_ID',
  'OAUTH_GITHUB_CLIENT_SECRET',
  'OAUTH_APPLE_ENABLED',
  'IAP_ENABLED',
  'EMAIL_ENABLED',
  'AI_SERVICE_URL',
  'AI_TIMEOUT_MS',
  'WORKFLOW_LEASE_MS',
  'WORKFLOW_HEARTBEAT_MS',
  'WORKFLOW_POLL_MS',
  'CORS_ORIGINS',
  'PUBLIC_API_URL',
  'WEB_APP_URL',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_SETUP_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_PRESIGN_ENDPOINT',
  'OBJECT_STORAGE_FORCE_PATH_STYLE',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'OBJECT_STORAGE_PUBLIC_BASE_URL',
] as const;

const PHASE2_ONLY_MIGRATIONS = [
  '1770000009000-create-workflow-operations.ts',
  '1770000010000-complete-workflow-durability.ts',
  '1770000011000-create-product-spine.ts',
  '1770000012000-create-career-target-versions.ts',
  '1770000013000-create-invalidation-watermarks.ts',
  '1770000014000-seed-project-blueprint-catalog.ts',
] as const;

const OPENAPI_PHASE2_PATHS = [
  '/api/project-runs',
  '/api/project-runs/{id}',
  '/api/career/target-imports',
  '/api/v1/operations/project-proposals',
  '/api/workflow-operations/{id}',
] as const;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as T;
}

function envExampleKeys(): Set<string> {
  const keys = new Set<string>();
  for (const line of readFileSync(resolve(root, '.env.example'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const key = trimmed.split('=')[0]?.trim();
    if (key) keys.add(key);
  }
  return keys;
}

describe('production runtime interface', () => {
  it('keeps Dockerfile aligned with jagalchi-infra compose (no inline migrations)', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('CMD ["node", "dist/main.js"]');
    expect(dockerfile).not.toMatch(/run-migrations\.js.*main\.js/);
    expect(dockerfile).toContain("fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health')");
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('EXPOSE 8080');
  });

  it('maps package scripts to compose service commands', () => {
    const scripts = readJson<{ scripts: Record<string, string> }>('package.json').scripts;
    expect(scripts.start?.split(/\s+/)).toEqual([...PRODUCTION_COMPOSE_COMMANDS.api]);
    expect(scripts['start:migrate']?.split(/\s+/)).toEqual([...PRODUCTION_COMPOSE_COMMANDS.migrate]);
    expect(scripts['worker:workflow']?.split(/\s+/)).toEqual([...PRODUCTION_COMPOSE_COMMANDS.worker]);
    expect(scripts['workflow:health']?.split(/\s+/)).toEqual([...PRODUCTION_COMPOSE_COMMANDS.workerHealth]);
  });

  it('ships source entrypoints compiled into the production image', () => {
    for (const entrypoint of [
      'src/main.ts',
      'src/worker.ts',
      'src/database/run-migrations.ts',
      'src/workflow/health-check.ts',
    ]) {
      expect(existsSync(resolve(root, entrypoint)), entrypoint).toBe(true);
    }
  });

  it('documents every jagalchi-infra production compose env key in .env.example', () => {
    const documented = envExampleKeys();
    for (const key of PRODUCTION_COMPOSE_ENV_KEYS) {
      expect(documented.has(key), key).toBe(true);
    }
  });

  it('includes Phase 2 workflow and product-spine migrations absent from platform/services/api', () => {
    const migrations = readdirSync(resolve(root, 'src/database/migrations'));
    for (const migration of PHASE2_ONLY_MIGRATIONS) {
      expect(migrations, migration).toContain(migration);
    }
    expect(migrations.filter((name) => name.endsWith('.ts')).length).toBeGreaterThanOrEqual(16);
  });

  it('publishes OpenAPI paths consumed by @jagalchi/api-client Phase 2 surfaces', () => {
    const document = readJson<{ paths: Record<string, unknown> }>('contracts/openapi.json');
    expect(Object.keys(document.paths).length).toBeGreaterThanOrEqual(100);
    for (const path of OPENAPI_PHASE2_PATHS) {
      expect(document.paths, path).toHaveProperty(path);
    }
  });
});
