import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUploadsDomain1770000005000 implements MigrationInterface {
  name = 'CreateUploadsDomain1770000005000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "upload_status_enum" AS ENUM ('PENDING', 'READY')`);
    await queryRunner.query(
      `CREATE TYPE "upload_purpose_enum" AS ENUM ('PROFILE_IMAGE', 'ROADMAP_ATTACHMENT')`,
    );
    await queryRunner.query(`
      CREATE TABLE "upload_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "roadmap_id" uuid,
        "purpose" "upload_purpose_enum" NOT NULL,
        "object_key" varchar(700) NOT NULL,
        "file_name" varchar(180) NOT NULL,
        "content_type" varchar(120) NOT NULL,
        "expected_size" integer NOT NULL,
        "status" "upload_status_enum" NOT NULL DEFAULT 'PENDING',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_upload_assets_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_upload_assets_object_key" UNIQUE ("object_key"),
        CONSTRAINT "CHK_upload_assets_size" CHECK ("expected_size" BETWEEN 1 AND 5242880),
        CONSTRAINT "FK_upload_assets_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_upload_assets_roadmap" FOREIGN KEY ("roadmap_id")
          REFERENCES "roadmaps" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_upload_assets_owner" ON "upload_assets" ("owner_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_upload_assets_roadmap" ON "upload_assets" ("roadmap_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "upload_assets"`);
    await queryRunner.query(`DROP TYPE "upload_purpose_enum"`);
    await queryRunner.query(`DROP TYPE "upload_status_enum"`);
  }
}
