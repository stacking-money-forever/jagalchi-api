import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CreateTicketLedger1770000000000 } from './1770000000000-create-ticket-ledger';
import { CreateRoadmapDomain1770000001000 } from './1770000001000-create-roadmap-domain';
import { CreateSocialDomain1770000002000 } from './1770000002000-create-social-domain';
import { CreateAuthDomain1770000003000 } from './1770000003000-create-auth-domain';
import { CreateRealtimeDomain1770000004000 } from './1770000004000-create-realtime-domain';
import { CreateUploadsDomain1770000005000 } from './1770000005000-create-uploads-domain';
import { CreateTicketPurchases1770000006000 } from './1770000006000-create-ticket-purchases';
import { CreateCareerDomain1770000007000 } from './1770000007000-create-career-domain';
import { CreateEvidenceExecution1770000008000 } from './1770000008000-create-evidence-execution';
import { CreateWorkflowOperations1770000009000 } from './1770000009000-create-workflow-operations';
import { CompleteWorkflowDurability1770000010000 } from './1770000010000-complete-workflow-durability';
import { CreateProductSpine1770000011000 } from './1770000011000-create-product-spine';
import { CreateCareerTargetVersions1770000012000 } from './1770000012000-create-career-target-versions';
import { CreateInvalidationWatermarks1770000013000 } from './1770000013000-create-invalidation-watermarks';
import { SeedProjectBlueprintCatalog1770000014000 } from './1770000014000-seed-project-blueprint-catalog';

const baseMigrations: MigrationInterface[] = [
  new CreateTicketLedger1770000000000(),
  new CreateRoadmapDomain1770000001000(),
  new CreateSocialDomain1770000002000(),
  new CreateAuthDomain1770000003000(),
  new CreateRealtimeDomain1770000004000(),
  new CreateUploadsDomain1770000005000(),
  new CreateTicketPurchases1770000006000(),
  new CreateCareerDomain1770000007000(),
];
const evidenceMigration = new CreateEvidenceExecution1770000008000();
const workflowMigration = new CreateWorkflowOperations1770000009000();
const durabilityMigration = new CompleteWorkflowDurability1770000010000();
const productSpineMigration = new CreateProductSpine1770000011000();
const targetVersionsMigration = new CreateCareerTargetVersions1770000012000();
const invalidationMigration = new CreateInvalidationWatermarks1770000013000();
const blueprintCatalogMigration = new SeedProjectBlueprintCatalog1770000014000();
const migrations = [...baseMigrations, evidenceMigration, workflowMigration, durabilityMigration, productSpineMigration, targetVersionsMigration, invalidationMigration, blueprintCatalogMigration];
const preProductMigrations = [...baseMigrations, evidenceMigration, workflowMigration, durabilityMigration];

const ids = {
  ownerA: '00000000-0000-4000-8000-000000000001',
  ownerB: '00000000-0000-4000-8000-000000000002',
  reviewer: '00000000-0000-4000-8000-000000000003',
  targetA: '10000000-0000-4000-8000-000000000001',
  targetB: '10000000-0000-4000-8000-000000000002',
  installationA: '20000000-0000-4000-8000-000000000001',
  installationB: '20000000-0000-4000-8000-000000000002',
  missionA: '30000000-0000-4000-8000-000000000001',
  missionB: '30000000-0000-4000-8000-000000000002',
  runA: '40000000-0000-4000-8000-000000000001',
  runA2: '40000000-0000-4000-8000-000000000002',
  runB: '40000000-0000-4000-8000-000000000003',
  runA3: '40000000-0000-4000-8000-000000000004',
  reviewA: '50000000-0000-4000-8000-000000000001',
  reviewA2: '50000000-0000-4000-8000-000000000002',
  reviewB: '50000000-0000-4000-8000-000000000003',
  profileA: '60000000-0000-4000-8000-000000000001',
};

async function expectConstraint(
  database: PGlite,
  sql: string,
  constraintName: string,
): Promise<void> {
  await expect(database.exec(sql)).rejects.toThrow(constraintName);
}

async function insertEvidenceFixtures(database: PGlite): Promise<void> {
  await database.exec(`
    INSERT INTO "users" ("id", "email", "name") VALUES
      ('${ids.ownerA}', 'owner-a@example.test', 'Owner A'),
      ('${ids.ownerB}', 'owner-b@example.test', 'Owner B'),
      ('${ids.reviewer}', 'reviewer@example.test', 'Reviewer');
    INSERT INTO "career_targets" ("id", "user_id", "company", "role", "requirements", "competency_slugs") VALUES
      ('${ids.targetA}', '${ids.ownerA}', 'A', 'Engineer', 'Build', ARRAY['typescript']),
      ('${ids.targetB}', '${ids.ownerB}', 'B', 'Engineer', 'Build', ARRAY['typescript']);
    INSERT INTO "github_installations"
      ("id", "owner_user_id", "github_installation_id", "github_account_id", "account_type", "status")
    VALUES
      ('${ids.installationA}', '${ids.ownerA}', 101, 1001, 'USER', 'ACTIVE'),
      ('${ids.installationB}', '${ids.ownerB}', 102, 1002, 'USER', 'ACTIVE');
    INSERT INTO "github_installation_repositories"
      ("installation_id", "github_repository_id", "full_name", "private", "active")
    VALUES
      ('${ids.installationA}', 10001, 'owner-a/repo', true, true),
      ('${ids.installationB}', 10002, 'owner-b/repo', true, true);
    INSERT INTO "proof_missions"
      ("id", "owner_user_id", "target_id", "competency_slug", "title", "state",
       "installation_id", "github_repository_id", "pull_number", "repository_name",
       "repository_private", "pull_title", "pull_url", "binding_version")
    VALUES
      ('${ids.missionA}', '${ids.ownerA}', '${ids.targetA}', 'typescript', 'Mission A', 'BOUND',
       '${ids.installationA}', 10001, 1, 'owner-a/repo', true, 'PR A', 'https://github.test/a/pull/1', 1),
      ('${ids.missionB}', '${ids.ownerB}', '${ids.targetB}', 'typescript', 'Mission B', 'BOUND',
       '${ids.installationB}', 10002, 2, 'owner-b/repo', true, 'PR B', 'https://github.test/b/pull/2', 1);
    INSERT INTO "proof_verification_runs"
      ("id", "mission_id", "binding_version", "criteria_version", "head_sha",
       "criteria_digest", "facts_digest", "status", "results", "observed_at")
    VALUES
      ('${ids.runA}', '${ids.missionA}', 1, 1, '${'a'.repeat(40)}', '${'1'.repeat(64)}', '${'2'.repeat(64)}', 'PASS', '[]', now()),
      ('${ids.runA2}', '${ids.missionA}', 1, 1, '${'b'.repeat(40)}', '${'3'.repeat(64)}', '${'4'.repeat(64)}', 'PASS', '[]', now()),
      ('${ids.runB}', '${ids.missionB}', 1, 1, '${'c'.repeat(40)}', '${'5'.repeat(64)}', '${'6'.repeat(64)}', 'PASS', '[]', now());
    INSERT INTO "proof_reviews" ("id", "mission_id", "verification_run_id", "reviewer_id", "decision") VALUES
      ('${ids.reviewA}', '${ids.missionA}', '${ids.runA}', '${ids.reviewer}', 'APPROVED'),
      ('${ids.reviewA2}', '${ids.missionA}', '${ids.runA2}', '${ids.reviewer}', 'APPROVED'),
      ('${ids.reviewB}', '${ids.missionB}', '${ids.runB}', '${ids.reviewer}', 'APPROVED');
    INSERT INTO "proof_profiles" ("id", "owner_user_id", "public_id", "state", "display_name")
    VALUES ('${ids.profileA}', '${ids.ownerA}', 'abcdefghijklmnopqrstuv', 'ENABLED', 'Owner A');
  `);
}

async function assertRelationalMatrix(database: PGlite): Promise<void> {
  await insertEvidenceFixtures(database);

  await database.exec(`
    INSERT INTO "proof_verification_runs"
      ("id", "mission_id", "binding_version", "criteria_version", "head_sha",
       "criteria_digest", "facts_digest", "status", "results", "observed_at")
    VALUES
      ('${ids.runA3}', '${ids.missionA}', 1, 3, '${'a'.repeat(40)}',
       '${'1'.repeat(64)}', '${'2'.repeat(64)}', 'PASS', '[]', now())
  `);
  await expectConstraint(
    database,
    `INSERT INTO "proof_verification_runs"
      ("mission_id", "binding_version", "criteria_version", "head_sha",
       "criteria_digest", "facts_digest", "status", "results", "observed_at")
     VALUES ('${ids.missionA}', 1, 1, '${'a'.repeat(40)}',
       '${'1'.repeat(64)}', '${'2'.repeat(64)}', 'PASS', '[]', now())`,
    'uq_proof_runs_observation',
  );

  await expectConstraint(
    database,
    `INSERT INTO "proof_missions"
      ("owner_user_id", "target_id", "competency_slug", "title", "state",
       "installation_id", "github_repository_id", "pull_number", "repository_name",
       "repository_private", "pull_title", "pull_url", "binding_version")
     VALUES ('${ids.ownerA}', '${ids.targetA}', 'typescript', 'Cross owner', 'BOUND',
       '${ids.installationB}', 10002, 3, 'owner-b/repo', true, 'PR', 'https://github.test/b/pull/3', 1)`,
    'FK_proof_missions_installation_owner',
  );
  await expectConstraint(
    database,
    `INSERT INTO "proof_missions"
      ("owner_user_id", "target_id", "competency_slug", "title", "state",
       "installation_id", "github_repository_id", "pull_number", "repository_name",
       "repository_private", "pull_title", "pull_url", "binding_version")
     VALUES ('${ids.ownerA}', '${ids.targetA}', 'typescript', 'Missing member', 'BOUND',
       '${ids.installationA}', 99999, 4, 'owner-a/missing', true, 'PR', 'https://github.test/a/pull/4', 1)`,
    'FK_proof_missions_installation_repository',
  );
  await database.exec(`
    INSERT INTO "github_installation_repositories"
      ("installation_id", "github_repository_id", "full_name", "private", "active")
    VALUES ('${ids.installationA}', 10003, 'owner-a/inactive', true, false);
    INSERT INTO "proof_missions"
      ("owner_user_id", "target_id", "competency_slug", "title", "state",
       "installation_id", "github_repository_id", "pull_number", "repository_name",
       "repository_private", "pull_title", "pull_url", "binding_version")
    VALUES ('${ids.ownerA}', '${ids.targetA}', 'typescript', 'Inactive membership control', 'BOUND',
      '${ids.installationA}', 10003, 5, 'owner-a/inactive', true, 'PR', 'https://github.test/a/pull/5', 1);
  `);
  await expectConstraint(
    database,
    `UPDATE "proof_missions" SET "current_verification_run_id" = '${ids.runB}'
     WHERE "id" = '${ids.missionA}'`,
    'FK_proof_missions_current_run',
  );
  await expectConstraint(
    database,
    `UPDATE "proof_missions"
     SET "state" = 'APPROVED', "current_verification_run_id" = '${ids.runA}',
         "current_review_id" = '${ids.reviewA2}'
     WHERE "id" = '${ids.missionA}'`,
    'FK_proof_missions_current_review_run',
  );
  await expectConstraint(
    database,
    `INSERT INTO "published_proofs"
      ("profile_id", "mission_id", "verification_run_id", "review_id", "state", "snapshot", "valid_until")
     VALUES ('${ids.profileA}', '${ids.missionA}', '${ids.runB}', '${ids.reviewB}',
       'ACTIVE', '{}', now() + interval '1 hour')`,
    'FK_published_proofs_run_mission',
  );
  await expectConstraint(
    database,
    `INSERT INTO "published_proofs"
      ("profile_id", "mission_id", "verification_run_id", "review_id", "state", "snapshot", "valid_until")
     VALUES ('${ids.profileA}', '${ids.missionA}', '${ids.runA}', '${ids.reviewA2}',
       'ACTIVE', '{}', now() + interval '1 hour')`,
    'FK_published_proofs_review_mission_run',
  );

  await database.exec(`
    UPDATE "proof_missions"
    SET "state" = 'APPROVED', "current_verification_run_id" = '${ids.runA}',
        "current_review_id" = '${ids.reviewA}'
    WHERE "id" = '${ids.missionA}';
    INSERT INTO "published_proofs"
      ("profile_id", "mission_id", "verification_run_id", "review_id", "state", "snapshot", "valid_until")
    VALUES ('${ids.profileA}', '${ids.missionA}', '${ids.runA}', '${ids.reviewA}',
      'ACTIVE', '{}', now() + interval '1 hour');
  `);

  const constraints = await database.query<{ conname: string; definition: string }>(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname IN (
      'FK_proof_missions_installation_owner',
      'FK_proof_missions_installation_repository',
      'FK_proof_missions_current_run',
      'FK_proof_missions_current_review_run',
      'FK_published_proofs_run_mission',
      'FK_published_proofs_review_mission_run'
    )
    ORDER BY conname
  `);
  expect(constraints.rows).toHaveLength(6);
  expect(constraints.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        conname: 'FK_proof_missions_installation_owner',
        definition: expect.stringContaining(
          'FOREIGN KEY (installation_id, owner_user_id) REFERENCES github_installations(id, owner_user_id) ON DELETE RESTRICT',
        ),
      }),
      expect.objectContaining({
        conname: 'FK_proof_missions_current_review_run',
        definition: expect.stringContaining(
          'FOREIGN KEY (current_review_id, id, current_verification_run_id) REFERENCES proof_reviews(id, mission_id, verification_run_id) ON DELETE RESTRICT',
        ),
      }),
      expect.objectContaining({
        conname: 'FK_published_proofs_review_mission_run',
        definition: expect.stringContaining(
          'FOREIGN KEY (review_id, mission_id, verification_run_id) REFERENCES proof_reviews(id, mission_id, verification_run_id) ON DELETE RESTRICT',
        ),
      }),
    ]),
  );
  const observationConstraint = await database.query<{ definition: string }>(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'uq_proof_runs_observation'
  `);
  expect(observationConstraint.rows).toEqual([
    {
      definition: expect.stringContaining(
        'UNIQUE (mission_id, binding_version, criteria_version, head_sha, criteria_digest, facts_digest)',
      ),
    },
  ]);
}

describe('PostgreSQL migrations', () => {
  it('adds and reverses the product spine over production-shaped legacy rows without changing them', async () => {
    const database = new PGlite();
    const queryRunner = { query: async (sql: string) => database.exec(sql) } as unknown as QueryRunner;
    for (const migration of preProductMigrations) await migration.up(queryRunner);
    await database.exec(`
      INSERT INTO "users" ("id", "email", "name") VALUES ('${ids.ownerA}', 'spine@example.test', 'Spine');
      INSERT INTO "roadmaps" ("id", "owner_id", "title") VALUES ('90000000-0000-4000-8000-000000000001', '${ids.ownerA}', 'Legacy');
      INSERT INTO "workflow_operations" ("id", "owner_id", "route", "idempotency_key", "kind", "input_hash", "input")
      VALUES ('90000000-0000-4000-8000-000000000002', '${ids.ownerA}', '/legacy', 'legacy-key', 'LEGACY', '${'9'.repeat(64)}', '{}');
      INSERT INTO "project_runs" ("id", "source_operation_id", "owner_id", "state", "projection")
      VALUES ('90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000002', '${ids.ownerA}', 'READY', '{}');
      INSERT INTO "project_run_entitlements" ("owner_id", "enabled", "reason") VALUES ('${ids.ownerA}', true, 'legacy');
    `);
    await productSpineMigration.up(queryRunner);
    const entitlement = await database.query<{ enabled: boolean }>(`SELECT "enabled" FROM "project_feature_entitlements" WHERE "user_id" = '${ids.ownerA}'`);
    const run = await database.query<{ roadmap_id: string | null }>(`SELECT "roadmap_id" FROM "project_runs" WHERE "id" = '90000000-0000-4000-8000-000000000003'`);
    expect(entitlement.rows[0]?.enabled).toBe(true);
    expect(run.rows[0]?.roadmap_id).toBeNull();
    await productSpineMigration.down(queryRunner);
    const legacy = await database.query<{ title: string }>(`SELECT "title" FROM "roadmaps" WHERE "id" = '90000000-0000-4000-8000-000000000001'`);
    expect(legacy.rows[0]?.title).toBe('Legacy');
    for (const migration of [...preProductMigrations].reverse()) await migration.down(queryRunner);
    await database.close();
  }, 30_000);

  it('reconstructs an existing refresh rotation chain as one family on upgrade', async () => {
    const database = new PGlite();
    const queryRunner = { query: async (sql: string) => database.exec(sql) } as unknown as QueryRunner;
    for (const migration of [...baseMigrations, evidenceMigration]) await migration.up(queryRunner);
    await database.exec(`
      INSERT INTO "users" ("id", "email", "name") VALUES ('${ids.ownerA}', 'refresh@example.test', 'Refresh');
      INSERT INTO "refresh_sessions" ("id", "user_id", "token_hash", "expires_at", "revoked_at", "replaced_by_id") VALUES
        ('81000000-0000-4000-8000-000000000003', '${ids.ownerA}', '${'3'.repeat(64)}', now() + interval '1 day', null, null),
        ('81000000-0000-4000-8000-000000000002', '${ids.ownerA}', '${'2'.repeat(64)}', now() + interval '1 day', now(), '81000000-0000-4000-8000-000000000003'),
        ('81000000-0000-4000-8000-000000000001', '${ids.ownerA}', '${'1'.repeat(64)}', now() + interval '1 day', now(), '81000000-0000-4000-8000-000000000002');
    `);
    await workflowMigration.up(queryRunner);
    const families = await database.query<{ family_id: string }>(`SELECT "family_id" FROM "refresh_sessions" ORDER BY "id"`);
    expect(new Set(families.rows.map(({ family_id }) => family_id))).toEqual(new Set(['81000000-0000-4000-8000-000000000001']));
    await database.exec(`
      INSERT INTO "refresh_sessions" ("user_id", "token_hash", "expires_at")
      VALUES ('${ids.ownerA}', '${'4'.repeat(64)}', now() + interval '1 day')
    `);
    const legacyWrite = await database.query<{ family_id: string | null }>(`
      SELECT "family_id" FROM "refresh_sessions" WHERE "token_hash" = '${'4'.repeat(64)}'
    `);
    expect(legacyWrite.rows[0]?.family_id).toMatch(/^[0-9a-f-]{36}$/i);
    await workflowMigration.down(queryRunner);
    for (const migration of [...baseMigrations, evidenceMigration].reverse()) await migration.down(queryRunner);
    await database.close();
  }, 30_000);

  it('serializes concurrent family rotation and reuse without leaving a live token', async () => {
    const database = new PGlite();
    const queryRunner = { query: async (sql: string) => database.exec(sql) } as unknown as QueryRunner;
    for (const migration of migrations) await migration.up(queryRunner);
    const family = '82000000-0000-4000-8000-000000000001';
    await database.exec(`
      INSERT INTO "users" ("id", "email", "name") VALUES ('${ids.ownerA}', 'family-race@example.test', 'Race');
      INSERT INTO "refresh_sessions" ("id", "user_id", "family_id", "token_hash", "expires_at", "revoked_at", "replaced_by_id") VALUES
        ('${family}', '${ids.ownerA}', '${family}', '${'1'.repeat(64)}', now() + interval '1 day', now(), '82000000-0000-4000-8000-000000000002'),
        ('82000000-0000-4000-8000-000000000002', '${ids.ownerA}', '${family}', '${'2'.repeat(64)}', now() + interval '1 day', null, null);
    `);
    await Promise.all([
      database.transaction(async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [family]);
        await tx.exec(`
          WITH rotated AS (
            UPDATE "refresh_sessions" SET "revoked_at" = now(), "replaced_by_id" = '82000000-0000-4000-8000-000000000003'
            WHERE "id" = '82000000-0000-4000-8000-000000000002' AND "revoked_at" IS NULL RETURNING 1
          )
          INSERT INTO "refresh_sessions" ("id", "user_id", "family_id", "token_hash", "expires_at")
          SELECT '82000000-0000-4000-8000-000000000003', '${ids.ownerA}', '${family}', '${'3'.repeat(64)}', now() + interval '1 day'
          FROM rotated
        `);
      }),
      database.transaction(async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [family]);
        await tx.exec(`UPDATE "refresh_sessions" SET "revoked_at" = now() WHERE "family_id" = '${family}' AND "revoked_at" IS NULL`);
      }),
    ]);
    const active = await database.query<{ count: number }>(`SELECT count(*)::integer AS count FROM "refresh_sessions" WHERE "family_id" = '${family}' AND "revoked_at" IS NULL`);
    expect(active.rows[0]?.count).toBe(0);
    for (const migration of [...migrations].reverse()) await migration.down(queryRunner);
    await database.close();
  }, 30_000);

  it('enforces scoped operation idempotency and exactly one result without global input dedupe', async () => {
    const database = new PGlite();
    const queryRunner = { query: async (sql: string) => database.exec(sql) } as unknown as QueryRunner;
    for (const migration of migrations) await migration.up(queryRunner);
    await database.exec(`
      INSERT INTO "users" ("id", "email", "name")
      VALUES ('${ids.ownerA}', 'operation-owner@example.test', 'Operation Owner');
      INSERT INTO "workflow_operations"
        ("id", "owner_id", "route", "idempotency_key", "kind", "input_hash", "input")
      VALUES
        ('70000000-0000-4000-8000-000000000001', '${ids.ownerA}', '/runs', 'key-1', 'PROJECT_RUN', '${'1'.repeat(64)}', '{}'),
        ('70000000-0000-4000-8000-000000000002', '${ids.ownerA}', '/runs', 'key-2', 'PROJECT_RUN', '${'1'.repeat(64)}', '{}');
      INSERT INTO "workflow_operation_results" ("operation_id", "value")
      VALUES ('70000000-0000-4000-8000-000000000001', '{}');
    `);
    const durability = await database.query<{
      max_attempts: number;
      input_schema_version: number;
      result_schema_version: number;
      next_attempt_at: Date;
    }>(`
      SELECT "max_attempts", "input_schema_version", "result_schema_version", "next_attempt_at"
      FROM "workflow_operations"
      WHERE "id" = '70000000-0000-4000-8000-000000000001'
    `);
    expect(durability.rows[0]).toMatchObject({
      max_attempts: 3,
      input_schema_version: 1,
      result_schema_version: 1,
    });
    expect(durability.rows[0]?.next_attempt_at).toBeTruthy();
    await expectConstraint(
      database,
      `INSERT INTO "workflow_operations"
        ("owner_id", "route", "idempotency_key", "kind", "input_hash", "input")
       VALUES ('${ids.ownerA}', '/runs', 'key-1', 'OTHER', '${'2'.repeat(64)}', '{}')`,
      'uq_workflow_operations_idempotency',
    );
    await expectConstraint(
      database,
      `INSERT INTO "workflow_operation_results" ("operation_id", "value")
       VALUES ('70000000-0000-4000-8000-000000000001', '{}')`,
      'uq_workflow_operation_results_operation',
    );
    for (const migration of [...migrations].reverse()) await migration.down(queryRunner);
    await database.close();
  }, 30_000);

  it('makes cancel win atomically and rejects a late worker result after lease loss', async () => {
    const database = new PGlite();
    const queryRunner = { query: async (sql: string) => database.exec(sql) } as unknown as QueryRunner;
    for (const migration of migrations) await migration.up(queryRunner);
    await database.exec(`
      INSERT INTO "users" ("id", "email", "name") VALUES ('${ids.ownerA}', 'cancel@example.test', 'Cancel');
      INSERT INTO "workflow_operations"
        ("id", "owner_id", "route", "idempotency_key", "kind", "input_hash", "input", "state", "lease_owner", "lease_expires_at")
      VALUES ('72000000-0000-4000-8000-000000000001', '${ids.ownerA}', '/runs', 'cancel-1', 'PROJECT_PLAN', '${'a'.repeat(64)}', '{}', 'RUNNING', 'worker-a', now() + interval '2 minutes');
      UPDATE "workflow_operations" SET "state" = 'CANCEL_REQUESTED'
      WHERE "id" = '72000000-0000-4000-8000-000000000001' AND "state" = 'RUNNING';
      INSERT INTO "workflow_operation_results" ("operation_id", "value")
      SELECT "id", '{}' FROM "workflow_operations"
      WHERE "id" = '72000000-0000-4000-8000-000000000001'
        AND "state" = 'RUNNING' AND "lease_owner" = 'worker-a';
    `);
    const resultCount = await database.query<{ count: number }>(`SELECT count(*)::integer AS count FROM "workflow_operation_results"`);
    const state = await database.query<{ state: string }>(`SELECT "state" FROM "workflow_operations" WHERE "id" = '72000000-0000-4000-8000-000000000001'`);
    expect(resultCount.rows[0]?.count).toBe(0);
    expect(state.rows[0]?.state).toBe('CANCEL_REQUESTED');
    for (const migration of [...migrations].reverse()) await migration.down(queryRunner);
    await database.close();
  }, 30_000);

  it('applies and rolls back the complete schema in order', async () => {
    const database = new PGlite();
    const queryRunner = {
      query: async (sql: string) => database.exec(sql),
    } as unknown as QueryRunner;

    for (const migration of migrations) await migration.up(queryRunner);
    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'users',
        'roadmaps',
        'comments',
        'notifications',
        'roadmap_events',
        'upload_assets',
        'career_targets',
        'career_evidence',
        'github_installations',
        'proof_missions',
        'proof_verification_runs',
        'proof_reviews',
        'proof_profiles',
        'published_proofs',
        'workflow_operations',
        'workflow_operation_results',
        'workflow_worker_heartbeats',
        'candidate_profile_snapshots',
        'career_target_versions',
        'provider_invalidation_events',
        'repository_invalidation_watermarks',
        'career_diff_snapshots',
        'project_blueprint_versions',
        'project_proposal_sets',
        'project_proposals',
        'project_plan_snapshots',
        'project_tasks',
        'project_feature_entitlements',
        'project_repository_bindings',
        'proof_snapshots',
        'proof_publications',
        'project_run_commands',
        'realtime_connection_tickets',
        'project_runs',
        'project_run_entitlements',
      ]),
    );
    const publicationStates = await database.query<{ enumlabel: string }>(`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'published_proofs_state_enum'
      ORDER BY enumsortorder
    `);
    expect(publicationStates.rows.map(({ enumlabel }) => enumlabel)).toEqual([
      'ACTIVE',
      'UNPUBLISHED',
      'INVALIDATED',
    ]);
    const blueprints = await database.query<{ blueprint_key: string; version: number; catalog_version: string }>(`
      SELECT blueprint_key, version, catalog_version
      FROM project_blueprint_versions
      WHERE blueprint_key LIKE 'blueprint-%'
      ORDER BY blueprint_key
    `);
    expect(blueprints.rows).toEqual([
      { blueprint_key: 'blueprint-1', version: 1, catalog_version: 'v1' },
      { blueprint_key: 'blueprint-2', version: 1, catalog_version: 'v1' },
      { blueprint_key: 'blueprint-3', version: 1, catalog_version: 'v1' },
    ]);

    for (const migration of [...migrations].reverse()) await migration.down(queryRunner);
    const remaining = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(remaining.rows).toEqual([]);
    await database.close();
  }, 30_000);

  it.each(['fresh', 'existing-7000'] as const)(
    'enforces evidence lineage and survives 8000 down/up on %s schema',
    async (mode) => {
      const database = new PGlite();
      const queryRunner = {
        query: async (sql: string) => database.exec(sql),
      } as unknown as QueryRunner;

      if (mode === 'fresh') {
        for (const migration of preProductMigrations) await migration.up(queryRunner);
      } else {
        for (const migration of baseMigrations) await migration.up(queryRunner);
        await evidenceMigration.up(queryRunner);
        await workflowMigration.up(queryRunner);
        await durabilityMigration.up(queryRunner);
      }
      await evidenceMigration.down(queryRunner);
      const circularConstraints = await database.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM pg_constraint
        WHERE conname IN ('FK_proof_missions_current_run', 'FK_proof_missions_current_review_run')
      `);
      expect(circularConstraints.rows[0]?.count).toBe(0);
      await evidenceMigration.up(queryRunner);
      await assertRelationalMatrix(database);

      for (const migration of [...preProductMigrations].reverse()) await migration.down(queryRunner);
      await database.close();
    },
    30_000,
  );
});
