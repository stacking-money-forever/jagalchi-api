import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export enum RoadmapVisibility {
  Public = 'PUBLIC',
  Unlisted = 'UNLISTED',
  Private = 'PRIVATE',
}

export interface RoadmapGraphNode {
  id: string;
  type: 'jagalchi-node' | 'jagalchi-section' | 'jagalchi-text' | 'detail-node';
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface RoadmapGraphEdge {
  id: string;
  source: string;
  target: string;
  data?: Record<string, unknown>;
}

export interface RoadmapGraph {
  schemaVersion: 1;
  nodes: RoadmapGraphNode[];
  edges: RoadmapGraphEdge[];
}

@Entity({ name: 'roadmap_directories' })
@Unique(['userId', 'parentId', 'name'])
export class RoadmapDirectory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column('uuid', { name: 'parent_id', nullable: true })
  @Index()
  parentId: string | null;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'roadmaps' })
export class Roadmap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'owner_id' })
  @Index()
  ownerId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ type: 'enum', enum: RoadmapVisibility, default: RoadmapVisibility.Private })
  @Index()
  visibility: RoadmapVisibility;

  @Column({ type: 'jsonb', default: () => `'{"schemaVersion":1,"nodes":[],"edges":[]}'::jsonb` })
  graph: RoadmapGraph;

  @Column('uuid', { name: 'directory_id', nullable: true })
  @Index()
  directoryId: string | null;

  @Column('uuid', { name: 'forked_from_id', nullable: true })
  @Index()
  forkedFromId: string | null;

  @Column({ name: 'fork_count', type: 'integer', default: 0 })
  forkCount: number;

  @Column({ name: 'like_count', type: 'integer', default: 0 })
  likeCount: number;

  @Column({ name: 'favorite_count', type: 'integer', default: 0 })
  favoriteCount: number;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}

@Entity({ name: 'node_progress' })
@Unique(['userId', 'roadmapId', 'nodeId'])
export class NodeProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column('uuid', { name: 'roadmap_id' })
  @Index()
  roadmapId: string;

  @Column({ name: 'node_id', type: 'varchar', length: 120 })
  nodeId: string;

  @Column({ name: 'is_completed', type: 'boolean', default: false })
  isCompleted: boolean;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  link: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

export enum RoadmapReactionType {
  Like = 'LIKE',
  Favorite = 'FAVORITE',
}

@Entity({ name: 'roadmap_reactions' })
@Unique(['userId', 'roadmapId', 'type'])
export class RoadmapReaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column('uuid', { name: 'roadmap_id' })
  @Index()
  roadmapId: string;

  @Column({ type: 'enum', enum: RoadmapReactionType })
  type: RoadmapReactionType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
