import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRoadmapDomain1770000001000 implements MigrationInterface {
  name = 'CreateRoadmapDomain1770000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "roadmaps_visibility_enum" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "roadmap_reactions_type_enum" AS ENUM ('LIKE', 'FAVORITE')`,
    );
    await queryRunner.query(`
      CREATE TABLE "roadmap_directories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "parent_id" uuid,
        "name" varchar(80) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roadmap_directories_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_roadmap_directories_parent" FOREIGN KEY ("parent_id")
          REFERENCES "roadmap_directories" ("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_roadmap_directories_location"
          UNIQUE NULLS NOT DISTINCT ("user_id", "parent_id", "name")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmap_directories_user" ON "roadmap_directories" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmap_directories_parent" ON "roadmap_directories" ("parent_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "roadmaps" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "tags" varchar[] NOT NULL DEFAULT '{}',
        "visibility" "roadmaps_visibility_enum" NOT NULL DEFAULT 'PRIVATE',
        "graph" jsonb NOT NULL DEFAULT '{"schemaVersion":1,"nodes":[],"edges":[]}'::jsonb,
        "directory_id" uuid,
        "forked_from_id" uuid,
        "fork_count" integer NOT NULL DEFAULT 0,
        "like_count" integer NOT NULL DEFAULT 0,
        "favorite_count" integer NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_roadmaps_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_roadmaps_counts" CHECK (
          "fork_count" >= 0 AND "like_count" >= 0 AND "favorite_count" >= 0
        ),
        CONSTRAINT "FK_roadmaps_directory" FOREIGN KEY ("directory_id")
          REFERENCES "roadmap_directories" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_roadmaps_forked_from" FOREIGN KEY ("forked_from_id")
          REFERENCES "roadmaps" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_roadmaps_owner" ON "roadmaps" ("owner_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmaps_visibility" ON "roadmaps" ("visibility") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmaps_directory" ON "roadmaps" ("directory_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmaps_forked_from" ON "roadmaps" ("forked_from_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmaps_search" ON "roadmaps" USING gin (to_tsvector('simple', "title" || ' ' || "description"))`,
    );

    await queryRunner.query(`
      CREATE TABLE "node_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "roadmap_id" uuid NOT NULL,
        "node_id" varchar(120) NOT NULL,
        "is_completed" boolean NOT NULL DEFAULT false,
        "note" text,
        "link" varchar(500),
        "completed_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_node_progress_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_node_progress_node" UNIQUE ("user_id", "roadmap_id", "node_id"),
        CONSTRAINT "FK_node_progress_roadmap" FOREIGN KEY ("roadmap_id")
          REFERENCES "roadmaps" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_node_progress_user" ON "node_progress" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_node_progress_roadmap" ON "node_progress" ("roadmap_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "roadmap_reactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "roadmap_id" uuid NOT NULL,
        "type" "roadmap_reactions_type_enum" NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roadmap_reactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roadmap_reactions_user_type" UNIQUE ("user_id", "roadmap_id", "type"),
        CONSTRAINT "FK_roadmap_reactions_roadmap" FOREIGN KEY ("roadmap_id")
          REFERENCES "roadmaps" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmap_reactions_user" ON "roadmap_reactions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmap_reactions_roadmap" ON "roadmap_reactions" ("roadmap_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "roadmap_reactions"`);
    await queryRunner.query(`DROP TABLE "node_progress"`);
    await queryRunner.query(`DROP TABLE "roadmaps"`);
    await queryRunner.query(`DROP TABLE "roadmap_directories"`);
    await queryRunner.query(`DROP TYPE "roadmap_reactions_type_enum"`);
    await queryRunner.query(`DROP TYPE "roadmaps_visibility_enum"`);
  }
}
