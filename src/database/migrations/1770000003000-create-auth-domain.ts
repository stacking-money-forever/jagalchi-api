import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthDomain1770000003000 implements MigrationInterface {
  name = 'CreateAuthDomain1770000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "users_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED')`);
    await queryRunner.query(`CREATE TYPE "oauth_provider_enum" AS ENUM ('google', 'github', 'apple')`);
    await queryRunner.query(
      `CREATE TYPE "email_challenge_purpose_enum" AS ENUM ('REGISTRATION', 'PASSWORD_RESET')`,
    );
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(254) NOT NULL,
        "name" varchar(60) NOT NULL,
        "bio" text,
        "profile_image_url" varchar(500),
        "external_links" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "password_hash" varchar(255),
        "roles" varchar[] NOT NULL DEFAULT '{USER}',
        "status" "users_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "oauth_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "provider" "oauth_provider_enum" NOT NULL,
        "provider_user_id" varchar(191) NOT NULL,
        "email" varchar(254) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oauth_identities_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_oauth_identities_provider_user" UNIQUE ("provider", "provider_user_id"),
        CONSTRAINT "FK_oauth_identities_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_oauth_identities_user" ON "oauth_identities" ("user_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "refresh_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" char(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refresh_sessions_token" UNIQUE ("token_hash"),
        CONSTRAINT "FK_refresh_sessions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_refresh_sessions_replacement" FOREIGN KEY ("replaced_by_id")
          REFERENCES "refresh_sessions" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_sessions_user" ON "refresh_sessions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_sessions_expiry" ON "refresh_sessions" ("expires_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE "oauth_attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "state" char(64) NOT NULL,
        "provider" "oauth_provider_enum" NOT NULL,
        "code_verifier" varchar(128) NOT NULL,
        "nonce" varchar(64) NOT NULL,
        "return_url" varchar(500) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oauth_attempts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_oauth_attempts_state" UNIQUE ("state")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "oauth_login_grants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "code_hash" char(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oauth_login_grants_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_oauth_login_grants_code" UNIQUE ("code_hash"),
        CONSTRAINT "FK_oauth_login_grants_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_oauth_login_grants_user" ON "oauth_login_grants" ("user_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "email_verification_challenges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(254) NOT NULL,
        "purpose" "email_challenge_purpose_enum" NOT NULL,
        "code_hash" char(64) NOT NULL,
        "attempts" smallint NOT NULL DEFAULT 0,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "proof_used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_verification_challenges_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_email_verification_attempts" CHECK ("attempts" BETWEEN 0 AND 5)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_email_verification_email_created" ON "email_verification_challenges" ("email", "purpose", "created_at" DESC)`,
    );
    await queryRunner.query(`
      ALTER TABLE "ticket_accounts"
      ADD CONSTRAINT "FK_ticket_accounts_user" FOREIGN KEY ("user_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_directories"
      ADD CONSTRAINT "FK_roadmap_directories_user" FOREIGN KEY ("user_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmaps"
      ADD CONSTRAINT "FK_roadmaps_owner" FOREIGN KEY ("owner_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "node_progress"
      ADD CONSTRAINT "FK_node_progress_user" FOREIGN KEY ("user_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_reactions"
      ADD CONSTRAINT "FK_roadmap_reactions_user" FOREIGN KEY ("user_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "comments"
      ADD CONSTRAINT "FK_comments_author" FOREIGN KEY ("author_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "follows"
      ADD CONSTRAINT "FK_follows_follower" FOREIGN KEY ("follower_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "follows"
      ADD CONSTRAINT "FK_follows_followee" FOREIGN KEY ("followee_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_recipient" FOREIGN KEY ("recipient_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "FK_notifications_actor" FOREIGN KEY ("actor_id")
      REFERENCES "users" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_preferences"
      ADD CONSTRAINT "FK_notification_preferences_user" FOREIGN KEY ("user_id")
      REFERENCES "users" ("id") ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_preferences" DROP CONSTRAINT "FK_notification_preferences_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_notifications_actor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_notifications_recipient"`,
    );
    await queryRunner.query(`ALTER TABLE "follows" DROP CONSTRAINT "FK_follows_followee"`);
    await queryRunner.query(`ALTER TABLE "follows" DROP CONSTRAINT "FK_follows_follower"`);
    await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_comments_author"`);
    await queryRunner.query(
      `ALTER TABLE "roadmap_reactions" DROP CONSTRAINT "FK_roadmap_reactions_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "node_progress" DROP CONSTRAINT "FK_node_progress_user"`,
    );
    await queryRunner.query(`ALTER TABLE "roadmaps" DROP CONSTRAINT "FK_roadmaps_owner"`);
    await queryRunner.query(
      `ALTER TABLE "roadmap_directories" DROP CONSTRAINT "FK_roadmap_directories_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_accounts" DROP CONSTRAINT "FK_ticket_accounts_user"`,
    );
    await queryRunner.query(`DROP TABLE "email_verification_challenges"`);
    await queryRunner.query(`DROP TABLE "oauth_login_grants"`);
    await queryRunner.query(`DROP TABLE "oauth_attempts"`);
    await queryRunner.query(`DROP TABLE "refresh_sessions"`);
    await queryRunner.query(`DROP TABLE "oauth_identities"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "oauth_provider_enum"`);
    await queryRunner.query(`DROP TYPE "email_challenge_purpose_enum"`);
    await queryRunner.query(`DROP TYPE "users_status_enum"`);
  }
}
