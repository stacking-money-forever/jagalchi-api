import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CreateTicketLedger1770000000000 } from './1770000000000-create-ticket-ledger';
import { CreateRoadmapDomain1770000001000 } from './1770000001000-create-roadmap-domain';
import { CreateSocialDomain1770000002000 } from './1770000002000-create-social-domain';
import { CreateAuthDomain1770000003000 } from './1770000003000-create-auth-domain';
import { CreateRealtimeDomain1770000004000 } from './1770000004000-create-realtime-domain';
import { CreateUploadsDomain1770000005000 } from './1770000005000-create-uploads-domain';
import { CreateTicketPurchases1770000006000 } from './1770000006000-create-ticket-purchases';

const migrations: MigrationInterface[] = [
  new CreateTicketLedger1770000000000(),
  new CreateRoadmapDomain1770000001000(),
  new CreateSocialDomain1770000002000(),
  new CreateAuthDomain1770000003000(),
  new CreateRealtimeDomain1770000004000(),
  new CreateUploadsDomain1770000005000(),
  new CreateTicketPurchases1770000006000(),
];

describe('PostgreSQL migrations', () => {
  it('applies and rolls back the complete schema in order', async () => {
    const database = new PGlite();
    const queryRunner = {
      query: async (sql: string) => database.exec(sql),
    } as unknown as QueryRunner;

    for (const migration of migrations) await migration.up(queryRunner);
    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'users',
        'roadmaps',
        'comments',
        'notifications',
        'roadmap_events',
        'upload_assets',
      ]),
    );

    for (const migration of [...migrations].reverse()) await migration.down(queryRunner);
    const remaining = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(remaining.rows).toEqual([]);
    await database.close();
  }, 30_000);
});
