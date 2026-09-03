import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCareerTargetVersions1770000012000 implements MigrationInterface {
  name = 'CreateCareerTargetVersions1770000012000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workflow_operations" ADD COLUMN "version" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`
      CREATE TABLE "career_target_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL,
        "career_target_id" uuid NOT NULL, "version" integer NOT NULL,
        "source_hash" char(64) NOT NULL, "capture_status" varchar(40) NOT NULL,
        "schema_version" integer NOT NULL DEFAULT 1, "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_career_target_version" UNIQUE ("career_target_id", "version"),
        CONSTRAINT "UQ_career_target_source_hash" UNIQUE ("owner_id", "source_hash"),
        CONSTRAINT "FK_career_target_version_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_career_target_version_target" FOREIGN KEY ("career_target_id", "owner_id") REFERENCES "career_targets"("id", "user_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_career_target_capture" CHECK ("capture_status" IN ('AUTOMATIC','DEGRADED_MANUAL_CAPTURE') AND jsonb_typeof("payload") = 'object')
      )
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`DROP TABLE "career_target_versions"`); await queryRunner.query(`ALTER TABLE "workflow_operations" DROP COLUMN "version"`); }
}
