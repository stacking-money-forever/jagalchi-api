import { describe, expect, it, vi } from 'vitest';

import { RealtimeGateway, resolveRealtimeClientIp } from './realtime.gateway';

const roadmapId = '11111111-1111-4111-8111-111111111111';

function createClient() {
  const emit = vi.fn();
  const client = {
    data: {
      userId: '22222222-2222-4222-8222-222222222222',
      joinedRoadmaps: new Set([roadmapId]),
      lastCursorAt: 0,
    },
    to: vi.fn(() => ({ emit })),
  };
  return { client, emit };
}

describe('RealtimeGateway room broadcasts', () => {
  it('includes roadmap identity in edit events so clients can isolate rooms', async () => {
    const realtime = {
      append: vi.fn(async () => ({
        ok: true,
        duplicate: false,
        eventId: 'event-1',
        sequence: 7,
      })),
    };
    const gateway = new RealtimeGateway({} as never, realtime as never);
    const { client, emit } = createClient();

    await gateway.edit(
      client as never,
      {
        roadmapId,
        idempotencyKey: 'edit-request-1',
        baseSequence: 6,
        operation: {
          type: 'NODE_UPDATE',
          targetId: 'node-1',
          value: { position: { x: 10, y: 20 } },
        },
      },
      vi.fn(),
    );

    expect(emit).toHaveBeenCalledWith(
      'roadmap:event',
      expect.objectContaining({
        roadmapId,
        actorId: client.data.userId,
        sequence: 7,
      }),
    );
  });

  it('includes roadmap identity in cursor and hide events', () => {
    const gateway = new RealtimeGateway({} as never, {} as never);
    const { client, emit } = createClient();

    gateway.cursor(client as never, { roadmapId, x: 10, y: 20 });
    gateway.hideCursor(client as never, { roadmapId });

    expect(emit).toHaveBeenNthCalledWith(1, 'roadmap:cursor', {
      roadmapId,
      actorId: client.data.userId,
      x: 10,
      y: 20,
    });
    expect(emit).toHaveBeenNthCalledWith(2, 'roadmap:cursor-hide', {
      roadmapId,
      actorId: client.data.userId,
    });
  });
});


describe('resolveRealtimeClientIp', () => {
  it('uses only the socket peer in conservative baseline mode', () => {
    expect(resolveRealtimeClientIp('10.0.0.2', '198.51.100.1', 0)).toBe('10.0.0.2');
  });

  it('uses the exact proven hop count and rejects missing hops', () => {
    expect(resolveRealtimeClientIp('10.0.0.2', '198.51.100.1', 1)).toBe('198.51.100.1');
    expect(resolveRealtimeClientIp('10.0.0.2', undefined, 1)).toBeNull();
  });
});
