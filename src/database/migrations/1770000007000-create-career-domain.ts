import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCareerDomain1770000007000 implements MigrationInterface {
  name = 'CreateCareerDomain1770000007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "career_targets_status_enum" AS ENUM ('ACTIVE', 'ARCHIVED');
      CREATE TYPE "career_evidence_kind_enum" AS ENUM (
        'GITHUB_PULL_REQUEST',
        'GITHUB_REPOSITORY',
        'DEPLOYMENT',
        'ARTICLE',
        'OTHER'
      );
      CREATE TYPE "career_evidence_status_enum" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');

      CREATE TABLE "career_targets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "company" varchar(100) NOT NULL,
        "role" varchar(120) NOT NULL,
        "posting_url" varchar(2048),
        "requirements" text NOT NULL,
        "competency_slugs" varchar[] NOT NULL,
        "status" "career_targets_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_career_targets_user_id" ON "career_targets" ("user_id");
      CREATE INDEX "IDX_career_targets_status" ON "career_targets" ("status");

      CREATE TABLE "career_evidence" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "title" varchar(160) NOT NULL,
        "url" varchar(2048) NOT NULL,
        "kind" "career_evidence_kind_enum" NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "competency_slugs" varchar[] NOT NULL,
        "status" "career_evidence_status_enum" NOT NULL DEFAULT 'SUBMITTED',
        "reviewer_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "review_note" text,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_career_evidence_user_id" ON "career_evidence" ("user_id");
      CREATE INDEX "IDX_career_evidence_status" ON "career_evidence" ("status");
      CREATE INDEX "IDX_career_evidence_reviewer_id" ON "career_evidence" ("reviewer_id");
      CREATE INDEX "IDX_career_evidence_competency_slugs" ON "career_evidence" USING GIN ("competency_slugs");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "career_evidence";
      DROP TABLE IF EXISTS "career_targets";
      DROP TYPE IF EXISTS "career_evidence_status_enum";
      DROP TYPE IF EXISTS "career_evidence_kind_enum";
      DROP TYPE IF EXISTS "career_targets_status_enum";
    `);
  }
}
