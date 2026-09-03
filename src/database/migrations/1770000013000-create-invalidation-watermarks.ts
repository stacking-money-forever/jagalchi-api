import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvalidationWatermarks1770000013000 implements MigrationInterface {
  name = 'CreateInvalidationWatermarks1770000013000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "proof_snapshots" ADD COLUMN "invalidation_generation" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`CREATE TABLE "provider_invalidation_events" ("provider" varchar(20) NOT NULL, "provider_event_id" varchar(160) NOT NULL, "repository_id" varchar(100) NOT NULL, "pull_number" integer, "head_sha" char(40), "kind" varchar(50) NOT NULL, "observed_at" timestamptz NOT NULL, "payload" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_provider_invalidation_events" PRIMARY KEY ("provider", "provider_event_id"), CONSTRAINT "CHK_provider_invalidation_payload" CHECK (jsonb_typeof("payload") = 'object'))`);
    await queryRunner.query(`CREATE INDEX "IDX_provider_invalidation_repository_observed" ON "provider_invalidation_events" ("repository_id", "observed_at")`);
    await queryRunner.query(`CREATE TABLE "repository_invalidation_watermarks" ("provider" varchar(20) NOT NULL, "repository_id" varchar(100) NOT NULL, "generation" integer NOT NULL DEFAULT 0, "last_event_id" varchar(160) NOT NULL, "observed_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_repository_invalidation_watermarks" PRIMARY KEY ("provider", "repository_id"), CONSTRAINT "FK_repository_watermark_event" FOREIGN KEY ("provider", "last_event_id") REFERENCES "provider_invalidation_events"("provider", "provider_event_id") ON DELETE RESTRICT, CONSTRAINT "CHK_repository_watermark_generation" CHECK ("generation" > 0))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`DROP TABLE "repository_invalidation_watermarks"`); await queryRunner.query(`DROP TABLE "provider_invalidation_events"`); await queryRunner.query(`ALTER TABLE "proof_snapshots" DROP COLUMN "invalidation_generation"`); }
}
