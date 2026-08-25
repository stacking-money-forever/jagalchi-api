import { AppDataSource } from './data-source';

async function runMigrations(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await AppDataSource.runMigrations({ transaction: 'all' });
  } finally {
    await AppDataSource.destroy();
  }
}

void runMigrations();
