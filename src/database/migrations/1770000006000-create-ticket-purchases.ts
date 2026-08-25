import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTicketPurchases1770000006000 implements MigrationInterface {
  name = 'CreateTicketPurchases1770000006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "ticket_purchase_store_enum" AS ENUM ('APPLE', 'GOOGLE')`);
    await queryRunner.query(`CREATE TYPE "ticket_purchase_status_enum" AS ENUM ('FULFILLED')`);
    await queryRunner.query(`
      CREATE TABLE "ticket_purchases" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "store" "ticket_purchase_store_enum" NOT NULL,
        "provider_transaction_id" varchar(512) NOT NULL,
        "provider_token_hash" char(64) NOT NULL,
        "product_id" varchar(191) NOT NULL,
        "pack_id" varchar(40) NOT NULL,
        "tickets" integer NOT NULL,
        "environment" varchar(32) NOT NULL,
        "status" "ticket_purchase_status_enum" NOT NULL,
        "ledger_id" uuid NOT NULL,
        "purchased_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ticket_purchases_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ticket_purchases_provider" UNIQUE ("store", "provider_transaction_id"),
        CONSTRAINT "UQ_ticket_purchases_ledger" UNIQUE ("ledger_id"),
        CONSTRAINT "CHK_ticket_purchases_tickets" CHECK ("tickets" > 0),
        CONSTRAINT "FK_ticket_purchases_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ticket_purchases_ledger" FOREIGN KEY ("ledger_id")
          REFERENCES "ticket_ledger" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_ticket_purchases_user" ON "ticket_purchases" ("user_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ticket_purchases"`);
    await queryRunner.query(`DROP TYPE "ticket_purchase_status_enum"`);
    await queryRunner.query(`DROP TYPE "ticket_purchase_store_enum"`);
  }
}
