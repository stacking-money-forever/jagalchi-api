import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { RoadmapOperation } from './realtime.types';

@Entity({ name: 'roadmap_sequences' })
export class RoadmapSequence {
  @PrimaryColumn('uuid', { name: 'roadmap_id' })
  roadmapId: string;

  @Column({ name: 'current_sequence', type: 'bigint', default: 0 })
  currentSequence: string;
}

@Entity({ name: 'roadmap_events' })
@Unique(['roadmapId', 'sequence'])
@Unique(['roadmapId', 'idempotencyKey'])
export class RoadmapEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'roadmap_id' })
  @Index()
  roadmapId: string;

  @Column('uuid', { name: 'actor_id' })
  @Index()
  actorId: string;

  @Column({ type: 'bigint' })
  sequence: string;

  @Column({ name: 'base_sequence', type: 'bigint' })
  baseSequence: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ type: 'jsonb' })
  operation: RoadmapOperation;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
