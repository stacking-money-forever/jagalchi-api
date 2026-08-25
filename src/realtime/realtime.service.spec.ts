import { describe, expect, it } from 'vitest';
import { RoadmapVisibility, type Roadmap } from '../roadmaps/entities/roadmap.entities';
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
