import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkflowOperations1770000009000 implements MigrationInterface {
  name = 'CreateWorkflowOperations1770000009000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "refresh_sessions" ADD COLUMN "family_id" uuid DEFAULT gen_random_uuid()`);
    await queryRunner.query(`
      WITH RECURSIVE families AS (
        SELECT session.id, session.id AS root_id
        FROM "refresh_sessions" session
        WHERE NOT EXISTS (
          SELECT 1 FROM "refresh_sessions" parent WHERE parent."replaced_by_id" = session.id
        )
        UNION ALL
        SELECT child.id, families.root_id
        FROM families
        JOIN "refresh_sessions" current_session ON current_session.id = families.id
        JOIN "refresh_sessions" child ON child.id = current_session."replaced_by_id"
      )
      UPDATE "refresh_sessions" session
      SET "family_id" = families.root_id
      FROM families
      WHERE session.id = families.id
    `);
    await queryRunner.query(`UPDATE "refresh_sessions" SET "family_id" = "id" WHERE "family_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "refresh_sessions" ALTER COLUMN "family_id" SET NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_refresh_sessions_family" ON "refresh_sessions" ("family_id")`);
    await queryRunner.query(`
      CREATE TYPE "workflow_operations_state_enum" AS ENUM
        ('PENDING', 'RUNNING', 'CANCEL_REQUESTED', 'SUCCEEDED', 'FAILED', 'CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TABLE "workflow_operations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "route" varchar(160) NOT NULL,
        "idempotency_key" varchar(160) NOT NULL,
        "kind" varchar(100) NOT NULL,
        "input_hash" char(64) NOT NULL,
        "input" jsonb NOT NULL,
        "state" "workflow_operations_state_enum" NOT NULL DEFAULT 'PENDING',
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "lease_owner" varchar(160),
        "lease_expires_at" timestamptz,
        "heartbeat_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "error_code" varchar(100),
        "error_message" varchar(1000),
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_operations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workflow_operations_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_workflow_operations_idempotency"
          UNIQUE ("owner_id", "route", "idempotency_key"),
        CONSTRAINT "CHK_workflow_operations_input" CHECK (jsonb_typeof("input") = 'object'),
        CONSTRAINT "CHK_workflow_operations_lease" CHECK (
          ("state" IN ('RUNNING', 'CANCEL_REQUESTED') AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
          OR ("state" NOT IN ('RUNNING', 'CANCEL_REQUESTED') AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_workflow_operations_claim"
      ON "workflow_operations" ("state", "available_at", "created_at")
    `);
    await queryRunner.query(`
      CREATE TABLE "workflow_operation_results" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "operation_id" uuid NOT NULL,
        "value" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_operation_results_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workflow_operation_results_operation" UNIQUE ("operation_id"),
        CONSTRAINT "FK_workflow_operation_results_operation" FOREIGN KEY ("operation_id")
          REFERENCES "workflow_operations" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_workflow_operation_results_value" CHECK (jsonb_typeof("value") = 'object')
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "realtime_connection_tickets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" char(64) NOT NULL,
        "audience" varchar(40) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_realtime_connection_tickets_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_realtime_connection_tickets_token" UNIQUE ("token_hash"),
        CONSTRAINT "FK_realtime_connection_tickets_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_realtime_connection_tickets_user" ON "realtime_connection_tickets" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_realtime_connection_tickets_expiry" ON "realtime_connection_tickets" ("expires_at")`);
    await queryRunner.query(`CREATE TYPE "project_runs_state_enum" AS ENUM ('READY', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'ARCHIVED')`);
    await queryRunner.query(`
      CREATE TABLE "project_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source_operation_id" uuid NOT NULL,
        "owner_id" uuid NOT NULL,
        "state" "project_runs_state_enum" NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "projection" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_project_runs_source_operation" UNIQUE ("source_operation_id"),
        CONSTRAINT "FK_project_runs_source_operation" FOREIGN KEY ("source_operation_id") REFERENCES "workflow_operations" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_runs_owner" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_project_runs_version" CHECK ("version" > 0),
        CONSTRAINT "CHK_project_runs_projection" CHECK (jsonb_typeof("projection") = 'object')
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_project_runs_owner" ON "project_runs" ("owner_id")`);
    await queryRunner.query(`
      CREATE TABLE "project_run_entitlements" (
        "owner_id" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "reason" varchar(160) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_run_entitlements_owner" PRIMARY KEY ("owner_id"),
        CONSTRAINT "FK_project_run_entitlements_owner" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "project_run_entitlements"`);
    await queryRunner.query(`DROP TABLE "project_runs"`);
    await queryRunner.query(`DROP TYPE "project_runs_state_enum"`);
    await queryRunner.query(`DROP TABLE "realtime_connection_tickets"`);
    await queryRunner.query(`DROP TABLE "workflow_operation_results"`);
    await queryRunner.query(`DROP TABLE "workflow_operations"`);
    await queryRunner.query(`DROP TYPE "workflow_operations_state_enum"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_sessions_family"`);
    await queryRunner.query(`ALTER TABLE "refresh_sessions" DROP COLUMN "family_id"`);
  }
}
