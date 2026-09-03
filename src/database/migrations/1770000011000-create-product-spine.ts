import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductSpine1770000011000 implements MigrationInterface {
  name = 'CreateProductSpine1770000011000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "snapshot_state_enum" AS ENUM ('DRAFT', 'CONFIRMED')`);
    await queryRunner.query(`
      CREATE TABLE "candidate_profile_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL,
        "state" "snapshot_state_enum" NOT NULL, "source_snapshot_id" uuid,
        "schema_version" integer NOT NULL DEFAULT 1, "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_candidate_profile_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_candidate_profile_source" FOREIGN KEY ("source_snapshot_id") REFERENCES "candidate_profile_snapshots"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_candidate_profile_payload" CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_candidate_profile_owner" ON "candidate_profile_snapshots" ("owner_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_candidate_profile_operation" ON "candidate_profile_snapshots" (("payload" ->> 'operationId')) WHERE "payload" ? 'operationId'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_candidate_profile_confirmed_source" ON "candidate_profile_snapshots" ("source_snapshot_id") WHERE "source_snapshot_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE TABLE "career_diff_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL,
        "career_target_id" uuid NOT NULL, "career_target_version_id" uuid NOT NULL,
        "candidate_profile_snapshot_id" uuid NOT NULL, "state" "snapshot_state_enum" NOT NULL, "source_snapshot_id" uuid,
        "schema_version" integer NOT NULL DEFAULT 1, "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_career_diff_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_career_diff_target" FOREIGN KEY ("career_target_id") REFERENCES "career_targets"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_career_diff_profile" FOREIGN KEY ("candidate_profile_snapshot_id") REFERENCES "candidate_profile_snapshots"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_career_diff_source" FOREIGN KEY ("source_snapshot_id") REFERENCES "career_diff_snapshots"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_career_diff_payload" CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_career_diff_owner" ON "career_diff_snapshots" ("owner_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_career_diff_confirmed_source" ON "career_diff_snapshots" ("source_snapshot_id") WHERE "source_snapshot_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE TABLE "project_blueprint_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "blueprint_key" varchar(100) NOT NULL,
        "version" integer NOT NULL, "catalog_version" varchar(80) NOT NULL,
        "definition" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_project_blueprint_key_version" UNIQUE ("blueprint_key", "version"),
        CONSTRAINT "CHK_project_blueprint_version" CHECK ("version" > 0 AND jsonb_typeof("definition") = 'object')
      )
    `);
    await queryRunner.query(`
      INSERT INTO "project_blueprint_versions" ("id", "blueprint_key", "version", "catalog_version", "definition")
      VALUES ('b1000000-0000-4000-8000-000000000001', 'verified-feature', 1, 'v1',
        '{"title":"Verified feature","taskRecipes":["implement","test","document"],"evidenceRuleTypes":["CHANGED_PATH","NAMED_CHECK"]}'::jsonb)
    `);
    await queryRunner.query(`
      CREATE TABLE "project_proposal_sets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL,
        "career_diff_snapshot_id" uuid NOT NULL, "schema_version" integer NOT NULL DEFAULT 1,
        "payload" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_proposal_set_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_proposal_set_diff" FOREIGN KEY ("career_diff_snapshot_id") REFERENCES "career_diff_snapshots"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_proposal_set_payload" CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`ALTER TABLE "roadmaps" ADD CONSTRAINT "UQ_roadmaps_id_owner" UNIQUE ("id", "owner_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_proposal_set_operation" ON "project_proposal_sets" (("payload" ->> 'operationId')) WHERE "payload" ? 'operationId'`);
    await queryRunner.query(`
      CREATE TABLE "project_proposals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "proposal_set_id" uuid NOT NULL,
        "blueprint_version_id" uuid NOT NULL, "rank" smallint NOT NULL, "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_project_proposal_set_rank" UNIQUE ("proposal_set_id", "rank"),
        CONSTRAINT "FK_project_proposal_set" FOREIGN KEY ("proposal_set_id") REFERENCES "project_proposal_sets"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_proposal_blueprint" FOREIGN KEY ("blueprint_version_id") REFERENCES "project_blueprint_versions"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_project_proposal_rank" CHECK ("rank" BETWEEN 1 AND 3 AND jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "project_plan_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL,
        "project_proposal_id" uuid NOT NULL, "career_diff_snapshot_id" uuid NOT NULL,
        "candidate_profile_snapshot_id" uuid NOT NULL, "blueprint_version_id" uuid NOT NULL,
        "catalog_version" varchar(80) NOT NULL, "schema_version" integer NOT NULL DEFAULT 1,
        "payload" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_project_plan_id_owner" UNIQUE ("id", "owner_id"),
        CONSTRAINT "FK_project_plan_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_project_plan_proposal" FOREIGN KEY ("project_proposal_id") REFERENCES "project_proposals"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_plan_diff" FOREIGN KEY ("career_diff_snapshot_id") REFERENCES "career_diff_snapshots"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_plan_profile" FOREIGN KEY ("candidate_profile_snapshot_id") REFERENCES "candidate_profile_snapshots"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_plan_blueprint" FOREIGN KEY ("blueprint_version_id") REFERENCES "project_blueprint_versions"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_project_plan_payload" CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "project_runs"
        ADD COLUMN "current_task_id" varchar(128),
        ADD COLUMN "roadmap_id" uuid,
        ADD COLUMN "proof_mission_id" uuid,
        ADD COLUMN "plan_snapshot_id" uuid,
        ADD CONSTRAINT "UQ_project_runs_roadmap" UNIQUE ("roadmap_id"),
        ADD CONSTRAINT "UQ_project_runs_proof_mission" UNIQUE ("proof_mission_id"),
        ADD CONSTRAINT "FK_project_runs_roadmap" FOREIGN KEY ("roadmap_id", "owner_id") REFERENCES "roadmaps"("id", "owner_id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_project_runs_proof_mission" FOREIGN KEY ("proof_mission_id", "owner_id") REFERENCES "proof_missions"("id", "owner_user_id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_project_runs_plan" FOREIGN KEY ("plan_snapshot_id", "owner_id") REFERENCES "project_plan_snapshots"("id", "owner_id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE TABLE "project_tasks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "project_run_id" uuid NOT NULL,
        "task_key" varchar(128) NOT NULL, "title" varchar(300) NOT NULL,
        "state" varchar(20) NOT NULL, "required" boolean NOT NULL,
        "milestone_id" varchar(128), "prerequisite_ids" varchar[] NOT NULL DEFAULT '{}',
        "purpose" text NOT NULL, "acceptance_criteria" jsonb NOT NULL, "evidence_requirements" jsonb NOT NULL,
        "blocked_from" varchar(20), "block_reason_code" varchar(80), "block_note" varchar(1000),
        "version" integer NOT NULL DEFAULT 1, "started_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_project_tasks_run_key" UNIQUE ("project_run_id", "task_key"),
        CONSTRAINT "FK_project_tasks_run" FOREIGN KEY ("project_run_id") REFERENCES "project_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_project_task_state" CHECK ("state" IN ('LOCKED','READY','IN_PROGRESS','BLOCKED','DEFERRED','VERIFYING','DONE')),
        CONSTRAINT "CHK_project_task_blocked" CHECK (
          ("state" = 'BLOCKED') = ("blocked_from" IS NOT NULL)
          AND ("blocked_from" IS NULL OR "blocked_from" IN ('READY','IN_PROGRESS'))
          AND ("state" <> 'BLOCKED' OR "block_reason_code" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_project_tasks_run" ON "project_tasks" ("project_run_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_project_tasks_focus" ON "project_tasks" ("project_run_id") WHERE "state" IN ('IN_PROGRESS','VERIFYING')`);
    await queryRunner.query(`ALTER TABLE "project_runs" ADD CONSTRAINT "FK_project_runs_current_task" FOREIGN KEY ("id", "current_task_id") REFERENCES "project_tasks"("project_run_id", "task_key") ON DELETE RESTRICT`);
    await queryRunner.query(`
      CREATE TABLE "project_feature_entitlements" (
        "user_id" uuid NOT NULL, "feature" varchar(40) NOT NULL, "enabled" boolean NOT NULL DEFAULT false,
        "expires_at" timestamptz, "reason" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_feature_entitlements" PRIMARY KEY ("user_id", "feature"),
        CONSTRAINT "FK_project_feature_entitlement_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_project_feature" CHECK ("feature" = 'PROJECT_RUNS')
      )
    `);
    await queryRunner.query(`
      INSERT INTO "project_feature_entitlements" ("user_id", "feature", "enabled", "reason", "updated_by")
      SELECT "owner_id", 'PROJECT_RUNS', "enabled", "reason", 'migration-1770000011000'
      FROM "project_run_entitlements"
      ON CONFLICT ("user_id", "feature") DO NOTHING
    `);
    await queryRunner.query(`CREATE TYPE "repository_mode_enum" AS ENUM ('EXISTING_OWNED','OPEN_SOURCE_CONTRIBUTION','MANUAL_GREENFIELD')`);
    await queryRunner.query(`
      CREATE TABLE "project_repository_bindings" (
        "project_run_id" uuid PRIMARY KEY, "mode" "repository_mode_enum" NOT NULL,
        "installation_id" uuid, "github_repository_id" bigint, "repository_name" varchar(255),
        "repository_private" boolean, "binding_version" integer NOT NULL DEFAULT 1,
        "pull_number" integer, "expected_head_sha" char(40), "bound_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_project_binding_run" FOREIGN KEY ("project_run_id") REFERENCES "project_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_project_binding_installation" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_project_binding_shape" CHECK (
          ("mode" = 'MANUAL_GREENFIELD' AND "installation_id" IS NULL AND "github_repository_id" IS NULL AND "repository_name" IS NULL AND "repository_private" IS NULL AND "pull_number" IS NULL AND "expected_head_sha" IS NULL)
          OR ("mode" <> 'MANUAL_GREENFIELD' AND "installation_id" IS NOT NULL AND "github_repository_id" IS NOT NULL AND "repository_name" IS NOT NULL AND length(trim("repository_name")) > 0 AND "repository_private" IS NOT NULL AND "pull_number" > 0 AND "expected_head_sha" ~ '^[0-9a-f]{40}$')
        )
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "proof_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL,
        "project_run_id" uuid NOT NULL, "proof_mission_id" uuid NOT NULL,
        "verification_level" varchar(40) NOT NULL, "verified_at" timestamptz NOT NULL,
        "schema_version" integer NOT NULL DEFAULT 1, "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_proof_snapshot_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_proof_snapshot_run" FOREIGN KEY ("project_run_id") REFERENCES "project_runs"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_proof_snapshot_mission" FOREIGN KEY ("proof_mission_id") REFERENCES "proof_missions"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_proof_snapshot_level" CHECK ("verification_level" IN ('MACHINE_VERIFIED','INDEPENDENTLY_REVIEWED')),
        CONSTRAINT "CHK_proof_snapshot_payload" CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`CREATE TYPE "proof_publication_status_enum" AS ENUM ('PUBLISHED','UNPUBLISHED')`);
    await queryRunner.query(`CREATE TYPE "proof_validity_enum" AS ENUM ('ACTIVE','INVALIDATED','SUPERSEDED')`);
    await queryRunner.query(`
      CREATE TABLE "proof_publications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "project_run_id" uuid NOT NULL,
        "proof_snapshot_id" uuid NOT NULL, "publication_status" "proof_publication_status_enum" NOT NULL,
        "validity" "proof_validity_enum" NOT NULL, "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_proof_publication_run" FOREIGN KEY ("project_run_id") REFERENCES "project_runs"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_proof_publication_snapshot" FOREIGN KEY ("proof_snapshot_id") REFERENCES "proof_snapshots"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_proof_publications_current_run" ON "proof_publications" ("project_run_id") WHERE "validity" <> 'SUPERSEDED'`);
    await queryRunner.query(`
      CREATE TABLE "project_run_commands" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL,
        "route" varchar(200) NOT NULL, "idempotency_key" uuid NOT NULL,
        "input_hash" char(64) NOT NULL, "response" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_project_run_commands_idempotency" UNIQUE ("owner_id", "route", "idempotency_key"),
        CONSTRAINT "FK_project_run_command_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_project_run_command_response" CHECK (jsonb_typeof("response") = 'object')
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "project_run_commands"`);
    await queryRunner.query(`DROP INDEX "UQ_proof_publications_current_run"`);
    await queryRunner.query(`DROP TABLE "proof_publications"`);
    await queryRunner.query(`DROP TYPE "proof_validity_enum"`);
    await queryRunner.query(`DROP TYPE "proof_publication_status_enum"`);
    await queryRunner.query(`DROP TABLE "proof_snapshots"`);
    await queryRunner.query(`DROP TABLE "project_repository_bindings"`);
    await queryRunner.query(`DROP TYPE "repository_mode_enum"`);
    await queryRunner.query(`DROP TABLE "project_feature_entitlements"`);
    await queryRunner.query(`ALTER TABLE "project_runs" DROP CONSTRAINT "FK_project_runs_current_task"`);
    await queryRunner.query(`DROP INDEX "UQ_project_tasks_focus"`);
    await queryRunner.query(`DROP TABLE "project_tasks"`);
    await queryRunner.query(`ALTER TABLE "project_runs" DROP CONSTRAINT "FK_project_runs_plan", DROP CONSTRAINT "FK_project_runs_proof_mission", DROP CONSTRAINT "FK_project_runs_roadmap", DROP CONSTRAINT "UQ_project_runs_proof_mission", DROP CONSTRAINT "UQ_project_runs_roadmap", DROP COLUMN "plan_snapshot_id", DROP COLUMN "proof_mission_id", DROP COLUMN "roadmap_id", DROP COLUMN "current_task_id"`);
    await queryRunner.query(`DROP TABLE "project_plan_snapshots"`);
    await queryRunner.query(`ALTER TABLE "roadmaps" DROP CONSTRAINT "UQ_roadmaps_id_owner"`);
    await queryRunner.query(`DROP TABLE "project_proposals"`);
    await queryRunner.query(`DROP TABLE "project_proposal_sets"`);
    await queryRunner.query(`DROP TABLE "project_blueprint_versions"`);
    await queryRunner.query(`DROP TABLE "career_diff_snapshots"`);
    await queryRunner.query(`DROP TABLE "candidate_profile_snapshots"`);
    await queryRunner.query(`DROP TYPE "snapshot_state_enum"`);
  }
}
