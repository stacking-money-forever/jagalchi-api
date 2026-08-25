import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRealtimeDomain1770000004000 implements MigrationInterface {
  name = 'CreateRealtimeDomain1770000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roadmap_sequences" (
        "roadmap_id" uuid NOT NULL,
        "current_sequence" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_roadmap_sequences_id" PRIMARY KEY ("roadmap_id"),
        CONSTRAINT "FK_roadmap_sequences_roadmap" FOREIGN KEY ("roadmap_id")
          REFERENCES "roadmaps" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "roadmap_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "roadmap_id" uuid NOT NULL,
        "actor_id" uuid NOT NULL,
        "sequence" bigint NOT NULL,
        "base_sequence" bigint NOT NULL,
        "idempotency_key" varchar(128) NOT NULL,
        "operation" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roadmap_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roadmap_events_sequence" UNIQUE ("roadmap_id", "sequence"),
        CONSTRAINT "UQ_roadmap_events_idempotency" UNIQUE ("roadmap_id", "idempotency_key"),
        CONSTRAINT "FK_roadmap_events_roadmap" FOREIGN KEY ("roadmap_id")
          REFERENCES "roadmaps" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_roadmap_events_actor" FOREIGN KEY ("actor_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmap_events_roadmap_sequence" ON "roadmap_events" ("roadmap_id", "sequence")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roadmap_events_actor" ON "roadmap_events" ("actor_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "roadmap_events"`);
    await queryRunner.query(`DROP TABLE "roadmap_sequences"`);
  }
}
