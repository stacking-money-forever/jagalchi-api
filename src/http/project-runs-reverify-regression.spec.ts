import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProjectRunsController } from '../project-runs/project-runs.controller';
import { WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const RUN_ID = '00000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '30000000-0000-4000-8000-000000000099';
const CONCURRENT_KEY = '30000000-0000-4000-8000-000000000098';
const user = { id: OWNER_ID, email: 'seed@example.test', roles: ['USER'] };

describe('Project run reverify HTTP regression', () => {
  it('returns 202 and schedules PROOF_REVERIFICATION after publish on a current snapshot', async () => {
    const runs = {
      publish: vi.fn().mockResolvedValue({
        created: false,
        projection: {
          id: RUN_ID,
          version: 5,
          proof: { publication: { state: 'ACTIVE', publicId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA' } },
        },
      }),
      reverify: vi.fn().mockResolvedValue({
        id: '20000000-0000-4000-8000-000000000001',
        kind: 'PROOF_REVERIFICATION',
        state: WorkflowOperationState.Pending,
        version: 1,
        result: null,
        error: null,
      }),
    };
    const controller = new ProjectRunsController(runs as never);

    await expect(controller.publish(user, RUN_ID, '4', IDEMPOTENCY_KEY, { status: vi.fn() } as never))
      .resolves.toMatchObject({ version: 5, proof: { publication: { state: 'ACTIVE' } } });
    await expect(controller.reverify(user, RUN_ID, '5', IDEMPOTENCY_KEY)).resolves.toMatchObject({
      kind: 'PROOF_REVERIFICATION',
      state: WorkflowOperationState.Pending,
    });
    expect(runs.publish).toHaveBeenCalledWith(OWNER_ID, RUN_ID, 4, IDEMPOTENCY_KEY);
    expect(runs.reverify).toHaveBeenCalledWith(OWNER_ID, RUN_ID, 5, IDEMPOTENCY_KEY);
  });

  it('returns 409 VERIFICATION_IN_PROGRESS for concurrent reverification requests', async () => {
    const runs = {
      reverify: vi.fn().mockRejectedValue(new ConflictException({
        code: 'VERIFICATION_IN_PROGRESS',
        message: 'A verification is already in progress for this Project Run',
      })),
    };
    const controller = new ProjectRunsController(runs as never);
    const caught = await controller.reverify(user, RUN_ID, '6', CONCURRENT_KEY).catch((error) => error);

    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught.getStatus()).toBe(409);
    expect(caught.getResponse()).toMatchObject({ code: 'VERIFICATION_IN_PROGRESS' });
    expect(runs.reverify).toHaveBeenCalledWith(OWNER_ID, RUN_ID, 6, CONCURRENT_KEY);
  });
});
