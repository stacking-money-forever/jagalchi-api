import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive immutable Phase 1 catalog entries. Existing catalog rows are never rewritten. */
export class SeedProjectBlueprintCatalog1770000014000 implements MigrationInterface {
  name = 'SeedProjectBlueprintCatalog1770000014000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "project_blueprint_versions" ("id", "blueprint_key", "version", "catalog_version", "definition")
      VALUES
        ('b1000000-0000-4000-8000-000000000002', 'blueprint-1', 1, 'v1',
          '{"title":"Verified API feature","taskRecipes":["contract","implement","test"],"evidenceRuleTypes":["CHANGED_PATH","NAMED_CHECK"]}'::jsonb),
        ('b1000000-0000-4000-8000-000000000003', 'blueprint-2', 1, 'v1',
          '{"title":"Reliable workflow integration","taskRecipes":["model","integrate","recover"],"evidenceRuleTypes":["CHANGED_PATH","NAMED_CHECK"]}'::jsonb),
        ('b1000000-0000-4000-8000-000000000004', 'blueprint-3', 1, 'v1',
          '{"title":"Evidence-backed product slice","taskRecipes":["scope","deliver","verify"],"evidenceRuleTypes":["CHANGED_PATH","NAMED_CHECK"]}'::jsonb)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "project_blueprint_versions"
      WHERE "id" IN (
        'b1000000-0000-4000-8000-000000000002',
        'b1000000-0000-4000-8000-000000000003',
        'b1000000-0000-4000-8000-000000000004'
      )
    `);
  }
}
