import { NestFactory } from '@nestjs/core';
import { DevSeedService, validateDevSeedEnvironment } from './dev-seed.service';

export async function runDevSeed(): Promise<void> {
  if (!process.argv.includes('--json')) throw new Error('dev:seed requires --json');
  validateDevSeedEnvironment((key) => process.env[key]);
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const result = await app.get(DevSeedService).seed();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runDevSeed().catch((error: unknown) => {
    void error;
    process.stderr.write('dev:seed failed\n');
    process.exitCode = 1;
  });
}
