import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RoadmapVisibility } from './entities/roadmap.entities';
import { RoadmapsService } from './roadmaps.service';

describe('RoadmapsService', () => {
  const createSubject = () => {
    const roadmaps = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ id: 'roadmap-1', ...value })),
    };
    const service = new RoadmapsService(
      {} as never,
      roadmaps as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { roadmaps, service };
  };

  it('normalizes tags and persists a valid versioned graph', async () => {
    const subject = createSubject();
    await expect(
      subject.service.create('user-1', {
        title: ' 앱 개발 ',
        visibility: RoadmapVisibility.Public,
        tags: [' Expo ', 'expo', 'React Native'],
        graph: {
          schemaVersion: 1,
          nodes: [
            { id: 'a', type: 'jagalchi-node', position: { x: 0, y: 0 }, data: {} },
            { id: 'b', type: 'jagalchi-node', position: { x: 100, y: 0 }, data: {} },
          ],
          edges: [{ id: 'edge-1', source: 'a', target: 'b' }],
        },
      }),
    ).resolves.toMatchObject({
      title: '앱 개발',
      tags: ['expo', 'react native'],
    });
  });

  it('rejects edges that reference a missing node', async () => {
    const subject = createSubject();
    await expect(
      subject.service.create('user-1', {
        title: '잘못된 로드맵',
        visibility: RoadmapVisibility.Private,
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: 'a',
              type: 'jagalchi-node',
              position: { x: 0, y: 0 },
              data: {},
            },
          ],
          edges: [{ id: 'edge-1', source: 'a', target: 'missing' }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subject.roadmaps.save).not.toHaveBeenCalled();
  });
});
