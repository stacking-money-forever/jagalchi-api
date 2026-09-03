import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProjectRunsController } from './project-runs.controller';

describe('ProjectRunsController', () => {
  it('passes authenticated ownership to the canonical projection query', async () => {
    const projection = { id: 'run-1', state: 'READY', version: 1 };
    const runs = { get: vi.fn().mockResolvedValue(projection) };
    const controller = new ProjectRunsController(runs as never);
    await expect(controller.getProjectRun({ id: 'owner-1', email: 'o@example.test', roles: ['USER'] }, 'run-1')).resolves.toBe(projection);
    expect(runs.get).toHaveBeenCalledWith('owner-1', 'run-1');
  });

  it('accepts only strict decimal If-Match and UUID idempotency headers', async () => {
    const runs = { taskCommand: vi.fn().mockResolvedValue({ version: 2 }) };
    const controller = new ProjectRunsController(runs as never);
    await expect(controller.start(
      { id: 'owner-1', roles: [] }, '00000000-0000-4000-8000-000000000001', 'task-1', '1',
      '00000000-0000-4000-8000-000000000099',
    )).resolves.toEqual({ version: 2 });
    expect(() => controller.start(
      { id: 'owner-1', roles: [] }, 'run-1', 'task-1', '"1"', '00000000-0000-4000-8000-000000000099',
    )).toThrow(BadRequestException);
  });
});
