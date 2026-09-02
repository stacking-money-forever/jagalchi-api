import { AppDataSource } from './data-source';

export async function checkMigrations(): Promise<boolean> {
  try {
    await AppDataSource.initialize();
    return await AppDataSource.showMigrations();
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

if (require.main === module) {
  void checkMigrations()
    .then((pending) => {
      console.log(pending ? 'pending migrations detected' : 'no pending migrations');
    })
    .catch((error: unknown) => {
      console.error('Migration check failed.', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
