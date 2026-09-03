import { AppDataSource } from '../database/data-source';

export async function checkWorkerDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    await AppDataSource.query('SELECT 1');
    if (process.env.PROJECT_RUNS_ENABLED === 'true') {
      const heartbeatMs = Number(process.env.WORKFLOW_HEARTBEAT_MS ?? 30_000);
      const maxAgeMs = Number(
        process.env.WORKFLOW_HEALTH_MAX_AGE_MS ?? Math.max(15_000, heartbeatMs * 3),
      );
      const rows = await AppDataSource.query(
        `SELECT EXISTS (
          SELECT 1 FROM "workflow_worker_heartbeats"
          WHERE "heartbeat_at" > now() - ($1 * interval '1 millisecond')
        ) AS "ready"`,
        [maxAgeMs],
      ) as Array<{ ready: boolean }>;
      if (rows[0]?.ready !== true) throw new Error('Workflow worker heartbeat is stale');
    }
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

export const checkWorkflowHealth = checkWorkerDatabase;

if (require.main === module) {
  void checkWorkerDatabase().catch((error: unknown) => {
    console.error('Worker health check failed.', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
