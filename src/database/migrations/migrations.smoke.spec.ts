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
const migrations = [...baseMigrations, evidenceMigration];

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
        for (const migration of migrations) await migration.up(queryRunner);
      } else {
        for (const migration of baseMigrations) await migration.up(queryRunner);
        await evidenceMigration.up(queryRunner);
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

      for (const migration of [...migrations].reverse()) await migration.down(queryRunner);
      await database.close();
    },
    30_000,
  );
});
