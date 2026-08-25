import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { RoadmapsService } from '../roadmaps/roadmaps.service';
import {
  Roadmap,
  type RoadmapGraphEdge,
  type RoadmapGraphNode,
} from '../roadmaps/entities/roadmap.entities';
import { RoadmapEvent, RoadmapSequence } from './roadmap-event.entity';
import type { EditAck, EditRequest } from './realtime.types';

export class SequenceConflictError extends Error {
  constructor(readonly currentSequence: number) {
    super('Roadmap sequence is out of date');
  }
}

@Injectable()
export class RealtimeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly roadmaps: RoadmapsService,
    @InjectRepository(RoadmapEvent)
    private readonly events: Repository<RoadmapEvent>,
    @InjectRepository(RoadmapSequence)
    private readonly sequences: Repository<RoadmapSequence>,
  ) {}

  async assertCanEdit(actorId: string, roadmapId: string): Promise<void> {
    await this.roadmaps.getOwned(actorId, roadmapId);
  }

  async currentSequence(actorId: string, roadmapId: string): Promise<number> {
    await this.assertCanEdit(actorId, roadmapId);
    const sequence = await this.sequences.findOne({ where: { roadmapId } });
    return sequence ? Number(sequence.currentSequence) : 0;
  }

  async append(actorId: string, request: EditRequest): Promise<EditAck> {
    await this.assertCanEdit(actorId, request.roadmapId);
    return this.dataSource.transaction(async (manager) => {
      const events = manager.getRepository(RoadmapEvent);
      const duplicate = await events.findOne({
        where: {
          roadmapId: request.roadmapId,
          idempotencyKey: request.idempotencyKey,
        },
      });
      if (duplicate) {
        return {
          ok: true,
          duplicate: true,
          sequence: Number(duplicate.sequence),
          eventId: duplicate.id,
        };
      }

      await manager.query(
        `INSERT INTO "roadmap_sequences" ("roadmap_id", "current_sequence")
         VALUES ($1, 0) ON CONFLICT ("roadmap_id") DO NOTHING`,
        [request.roadmapId],
      );
      const sequences = manager.getRepository(RoadmapSequence);
      const sequence = await sequences.findOne({
        where: { roadmapId: request.roadmapId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!sequence) throw new Error('Roadmap sequence could not be initialized');
      const current = Number(sequence.currentSequence);
      if (current !== request.baseSequence) throw new SequenceConflictError(current);

      const roadmap = await manager.getRepository(Roadmap).findOne({
        where: { id: request.roadmapId, ownerId: actorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!roadmap) throw new Error('Roadmap is not editable');
      this.applyOperation(roadmap, request.operation);

      const next = current + 1;
      const event = await events.save(
        events.create({
          roadmapId: request.roadmapId,
          actorId,
          sequence: String(next),
          baseSequence: String(current),
          idempotencyKey: request.idempotencyKey,
          operation: request.operation,
        }),
      );
      sequence.currentSequence = String(next);
      await sequences.save(sequence);
      await manager.getRepository(Roadmap).save(roadmap);
      return { ok: true, duplicate: false, sequence: next, eventId: event.id };
    });
  }

  async readSince(
    actorId: string,
    roadmapId: string,
    afterSequence: number,
    limit: number,
  ): Promise<{ events: RoadmapEvent[]; currentSequence: number }> {
    await this.assertCanEdit(actorId, roadmapId);
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const events = await this.events.find({
      where: { roadmapId, sequence: MoreThan(String(afterSequence)) },
      order: { sequence: 'ASC' },
      take: boundedLimit,
    });
    const last = events.at(-1);
    return {
      events,
      currentSequence: last ? Number(last.sequence) : afterSequence,
    };
  }

  private applyOperation(
    roadmap: Roadmap,
    operation: EditRequest['operation'],
  ): void {
    const separator = operation.type.lastIndexOf('_');
    const targetType = operation.type.slice(0, separator);
    const verb = operation.type.slice(separator + 1);
    const value = operation.value;
    const payload =
      value && typeof value.payload === 'object' && value.payload !== null
        ? (value.payload as Record<string, unknown>)
        : null;
    const data =
      payload?.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : null;
    const next =
      payload?.next && typeof payload.next === 'object'
        ? (payload.next as Record<string, unknown>)
        : null;

    if (typeof data?.title === 'string' && data.title.trim()) {
      roadmap.title = data.title.trim().slice(0, 120);
    }
    if (targetType === 'EDGE') {
      if (verb === 'DELETE') {
        roadmap.graph.edges = roadmap.graph.edges.filter(
          (edge) => edge.id !== operation.targetId,
        );
        return;
      }
      const existingIndex = roadmap.graph.edges.findIndex(
        (edge) => edge.id === operation.targetId,
      );
      if (existingIndex >= 0 && next) {
        const candidate = {
          ...roadmap.graph.edges[existingIndex],
          ...next,
          id: operation.targetId,
        } as unknown as Record<string, unknown>;
        if (
          !this.isGraphEdge(candidate, operation.targetId) ||
          !this.edgeNodesExist(roadmap, candidate)
        ) {
          throw new Error('Invalid edge update');
        }
        roadmap.graph.edges[existingIndex] = candidate as unknown as RoadmapGraphEdge;
      } else if (
        verb === 'CREATE' &&
        next !== null &&
        this.isGraphEdge(next, operation.targetId) &&
        this.edgeNodesExist(roadmap, next)
      ) {
        roadmap.graph.edges.push(next as unknown as RoadmapGraphEdge);
      }
      return;
    }
    if (!['NODE', 'SECTION', 'TEXT', 'GROUP', 'RESOURCE'].includes(targetType)) return;
    if (verb === 'DELETE') {
      roadmap.graph.nodes = roadmap.graph.nodes.filter(
        (node) => node.id !== operation.targetId,
      );
      roadmap.graph.edges = roadmap.graph.edges.filter(
        (edge) =>
          edge.source !== operation.targetId && edge.target !== operation.targetId,
      );
      return;
    }
    const existingIndex = roadmap.graph.nodes.findIndex(
      (node) => node.id === operation.targetId,
    );
    if (existingIndex >= 0 && next) {
      const candidate = {
        ...roadmap.graph.nodes[existingIndex],
        ...next,
        id: operation.targetId,
      } as unknown as Record<string, unknown>;
      if (!this.isGraphNode(candidate, operation.targetId)) {
        throw new Error('Invalid node update');
      }
      roadmap.graph.nodes[existingIndex] = candidate as unknown as RoadmapGraphNode;
    } else if (verb === 'CREATE' && this.isGraphNode(next, operation.targetId)) {
      roadmap.graph.nodes.push(next as unknown as RoadmapGraphNode);
    }
  }

  private isGraphNode(
    value: Record<string, unknown> | null,
    targetId: string,
  ): boolean {
    if (!value) return false;
    const position =
      value.position && typeof value.position === 'object'
        ? (value.position as Record<string, unknown>)
        : null;
    return (
      value.id === targetId &&
      typeof value.type === 'string' &&
      ['jagalchi-node', 'jagalchi-section', 'jagalchi-text', 'detail-node'].includes(
        value.type,
      ) &&
      !!position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      !!value.data &&
      typeof value.data === 'object'
    );
  }

  private isGraphEdge(
    value: Record<string, unknown> | null,
    targetId: string,
  ): boolean {
    return (
      !!value &&
      value.id === targetId &&
      typeof value.source === 'string' &&
      typeof value.target === 'string' &&
      value.source !== value.target
    );
  }

  private edgeNodesExist(
    roadmap: Roadmap,
    value: Record<string, unknown>,
  ): boolean {
    return (
      typeof value.source === 'string' &&
      typeof value.target === 'string' &&
      roadmap.graph.nodes.some((node) => node.id === value.source) &&
      roadmap.graph.nodes.some((node) => node.id === value.target)
    );
  }
}
