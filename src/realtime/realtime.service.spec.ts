import { describe, expect, it, vi } from 'vitest';
import { RoadmapVisibility, type Roadmap } from '../roadmaps/entities/roadmap.entities';
import type { RoadmapEvent } from './roadmap-event.entity';
import { RealtimeService } from './realtime.service';
import type { RoadmapOperation } from './realtime.types';

describe('RealtimeService graph projection', () => {
  const service = new RealtimeService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const apply = (
    service as unknown as {
      applyOperation(roadmap: Roadmap, operation: RoadmapOperation): void;
    }
  ).applyOperation.bind(service);

  const roadmap = (): Roadmap =>
    ({
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: '22222222-2222-4222-8222-222222222222',
      title: '로드맵',
      description: '',
      tags: [],
      visibility: RoadmapVisibility.Private,
      graph: { schemaVersion: 1, nodes: [], edges: [] },
      directoryId: null,
      forkedFromId: null,
      forkCount: 0,
      likeCount: 0,
      favoriteCount: 0,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as Roadmap;

  it('projects a validated node creation into the durable graph snapshot', () => {
    const target = roadmap();
    apply(target, {
      type: 'NODE_CREATE',
      targetId: 'node-1',
      value: {
        payload: {
          next: {
            id: 'node-1',
            type: 'jagalchi-node',
            position: { x: 0, y: 0 },
            data: { label: 'HTTP' },
          },
        },
      },
    });
    expect(target.graph.nodes).toHaveLength(1);
    expect(target.graph.nodes[0]?.id).toBe('node-1');
  });

  it('removes connected edges when a node is deleted', () => {
    const target = roadmap();
    target.graph.nodes = [
      {
        id: 'node-1',
        type: 'jagalchi-node',
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: 'node-2',
        type: 'jagalchi-node',
        position: { x: 100, y: 0 },
        data: {},
      },
    ];
    target.graph.edges = [{ id: 'edge-1', source: 'node-1', target: 'node-2' }];
    apply(target, { type: 'NODE_DELETE', targetId: 'node-1' });
    expect(target.graph.nodes.map((node) => node.id)).toEqual(['node-2']);
    expect(target.graph.edges).toEqual([]);
  });
});

describe('RealtimeService readSince', () => {
  const roadmapId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  const event = (sequence: number): RoadmapEvent =>
    ({
      id: `event-${sequence}`,
      roadmapId,
      actorId,
      sequence: String(sequence),
      baseSequence: String(sequence - 1),
      idempotencyKey: `key-${sequence}`,
      operation: { type: 'NODE_UPDATE', targetId: `node-${sequence}` },
      createdAt: new Date(),
    }) as RoadmapEvent;

  const subject = (events: RoadmapEvent[], currentSequence: number) => {
    const eventRepository = { find: vi.fn().mockResolvedValue(events) };
    const sequenceRepository = {
      findOne: vi.fn().mockResolvedValue({
        roadmapId,
        currentSequence: String(currentSequence),
      }),
    };
    const roadmaps = { getOwned: vi.fn().mockResolvedValue({}) };
    return {
      service: new RealtimeService(
        {} as never,
        roadmaps as never,
        eventRepository as never,
        sequenceRepository as never,
      ),
      eventRepository,
      sequenceRepository,
    };
  };

  it('returns the stored cursor for an empty backlog', async () => {
    const { service } = subject([], 12);

    await expect(service.readSince(actorId, roadmapId, 12, 500)).resolves.toEqual({
      events: [],
      currentSequence: 12,
    });
  });

  it('keeps an exactly-limit page ordered while reporting its authoritative cursor', async () => {
    const page = [event(11), event(12)];
    const { service, eventRepository } = subject(page, 12);

    await expect(service.readSince(actorId, roadmapId, 10, 2)).resolves.toEqual({
      events: page,
      currentSequence: 12,
    });
    expect(eventRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { sequence: 'ASC' },
        take: 2,
      }),
    );
  });

  it('reports a later authoritative cursor when more events remain after the page', async () => {
    const page = [event(11), event(12)];
    const { service, sequenceRepository } = subject(page, 13);

    await expect(service.readSince(actorId, roadmapId, 10, 2)).resolves.toEqual({
      events: page,
      currentSequence: 13,
    });
    expect(sequenceRepository.findOne).toHaveBeenCalledWith({
      where: { roadmapId },
    });
  });
});
