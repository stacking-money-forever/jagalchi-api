import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowOperationController, WorkflowOperationPublicController } from './workflow-operation.controller';

describe('WorkflowOperationController', () => {
  const user = { id: 'owner-1', email: 'owner@example.test', roles: ['USER'] };

  it('creates a replayable public v1 operation with the canonical route and kind', async () => {
    const operations = { createOrReplay: vi.fn().mockResolvedValue({ operation: { id: 'op-1' }, replayed: false }) };
    const controller = new WorkflowOperationController(operations as never, { get: () => 'true' } as never, { exists: vi.fn().mockResolvedValue(true) } as never);
    await controller.jobPostingExtract(user, { idempotencyKey: 'request-1', input: { text: 'posting' } });
    expect(operations.createOrReplay).toHaveBeenCalledWith({
      ownerId: 'owner-1', route: '/api/v1/operations/job-posting-extract', idempotencyKey: 'request-1',
      kind: 'JOB_POSTING_EXTRACT', input: { text: 'posting' },
    });
  });

  it('requires strict version and idempotency headers for canonical cancellation', async () => {
    const operations = { requestCancelVersioned: vi.fn().mockResolvedValue({ state: 'CANCELLED', version: 2 }) };
    const controller = new WorkflowOperationPublicController(operations as never);
    await expect(controller.cancel(user, '00000000-0000-4000-8000-000000000001', '1', '00000000-0000-4000-8000-000000000099')).resolves.toMatchObject({ state: 'CANCELLED' });
    expect(() => controller.cancel(user, 'run', '"1"', '00000000-0000-4000-8000-000000000099')).toThrow(BadRequestException);
  });

  it('fails closed before persistence while Project Runs are disabled', async () => {
    const operations = { createOrReplay: vi.fn() };
    const controller = new WorkflowOperationController(operations as never, { get: () => 'false' } as never, {} as never);
    await expect(controller.projectProposals(user, { idempotencyKey: 'request-1', input: {} })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(operations.createOrReplay).not.toHaveBeenCalled();
  });
});
