import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { WorkflowOperationWorker } from './workflow-operations/workflow-operation.worker';
import { ConfigService } from '@nestjs/config';
import { workflowTiming } from './workflow-operations/workflow-timing';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  const worker = app.get(WorkflowOperationWorker);
  const config = app.get(ConfigService);
  const workerId = `${process.env.HOSTNAME ?? 'worker'}:${process.pid}:${randomUUID()}`;
  const { pollMs } = workflowTiming(config);
  let stopping = false;
  const stop = () => {
    stopping = true;
    void worker.stop();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  while (!stopping) {
    const handled = await worker.runOnce(workerId);
    if (!handled) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await worker.stop();
  await app.close();
}

void bootstrap().catch((error: unknown) => {
  console.error('Workflow worker failed.', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
