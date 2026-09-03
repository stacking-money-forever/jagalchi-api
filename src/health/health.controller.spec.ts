import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('keeps process liveness independent from the database', () => {
    const dataSource = { query: vi.fn() };
    expect(new HealthController(dataSource as never).getHealth()).toEqual({
      status: 'ok',
      service: 'jagalchi-api',
    });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('requires a recent workflow-worker heartbeat when Project Runs are enabled', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const config = { get: (key: string) => key === 'PROJECT_RUNS_ENABLED' ? 'true' : '15000' };
    const operations = { latestWorkerHeartbeat: vi.fn().mockResolvedValue(new Date()) };
    await expect(new HealthController(dataSource as never, config as never, operations as never).getReadiness())
      .resolves.toEqual({ status: 'ready', service: 'jagalchi-api' });

    operations.latestWorkerHeartbeat.mockResolvedValue(new Date(Date.now() - 20_000));
    await expect(new HealthController(dataSource as never, config as never, operations as never).getReadiness())
      .rejects.toMatchObject({ response: { code: 'WORKFLOW_WORKER_NOT_READY' } });
  });

  it('returns ready only after a bounded database query succeeds', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    await expect(new HealthController(dataSource as never).getReadiness()).resolves.toEqual({
      status: 'ready',
      service: 'jagalchi-api',
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('fails closed without leaking database details', async () => {
    const dataSource = { query: vi.fn().mockRejectedValue(new Error('password=secret host=db')) };
    const readiness = new HealthController(dataSource as never).getReadiness();
    await expect(readiness).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(readiness).rejects.toMatchObject({
      response: { code: 'DATABASE_NOT_READY', message: 'Service is not ready' },
    });
  });
});
