import { describe, expect, it } from 'vitest';
import { parseEditRequest } from './realtime.types';

const roadmapId = '11111111-1111-4111-8111-111111111111';

describe('parseEditRequest', () => {
  it('accepts a bounded, versioned graph operation', () => {
    expect(
      parseEditRequest({
        roadmapId,
        idempotencyKey: 'edit-request-1',
        baseSequence: 12,
        operation: {
          type: 'NODE_UPDATE',
          targetId: 'node-1',
          value: { position: { x: 10, y: 20 } },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        roadmapId,
        baseSequence: 12,
      }),
    );
  });

  it('rejects unknown operations and identity fields from clients', () => {
    expect(
      parseEditRequest({
        roadmapId,
        actorId: 'attacker',
        idempotencyKey: 'edit-request-1',
        baseSequence: 0,
        operation: { type: 'ADMIN_OVERRIDE', targetId: 'node-1' },
      }),
    ).toBeNull();
  });

  it('rejects unsafe sequence values and oversized payloads', () => {
    expect(
      parseEditRequest({
        roadmapId,
        idempotencyKey: 'edit-request-1',
        baseSequence: Number.MAX_VALUE,
        operation: {
          type: 'TEXT_UPDATE',
          targetId: 'text-1',
          value: { text: 'x'.repeat(65_000) },
        },
      }),
    ).toBeNull();
  });
});
