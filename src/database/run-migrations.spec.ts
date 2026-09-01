import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://migration-test.invalid/jagalchi';
});

import {
  MIGRATION_LOCK_KEYS,
  runMigrationsWithLock,
  type MigrationExecutorFactory,
} from './run-migrations';

type QueryRunnerDouble = {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

type DataSourceDouble = {
  initialize: ReturnType<typeof vi.fn>;
  createQueryRunner: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  isInitialized: boolean;
};

const lockSql = 'SELECT pg_advisory_lock($1, $2)';
const unlockSql = 'SELECT pg_advisory_unlock($1, $2)';

function createDataSource(queryRunner: QueryRunnerDouble): DataSourceDouble {
  const dataSource: DataSourceDouble = {
    initialize: vi.fn(async () => {
      dataSource.isInitialized = true;
      return dataSource;
    }),
    createQueryRunner: vi.fn(() => queryRunner),
    destroy: vi.fn(async () => {
      dataSource.isInitialized = false;
    }),
    isInitialized: false,
  };
  return dataSource;
}

function createQueryRunner(
  query: QueryRunnerDouble['query'] = vi.fn(async () => []),
): QueryRunnerDouble {
  return {
    connect: vi.fn(async () => undefined),
    query,
    release: vi.fn(async () => undefined),
  };
}

function createExecutorFactory(
  executePendingMigrations: () => Promise<unknown> = async () => [],
) {
  return vi.fn<MigrationExecutorFactory>(() => ({
    transaction: 'none',
    executePendingMigrations,
  }));
}

describe('runMigrationsWithLock', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('locks and executes migrations on the same connected query runner', async () => {
    const queryRunner = createQueryRunner();
    const dataSource = createDataSource(queryRunner);
    const executePendingMigrations = vi.fn(async () => []);
    const executorFactory = createExecutorFactory(executePendingMigrations);

    await runMigrationsWithLock(dataSource as never, executorFactory);

    expect(queryRunner.connect).toHaveBeenCalledOnce();
    expect(executorFactory).toHaveBeenCalledWith(dataSource, queryRunner);
    expect(executorFactory.mock.results[0]?.value).toMatchObject({ transaction: 'all' });
    expect(executePendingMigrations).toHaveBeenCalledOnce();
    expect(queryRunner.query).toHaveBeenNthCalledWith(1, lockSql, [...MIGRATION_LOCK_KEYS]);
    expect(queryRunner.query).toHaveBeenNthCalledWith(2, unlockSql, [...MIGRATION_LOCK_KEYS]);
    expect(queryRunner.release).toHaveBeenCalledOnce();
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });

  it('always releases the lock, runner, and data source when migrations fail', async () => {
    const queryRunner = createQueryRunner();
    const dataSource = createDataSource(queryRunner);
    const migrationError = new Error('migration failed');
    const executorFactory = createExecutorFactory(async () => {
      throw migrationError;
    });

    await expect(runMigrationsWithLock(dataSource as never, executorFactory)).rejects.toBe(
      migrationError,
    );

    expect(queryRunner.query).toHaveBeenNthCalledWith(1, lockSql, [...MIGRATION_LOCK_KEYS]);
    expect(queryRunner.query).toHaveBeenNthCalledWith(2, unlockSql, [...MIGRATION_LOCK_KEYS]);
    expect(queryRunner.release).toHaveBeenCalledOnce();
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });

  it('does not attempt to unlock or execute migrations when lock acquisition fails', async () => {
    const lockError = new Error('database unavailable');
    const queryRunner = createQueryRunner(
      vi.fn(async () => {
        throw lockError;
      }),
    );
    const dataSource = createDataSource(queryRunner);
    const executorFactory = createExecutorFactory();

    await expect(runMigrationsWithLock(dataSource as never, executorFactory)).rejects.toBe(
      lockError,
    );

    expect(executorFactory).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenCalledOnce();
    expect(queryRunner.query).toHaveBeenCalledWith(lockSql, [...MIGRATION_LOCK_KEYS]);
    expect(queryRunner.release).toHaveBeenCalledOnce();
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });

  it('serializes concurrent migration attempts through the same lock protocol', async () => {
    let lockTail = Promise.resolve();
    const order: string[] = [];

    const createLockedDataSource = (name: string) => {
      let releaseCurrentLock: (() => void) | undefined;
      const queryRunner = createQueryRunner();
      const query = vi.fn(async (sql: string) => {
        if (sql === lockSql) {
          const previousLock = lockTail;
          lockTail = new Promise<void>((resolve) => {
            releaseCurrentLock = resolve;
          });
          await previousLock;
          return [];
        }
        if (sql === unlockSql) {
          releaseCurrentLock?.();
          releaseCurrentLock = undefined;
        }
        return [];
      });
      queryRunner.query = query;
      const dataSource = createDataSource(queryRunner);
      const executorFactory = createExecutorFactory(async () => {
        order.push(`${name}:start`);
        await Promise.resolve();
        order.push(`${name}:end`);
      });
      return { dataSource, executorFactory };
    };

    const first = createLockedDataSource('first');
    const second = createLockedDataSource('second');
    const firstRun = runMigrationsWithLock(first.dataSource as never, first.executorFactory);
    await vi.waitFor(() => expect(order).toEqual(['first:start', 'first:end']));
    const secondRun = runMigrationsWithLock(second.dataSource as never, second.executorFactory);

    await Promise.all([firstRun, secondRun]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});
