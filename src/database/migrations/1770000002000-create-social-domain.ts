import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocialDomain1770000002000 implements MigrationInterface {
  name = 'CreateSocialDomain1770000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "notifications_type_enum" AS ENUM (
        'COMMENT',
        'REPLY',
        'FOLLOW',
        'FORK',
        'LIKE',
        'AI_COMPLETE',
        'LEARNING_REMINDER',
        'SYSTEM'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "comments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "roadmap_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "parent_id" uuid,
        "content" text NOT NULL,
        "is_deleted" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_comments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_comments_roadmap" FOREIGN KEY ("roadmap_id")
          REFERENCES "roadmaps" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_comments_parent" FOREIGN KEY ("parent_id")
          REFERENCES "comments" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_comments_roadmap" ON "comments" ("roadmap_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_comments_author" ON "comments" ("author_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_comments_parent" ON "comments" ("parent_id")`);

    await queryRunner.query(`
      CREATE TABLE "follows" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "follower_id" uuid NOT NULL,
        "followee_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_follows_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_follows_pair" UNIQUE ("follower_id", "followee_id"),
        CONSTRAINT "CHK_follows_not_self" CHECK ("follower_id" <> "followee_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_follows_follower" ON "follows" ("follower_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_follows_followee" ON "follows" ("followee_id")`);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "recipient_id" uuid NOT NULL,
        "actor_id" uuid,
        "type" "notifications_type_enum" NOT NULL,
        "resource_type" varchar(40),
        "resource_id" uuid,
        "title" varchar(160) NOT NULL,
        "body" varchar(500) NOT NULL,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipient_created" ON "notifications" ("recipient_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_unread" ON "notifications" ("recipient_id") WHERE "read_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "user_id" uuid NOT NULL,
        "comments" boolean NOT NULL DEFAULT true,
        "replies" boolean NOT NULL DEFAULT true,
        "follows" boolean NOT NULL DEFAULT true,
        "forks" boolean NOT NULL DEFAULT true,
        "likes" boolean NOT NULL DEFAULT true,
        "ai_complete" boolean NOT NULL DEFAULT true,
        "learning_reminders" boolean NOT NULL DEFAULT true,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_preferences_user" PRIMARY KEY ("user_id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TABLE "follows"`);
    await queryRunner.query(`DROP TABLE "comments"`);
    await queryRunner.query(`DROP TYPE "notifications_type_enum"`);
  }
}
