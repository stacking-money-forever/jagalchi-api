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
  it('forwards only the user question to the active-task AI help service', async () => {
    const response = { guidance: 'Use the cited requirement before editing.' };
    const runs = { aiHelp: vi.fn().mockResolvedValue(response) };
    const controller = new ProjectRunsController(runs as never);
    const runId = '00000000-0000-4000-8000-000000000001';
    await expect(controller.aiHelp(
      { id: 'owner-1', roles: [] },
      runId,
      'task-1',
      { question: 'How should I start?', citations: ['client-citation'], gaps: ['client-gap'] } as never,
    )).resolves.toBe(response);
    expect(runs.aiHelp).toHaveBeenCalledWith('owner-1', runId, 'task-1', 'How should I start?');
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
