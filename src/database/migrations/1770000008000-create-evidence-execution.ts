import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEvidenceExecution1770000008000 implements MigrationInterface {
  name = 'CreateEvidenceExecution1770000008000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "github_installations_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
      CREATE TYPE "github_webhook_deliveries_state_enum" AS ENUM ('LOCAL_APPLIED', 'RECONCILED', 'RECONCILE_FAILED');
      CREATE TYPE "proof_missions_state_enum" AS ENUM ('DRAFT', 'BOUND', 'REVIEW_PENDING', 'APPROVED', 'RETURNED', 'ARCHIVED');
      CREATE TYPE "proof_criteria_type_enum" AS ENUM ('MERGED_PR', 'BASE_BRANCH', 'CHANGED_PATH', 'NAMED_CHECK', 'HUMAN_CHECK');
      CREATE TYPE "proof_verification_runs_status_enum" AS ENUM ('PASS', 'FAIL', 'ERROR');
      CREATE TYPE "proof_reviews_decision_enum" AS ENUM ('APPROVED', 'RETURNED');
      CREATE TYPE "proof_profiles_state_enum" AS ENUM ('DISABLED', 'ENABLED');
      CREATE TYPE "published_proofs_state_enum" AS ENUM ('ACTIVE', 'UNPUBLISHED', 'INVALIDATED');

      ALTER TABLE "career_targets"
        ADD CONSTRAINT "uq_career_targets_id_user_id" UNIQUE ("id", "user_id");

      CREATE TABLE "github_installation_claim_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "state_hash" char(64) NOT NULL,
        "return_path" varchar(500) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_github_claim_attempt_state_hash" UNIQUE ("state_hash"),
        CONSTRAINT "CHK_github_claim_attempt_return_path" CHECK ("return_path" LIKE '/%' AND "return_path" NOT LIKE '//%'),
        CONSTRAINT "FK_github_claim_attempt_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_github_claim_attempt_user_expiry" ON "github_installation_claim_attempts" ("user_id", "expires_at");
      CREATE INDEX "IDX_github_claim_attempt_unconsumed" ON "github_installation_claim_attempts" ("expires_at") WHERE "consumed_at" IS NULL;

      CREATE TABLE "github_installations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" uuid NOT NULL,
        "github_installation_id" bigint NOT NULL,
        "github_account_id" bigint NOT NULL,
        "account_type" varchar(16) NOT NULL,
        "status" "github_installations_status_enum" NOT NULL,
        "suspended_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_github_installation_id" UNIQUE ("github_installation_id"),
        CONSTRAINT "UQ_github_installation_owner" UNIQUE ("id", "owner_user_id"),
        CONSTRAINT "CHK_github_installation_personal_account" CHECK ("account_type" = 'USER'),
        CONSTRAINT "FK_github_installation_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_github_installation_owner_status" ON "github_installations" ("owner_user_id", "status");
      CREATE INDEX "IDX_github_installation_account" ON "github_installations" ("github_account_id");

      CREATE TABLE "github_installation_repositories" (
        "installation_id" uuid NOT NULL,
        "github_repository_id" bigint NOT NULL,
        "full_name" varchar(255) NOT NULL,
        "private" boolean NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "removed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_github_installation_repositories" PRIMARY KEY ("installation_id", "github_repository_id"),
        CONSTRAINT "FK_github_repository_installation" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_github_repository_active" ON "github_installation_repositories" ("github_repository_id", "active");

      CREATE TABLE "proof_profiles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" uuid NOT NULL,
        "public_id" varchar(64) NOT NULL,
        "state" "proof_profiles_state_enum" NOT NULL DEFAULT 'DISABLED',
        "display_name" varchar(100) NOT NULL,
        "summary" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_proof_profiles_owner_user_id" UNIQUE ("owner_user_id"),
        CONSTRAINT "uq_proof_profiles_public_id" UNIQUE ("public_id"),
        CONSTRAINT "CHK_proof_profiles_public_id_entropy" CHECK (length("public_id") >= 22 AND "public_id" ~ '^[A-Za-z0-9_-]+$'),
        CONSTRAINT "FK_proof_profiles_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_proof_profiles_owner_user_id" ON "proof_profiles" ("owner_user_id");
      CREATE INDEX "IDX_proof_profiles_state" ON "proof_profiles" ("state");
      CREATE INDEX "IDX_proof_profiles_state_updated" ON "proof_profiles" ("state", "updated_at");

      CREATE TABLE "proof_missions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" uuid NOT NULL,
        "target_id" uuid NOT NULL,
        "competency_slug" varchar(100) NOT NULL,
        "title" varchar(160) NOT NULL,
        "summary" text,
        "state" "proof_missions_state_enum" NOT NULL DEFAULT 'DRAFT',
        "criteria_version" integer NOT NULL DEFAULT 1,
        "binding_version" integer NOT NULL DEFAULT 0,
        "installation_id" uuid,
        "github_repository_id" bigint,
        "pull_number" integer,
        "repository_name" varchar(255),
        "repository_private" boolean,
        "pull_title" varchar(512),
        "pull_url" varchar(2048),
        "current_verification_run_id" uuid,
        "current_review_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_proof_missions_id_owner_user_id" UNIQUE ("id", "owner_user_id"),
        CONSTRAINT "CHK_proof_missions_versions" CHECK ("criteria_version" >= 1 AND "binding_version" >= 0),
        CONSTRAINT "CHK_proof_missions_binding_tuple" CHECK (
          ("installation_id" IS NULL AND "github_repository_id" IS NULL AND "pull_number" IS NULL AND "repository_name" IS NULL AND "repository_private" IS NULL AND "pull_title" IS NULL AND "pull_url" IS NULL)
          OR
          ("installation_id" IS NOT NULL AND "github_repository_id" IS NOT NULL AND "pull_number" IS NOT NULL AND "pull_number" > 0 AND "repository_name" IS NOT NULL AND "repository_private" IS NOT NULL AND "pull_title" IS NOT NULL AND "pull_url" IS NOT NULL)
        ),
        CONSTRAINT "FK_proof_missions_target_owner" FOREIGN KEY ("target_id", "owner_user_id") REFERENCES "career_targets"("id", "user_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_proof_missions_installation_owner" FOREIGN KEY ("installation_id", "owner_user_id") REFERENCES "github_installations"("id", "owner_user_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_proof_missions_installation_repository" FOREIGN KEY ("installation_id", "github_repository_id") REFERENCES "github_installation_repositories"("installation_id", "github_repository_id") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_proof_missions_owner_user_id" ON "proof_missions" ("owner_user_id");
      CREATE INDEX "IDX_proof_missions_target_id" ON "proof_missions" ("target_id");
      CREATE INDEX "IDX_proof_missions_state" ON "proof_missions" ("state");
      CREATE INDEX "IDX_proof_missions_owner_target" ON "proof_missions" ("owner_user_id", "target_id");
      CREATE INDEX "IDX_proof_missions_target_competency_state" ON "proof_missions" ("target_id", "competency_slug", "state");
      CREATE INDEX "IDX_proof_missions_bound_pr" ON "proof_missions" ("installation_id", "github_repository_id", "pull_number") WHERE "installation_id" IS NOT NULL;
      CREATE INDEX "IDX_proof_missions_review_queue" ON "proof_missions" ("state", "updated_at") WHERE "state" = 'REVIEW_PENDING';

      CREATE TABLE "proof_criteria" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "mission_id" uuid NOT NULL,
        "position" smallint NOT NULL,
        "type" "proof_criteria_type_enum" NOT NULL,
        "config" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_proof_criteria_mission_position" UNIQUE ("mission_id", "position"),
        CONSTRAINT "CHK_proof_criteria_position" CHECK ("position" BETWEEN 0 AND 9),
        CONSTRAINT "CHK_proof_criteria_config_bounded" CHECK (
          jsonb_typeof("config") = 'object'
          AND pg_column_size("config") <= 8192
          AND (
            ("type" = 'MERGED_PR' AND "config" = '{}'::jsonb)
            OR ("type" = 'BASE_BRANCH' AND jsonb_typeof("config"->'branch') = 'string' AND length("config"->>'branch') BETWEEN 1 AND 200 AND ("config" - 'branch') = '{}'::jsonb)
            OR ("type" = 'CHANGED_PATH' AND jsonb_typeof("config"->'glob') = 'string' AND length("config"->>'glob') BETWEEN 1 AND 200 AND ("config" - 'glob') = '{}'::jsonb)
            OR ("type" = 'NAMED_CHECK' AND jsonb_typeof("config"->'context') = 'string' AND length("config"->>'context') BETWEEN 1 AND 200 AND ("config" - 'context') = '{}'::jsonb)
            OR ("type" = 'HUMAN_CHECK' AND jsonb_typeof("config"->'label') = 'string' AND length("config"->>'label') BETWEEN 1 AND 200 AND ("config" - 'label') = '{}'::jsonb)
          )
        ),
        CONSTRAINT "FK_proof_criteria_mission" FOREIGN KEY ("mission_id") REFERENCES "proof_missions"("id") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_proof_criteria_mission_id" ON "proof_criteria" ("mission_id");
      CREATE INDEX "IDX_proof_criteria_type" ON "proof_criteria" ("type");
      CREATE INDEX "IDX_proof_criteria_mission_type" ON "proof_criteria" ("mission_id", "type");

      CREATE TABLE "proof_verification_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "mission_id" uuid NOT NULL,
        "binding_version" integer NOT NULL,
        "criteria_version" integer NOT NULL,
        "head_sha" varchar(64) NOT NULL,
        "criteria_digest" varchar(64) NOT NULL,
        "facts_digest" varchar(64) NOT NULL,
        "status" "proof_verification_runs_status_enum" NOT NULL,
        "results" jsonb NOT NULL,
        "observed_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_proof_runs_id_mission_id" UNIQUE ("id", "mission_id"),
        CONSTRAINT "uq_proof_runs_observation" UNIQUE ("mission_id", "binding_version", "criteria_version", "head_sha", "criteria_digest", "facts_digest"),
        CONSTRAINT "CHK_proof_runs_versions" CHECK ("binding_version" > 0 AND "criteria_version" >= 1),
        CONSTRAINT "CHK_proof_runs_head_sha" CHECK ("head_sha" ~ '^[0-9a-f]{40,64}$'),
        CONSTRAINT "CHK_proof_runs_results_bounded" CHECK (jsonb_typeof("results") = 'array' AND jsonb_array_length("results") <= 10 AND pg_column_size("results") <= 65536),
        CONSTRAINT "FK_proof_runs_mission" FOREIGN KEY ("mission_id") REFERENCES "proof_missions"("id") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_proof_verification_runs_mission_id" ON "proof_verification_runs" ("mission_id");
      CREATE INDEX "IDX_proof_verification_runs_status" ON "proof_verification_runs" ("status");
      CREATE INDEX "IDX_proof_runs_mission_created" ON "proof_verification_runs" ("mission_id", "created_at" DESC);
      CREATE INDEX "IDX_proof_runs_pass" ON "proof_verification_runs" ("mission_id", "created_at" DESC) WHERE "status" = 'PASS';

      CREATE TABLE "proof_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "mission_id" uuid NOT NULL,
        "verification_run_id" uuid NOT NULL,
        "reviewer_id" uuid,
        "decision" "proof_reviews_decision_enum" NOT NULL,
        "note" text,
        "reviewed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_proof_reviews_verification_run_id" UNIQUE ("verification_run_id"),
        CONSTRAINT "uq_proof_reviews_id_mission_run" UNIQUE ("id", "mission_id", "verification_run_id"),
        CONSTRAINT "FK_proof_reviews_mission" FOREIGN KEY ("mission_id") REFERENCES "proof_missions"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_proof_reviews_run_mission" FOREIGN KEY ("verification_run_id", "mission_id") REFERENCES "proof_verification_runs"("id", "mission_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_proof_reviews_reviewer" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL
      );
      CREATE INDEX "IDX_proof_reviews_mission_id" ON "proof_reviews" ("mission_id");
      CREATE INDEX "IDX_proof_reviews_reviewer_id" ON "proof_reviews" ("reviewer_id");
      CREATE INDEX "IDX_proof_reviews_decision" ON "proof_reviews" ("decision");
      CREATE INDEX "IDX_proof_reviews_reviewer_date" ON "proof_reviews" ("reviewer_id", "reviewed_at" DESC);
      CREATE INDEX "IDX_proof_reviews_decision_date" ON "proof_reviews" ("decision", "reviewed_at" DESC);

      CREATE TABLE "published_proofs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "profile_id" uuid NOT NULL,
        "mission_id" uuid NOT NULL,
        "verification_run_id" uuid NOT NULL,
        "review_id" uuid NOT NULL,
        "state" "published_proofs_state_enum" NOT NULL,
        "schema_version" smallint NOT NULL DEFAULT 1,
        "snapshot" jsonb NOT NULL,
        "valid_until" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_published_proofs_profile_mission" UNIQUE ("profile_id", "mission_id"),
        CONSTRAINT "CHK_published_proofs_schema" CHECK ("schema_version" = 1 AND jsonb_typeof("snapshot") = 'object' AND pg_column_size("snapshot") <= 65536),
        CONSTRAINT "FK_published_proofs_profile" FOREIGN KEY ("profile_id") REFERENCES "proof_profiles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_published_proofs_mission" FOREIGN KEY ("mission_id") REFERENCES "proof_missions"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_published_proofs_run_mission" FOREIGN KEY ("verification_run_id", "mission_id") REFERENCES "proof_verification_runs"("id", "mission_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_published_proofs_review_mission_run" FOREIGN KEY ("review_id", "mission_id", "verification_run_id") REFERENCES "proof_reviews"("id", "mission_id", "verification_run_id") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_published_proofs_profile_id" ON "published_proofs" ("profile_id");
      CREATE INDEX "IDX_published_proofs_mission_id" ON "published_proofs" ("mission_id");
      CREATE INDEX "IDX_published_proofs_state" ON "published_proofs" ("state");
      CREATE INDEX "IDX_published_proofs_active_profile_validity" ON "published_proofs" ("profile_id", "valid_until") WHERE "state" = 'ACTIVE';
      CREATE INDEX "IDX_published_proofs_mission_state" ON "published_proofs" ("mission_id", "state");

      CREATE TABLE "github_webhook_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "delivery_id" uuid NOT NULL,
        "event_name" varchar(40) NOT NULL,
        "installation_id" uuid,
        "github_installation_id" bigint,
        "github_repository_id" bigint,
        "pull_number" integer,
        "head_sha" char(40),
        "state" "github_webhook_deliveries_state_enum" NOT NULL,
        "error_code" varchar(64),
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "reconciled_at" timestamptz,
        CONSTRAINT "UQ_github_webhook_delivery_id" UNIQUE ("delivery_id"),
        CONSTRAINT "FK_github_delivery_installation" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE SET NULL
      );
      CREATE INDEX "IDX_github_delivery_state_received" ON "github_webhook_deliveries" ("state", "received_at");
      CREATE INDEX "IDX_github_delivery_installation_received" ON "github_webhook_deliveries" ("installation_id", "received_at");
      CREATE INDEX "IDX_github_delivery_repository_pull" ON "github_webhook_deliveries" ("github_repository_id", "pull_number");

      CREATE TABLE "command_idempotency_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" uuid NOT NULL,
        "command" varchar(80) NOT NULL,
        "key" varchar(128) NOT NULL,
        "request_digest" varchar(64) NOT NULL,
        "resource_id" uuid,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_command_idempotency_owner_command_key" UNIQUE ("owner_user_id", "command", "key"),
        CONSTRAINT "FK_command_idempotency_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_command_idempotency_owner_user_id" ON "command_idempotency_keys" ("owner_user_id");
      CREATE INDEX "IDX_command_idempotency_expires_at" ON "command_idempotency_keys" ("expires_at");

      ALTER TABLE "proof_missions"
        ADD CONSTRAINT "FK_proof_missions_current_run" FOREIGN KEY ("current_verification_run_id", "id") REFERENCES "proof_verification_runs"("id", "mission_id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_proof_missions_current_review_run" FOREIGN KEY ("current_review_id", "id", "current_verification_run_id") REFERENCES "proof_reviews"("id", "mission_id", "verification_run_id") ON DELETE RESTRICT,
        ADD CONSTRAINT "CHK_proof_missions_current_pointers" CHECK ("current_review_id" IS NULL OR "current_verification_run_id" IS NOT NULL),
        ADD CONSTRAINT "CHK_proof_missions_state_consistency" CHECK (
          ("state" = 'DRAFT' AND "installation_id" IS NULL AND "current_verification_run_id" IS NULL AND "current_review_id" IS NULL)
          OR ("state" = 'BOUND' AND "installation_id" IS NOT NULL AND "current_review_id" IS NULL)
          OR ("state" = 'REVIEW_PENDING' AND "installation_id" IS NOT NULL AND "current_verification_run_id" IS NOT NULL AND "current_review_id" IS NULL)
          OR ("state" IN ('APPROVED', 'RETURNED') AND "installation_id" IS NOT NULL AND "current_verification_run_id" IS NOT NULL AND "current_review_id" IS NOT NULL)
          OR ("state" = 'ARCHIVED' AND "current_verification_run_id" IS NULL AND "current_review_id" IS NULL)
        );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "proof_missions"
        DROP CONSTRAINT IF EXISTS "CHK_proof_missions_state_consistency",
        DROP CONSTRAINT IF EXISTS "CHK_proof_missions_current_pointers",
        DROP CONSTRAINT IF EXISTS "FK_proof_missions_current_review_run",
        DROP CONSTRAINT IF EXISTS "FK_proof_missions_current_run";

      DROP TABLE IF EXISTS "published_proofs";
      DROP TABLE IF EXISTS "proof_reviews";
      DROP TABLE IF EXISTS "proof_verification_runs";
      DROP TABLE IF EXISTS "proof_criteria";
      DROP TABLE IF EXISTS "proof_missions";
      DROP TABLE IF EXISTS "proof_profiles";
      DROP TABLE IF EXISTS "command_idempotency_keys";
      DROP TABLE IF EXISTS "github_webhook_deliveries";
      DROP TABLE IF EXISTS "github_installation_repositories";
      DROP TABLE IF EXISTS "github_installations";
      DROP TABLE IF EXISTS "github_installation_claim_attempts";

      ALTER TABLE "career_targets" DROP CONSTRAINT IF EXISTS "uq_career_targets_id_user_id";

      DROP TYPE IF EXISTS "published_proofs_state_enum";
      DROP TYPE IF EXISTS "proof_profiles_state_enum";
      DROP TYPE IF EXISTS "proof_reviews_decision_enum";
      DROP TYPE IF EXISTS "proof_verification_runs_status_enum";
      DROP TYPE IF EXISTS "proof_criteria_type_enum";
      DROP TYPE IF EXISTS "proof_missions_state_enum";
      DROP TYPE IF EXISTS "github_webhook_deliveries_state_enum";
      DROP TYPE IF EXISTS "github_installations_status_enum";
    `);
  }
}
