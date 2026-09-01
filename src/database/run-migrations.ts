import { MigrationExecutor } from 'typeorm';
import type { DataSource, QueryRunner } from 'typeorm';
import { AppDataSource } from './data-source';

/**
 * The two integer keys spell "JAGA" and "LCHI" in ASCII. Keeping the key in
 * the application rather than deriving it from a secret makes every API
 * migration invocation share one stable PostgreSQL advisory lock.
 */
export const MIGRATION_LOCK_KEYS = [0x4a414741, 0x4c434849] as const;
const ACQUIRE_MIGRATION_LOCK = 'SELECT pg_advisory_lock($1, $2)';
const RELEASE_MIGRATION_LOCK = 'SELECT pg_advisory_unlock($1, $2)';

export type MigrationExecutorLike = Pick<
  MigrationExecutor,
  'executePendingMigrations'
> & {
  transaction: MigrationExecutor['transaction'];
};

export type MigrationExecutorFactory = (
  dataSource: DataSource,
  queryRunner: QueryRunner,
) => MigrationExecutorLike;

const createMigrationExecutor: MigrationExecutorFactory = (dataSource, queryRunner) =>
  new MigrationExecutor(dataSource, queryRunner);

/**
 * Run migrations while holding a session-level PostgreSQL advisory lock.
 *
 * The lock and TypeORM's MigrationExecutor deliberately use the same
 * QueryRunner. A transaction-level lock would not protect the entire
 * executor lifecycle, while a second runner could race on the migrations
 * table during a deploy.
 */
export async function runMigrationsWithLock(
  dataSource: DataSource,
  executorFactory: MigrationExecutorFactory = createMigrationExecutor,
): Promise<void> {
  let queryRunner: QueryRunner | undefined;
  let lockAcquired = false;
  let dataSourceInitialized = false;

  try {
    await dataSource.initialize();
    dataSourceInitialized = true;

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(ACQUIRE_MIGRATION_LOCK, [...MIGRATION_LOCK_KEYS]);
    lockAcquired = true;

    const migrationExecutor = executorFactory(dataSource, queryRunner);
    migrationExecutor.transaction = 'all';
    await migrationExecutor.executePendingMigrations();
  } finally {
    try {
      if (queryRunner) {
        try {
          if (lockAcquired) {
            await queryRunner.query(RELEASE_MIGRATION_LOCK, [...MIGRATION_LOCK_KEYS]);
          }
        } finally {
          await queryRunner.release();
        }
      }
    } finally {
      if (dataSourceInitialized || dataSource.isInitialized) {
        await dataSource.destroy();
      }
    }
  }
}

export async function runMigrations(): Promise<void> {
  await runMigrationsWithLock(AppDataSource);
}

if (require.main === module) {
  void runMigrations().catch((error: unknown) => {
    console.error('Database migrations failed.', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
