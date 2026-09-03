import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ProjectRunState {
  Ready = 'READY', Active = 'ACTIVE', Blocked = 'BLOCKED', Completed = 'COMPLETED', Archived = 'ARCHIVED',
}

export interface ProjectRunProjection {
  id: string;
  state: ProjectRunState;
  version: number;
  target?: { company: string; role: string };
  currentTaskId: string | null;
  recommendedTaskId: string | null;
  plan: { id: string; schemaVersion: number };
  map: {
    nodes: Array<{ id: string; title: string; milestoneId: string | null; state: ProjectTaskState }>;
    edges: Array<{ id: string; source: string; target: string; kind: 'PREREQUISITE' | 'SEQUENCE' }>;
  };
  tasks: Array<{
    id: string; title: string; state: ProjectTaskState; required: boolean; milestoneId: string | null;
    prerequisiteIds: string[]; purpose: string; acceptanceCriteria: string[]; evidenceRequirements: string[];
    verificationFailure?: { code: string; note: string | null } | null;
  }>;
  proof: {
    summary: string; validUntil: string | null;
    publication: { state: 'ACTIVE' | 'UNPUBLISHED' | 'INVALIDATED'; publicId: string | null };
    verification: { state: 'PENDING' | 'PASS' | 'FAIL' | 'STALE'; verifiedAt: string | null };
    facts?: {
      snapshotId: string; verificationLevel: 'MACHINE_VERIFIED' | 'INDEPENDENTLY_REVIEWED'; provider: 'fixture' | 'github';
      repositoryId: string; pullNumber: number; headSha: string; observedAt: string;
      evaluations: Array<{ ruleId: string; type: 'MERGED_PR' | 'BASE_BRANCH' | 'CHANGED_PATH' | 'NAMED_CHECK'; passed: boolean; code: string }>;
    };
  } | null;
}

export type ProjectTaskState = 'LOCKED' | 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DEFERRED' | 'VERIFYING' | 'DONE';

@Entity({ name: 'project_runs' })
export class ProjectRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'source_operation_id', unique: true }) sourceOperationId: string;
  @Column('uuid', { name: 'owner_id' }) @Index() ownerId: string;
  @Column({ type: 'enum', enum: ProjectRunState }) state: ProjectRunState;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ type: 'jsonb' }) projection: ProjectRunProjection;
  @Column({ name: 'current_task_id', type: 'varchar', length: 128, nullable: true }) currentTaskId: string | null;
  @Column('uuid', { name: 'roadmap_id', nullable: true, unique: true }) roadmapId: string | null;
  @Column('uuid', { name: 'proof_mission_id', nullable: true, unique: true }) proofMissionId: string | null;
  @Column('uuid', { name: 'plan_snapshot_id', nullable: true }) planSnapshotId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
