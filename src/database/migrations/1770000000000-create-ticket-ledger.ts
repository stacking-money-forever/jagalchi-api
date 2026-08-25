import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTicketLedger1770000000000 implements MigrationInterface {
  name = 'CreateTicketLedger1770000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "ticket_ledger_kind_enum" AS ENUM (
        'SIGNUP_GRANT',
        'MONTHLY_GRANT',
        'PURCHASE',
        'AI_USAGE'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "ticket_ledger_status_enum" AS ENUM (
        'RESERVED',
        'COMMITTED',
        'REFUNDED'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "ticket_accounts" (
        "user_id" uuid NOT NULL,
        "balance" integer NOT NULL DEFAULT 0,
        "last_monthly_grant_at" timestamptz NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ticket_accounts_user_id" PRIMARY KEY ("user_id"),
        CONSTRAINT "CHK_ticket_accounts_balance" CHECK ("balance" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "ticket_ledger" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "amount" integer NOT NULL,
        "kind" "ticket_ledger_kind_enum" NOT NULL,
        "status" "ticket_ledger_status_enum" NOT NULL,
        "feature" varchar(64),
        "idempotency_key" varchar(120) NOT NULL,
        "description" varchar(240) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ticket_ledger_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ticket_ledger_idempotency" UNIQUE ("user_id", "idempotency_key"),
        CONSTRAINT "FK_ticket_ledger_account" FOREIGN KEY ("user_id")
          REFERENCES "ticket_accounts" ("user_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_ticket_ledger_user_id" ON "ticket_ledger" ("user_id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_ticket_ledger_user_id"');
    await queryRunner.query('DROP TABLE "ticket_ledger"');
    await queryRunner.query('DROP TABLE "ticket_accounts"');
    await queryRunner.query('DROP TYPE "ticket_ledger_status_enum"');
    await queryRunner.query('DROP TYPE "ticket_ledger_kind_enum"');
  }
}
