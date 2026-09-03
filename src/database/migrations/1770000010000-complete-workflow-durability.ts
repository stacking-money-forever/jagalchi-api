import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteWorkflowDurability1770000010000 implements MigrationInterface {
  name = 'CompleteWorkflowDurability1770000010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_operations"
        ADD COLUMN "input_schema_version" integer NOT NULL DEFAULT 1,
        ADD COLUMN "result_schema_version" integer NOT NULL DEFAULT 1,
        ADD COLUMN "next_attempt_at" timestamptz,
        ADD COLUMN "max_attempts" integer NOT NULL DEFAULT 3,
        ADD COLUMN "failure_class" varchar(80),
        ADD COLUMN "result_type" varchar(100),
        ADD COLUMN "result_id" uuid,
        ADD COLUMN "result_href" varchar(500)
    `);
    await queryRunner.query(`UPDATE "workflow_operations" SET "next_attempt_at" = "available_at"`);
    await queryRunner.query(`UPDATE "workflow_operations" SET "max_attempts" = GREATEST("max_attempts", "attempts")`);
    await queryRunner.query(`ALTER TABLE "workflow_operations" ALTER COLUMN "next_attempt_at" SET DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "workflow_operations" ALTER COLUMN "next_attempt_at" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "workflow_operations" ADD CONSTRAINT "CHK_workflow_operations_attempts" CHECK ("attempts" >= 0 AND "max_attempts" > 0 AND "attempts" <= "max_attempts")`);
    await queryRunner.query(`CREATE INDEX "idx_workflow_operations_claim_v2" ON "workflow_operations" ("state", "next_attempt_at", "created_at")`);
    await queryRunner.query(`
      CREATE TABLE "workflow_worker_heartbeats" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "worker_id" varchar(160) NOT NULL,
        "heartbeat_at" timestamptz NOT NULL,
        CONSTRAINT "PK_workflow_worker_heartbeats_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workflow_worker_heartbeats_worker" UNIQUE ("worker_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_workflow_worker_heartbeats_time" ON "workflow_worker_heartbeats" ("heartbeat_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "workflow_worker_heartbeats"`);
    await queryRunner.query(`DROP INDEX "idx_workflow_operations_claim_v2"`);
    await queryRunner.query(`ALTER TABLE "workflow_operations" DROP CONSTRAINT "CHK_workflow_operations_attempts"`);
    await queryRunner.query(`
      ALTER TABLE "workflow_operations"
        DROP COLUMN "result_href",
        DROP COLUMN "result_id",
        DROP COLUMN "result_type",
        DROP COLUMN "failure_class",
        DROP COLUMN "max_attempts",
        DROP COLUMN "next_attempt_at",
        DROP COLUMN "result_schema_version",
        DROP COLUMN "input_schema_version"
    `);
  }
}
