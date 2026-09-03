import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dataSource = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  isInitialized: true,
  destroy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../database/data-source', () => ({ AppDataSource: dataSource }));

import { checkWorkflowHealth } from './health-check';

describe('workflow health command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROJECT_RUNS_ENABLED = 'true';
    process.env.WORKFLOW_HEALTH_MAX_AGE_MS = '15000';
    dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
  });

  afterEach(() => {
    delete process.env.PROJECT_RUNS_ENABLED;
    delete process.env.WORKFLOW_HEALTH_MAX_AGE_MS;
  });

  it('passes only with a recent persisted worker heartbeat', async () => {
    dataSource.query.mockResolvedValueOnce([{ ready: true }]);
    await expect(checkWorkflowHealth()).resolves.toBeUndefined();
    expect(dataSource.query).toHaveBeenLastCalledWith(expect.stringContaining('workflow_worker_heartbeats'), [15_000]);
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });

  it('fails when the workflow worker heartbeat is absent or stale', async () => {
    dataSource.query.mockResolvedValueOnce([{ ready: false }]);
    await expect(checkWorkflowHealth()).rejects.toThrow('heartbeat is stale');
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });
});
