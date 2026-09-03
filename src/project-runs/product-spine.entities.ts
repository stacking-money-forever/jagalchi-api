import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { ProjectTaskState } from './project-run.entity';

export enum SnapshotState { Draft = 'DRAFT', Confirmed = 'CONFIRMED' }
export enum RepositoryMode { ExistingOwned = 'EXISTING_OWNED', OpenSourceContribution = 'OPEN_SOURCE_CONTRIBUTION', ManualGreenfield = 'MANUAL_GREENFIELD' }
export enum ProjectFeature { ProjectRuns = 'PROJECT_RUNS' }
export enum ProofPublicationStatus { Published = 'PUBLISHED', Unpublished = 'UNPUBLISHED' }
export enum ProofValidity { Active = 'ACTIVE', Invalidated = 'INVALIDATED', Superseded = 'SUPERSEDED' }
export enum VerificationLevel { MachineVerified = 'MACHINE_VERIFIED', IndependentlyReviewed = 'INDEPENDENTLY_REVIEWED' }

abstract class ImmutableSnapshot {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'owner_id' }) @Index() ownerId: string;
  @Column({ type: 'integer', name: 'schema_version', default: 1 }) schemaVersion: number;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'candidate_profile_snapshots' })
export class CandidateProfileSnapshot extends ImmutableSnapshot {
  @Column({ type: 'enum', enum: SnapshotState }) state: SnapshotState;
  @Column('uuid', { name: 'source_snapshot_id', nullable: true }) sourceSnapshotId: string | null;
}

@Entity({ name: 'career_target_versions' })
@Unique('UQ_career_target_version', ['careerTargetId', 'version'])
@Unique('UQ_career_target_source_hash', ['ownerId', 'sourceHash'])
export class CareerTargetVersion extends ImmutableSnapshot {
  @Column('uuid', { name: 'career_target_id' }) careerTargetId: string;
  @Column({ type: 'integer' }) version: number;
  @Column({ name: 'source_hash', type: 'char', length: 64 }) sourceHash: string;
  @Column({ name: 'capture_status', type: 'varchar', length: 40 }) captureStatus: 'AUTOMATIC' | 'DEGRADED_MANUAL_CAPTURE';
}

@Entity({ name: 'career_diff_snapshots' })
export class CareerDiffSnapshot extends ImmutableSnapshot {
  @Column('uuid', { name: 'career_target_id' }) careerTargetId: string;
  @Column('uuid', { name: 'career_target_version_id' }) careerTargetVersionId: string;
  @Column('uuid', { name: 'candidate_profile_snapshot_id' }) candidateProfileSnapshotId: string;
  @Column({ type: 'enum', enum: SnapshotState }) state: SnapshotState;
  @Column('uuid', { name: 'source_snapshot_id', nullable: true }) sourceSnapshotId: string | null;
}

@Entity({ name: 'project_blueprint_versions' })
@Unique('UQ_project_blueprint_key_version', ['blueprintKey', 'version'])
export class ProjectBlueprintVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'blueprint_key', type: 'varchar', length: 100 }) blueprintKey: string;
  @Column({ type: 'integer' }) version: number;
  @Column({ name: 'catalog_version', type: 'varchar', length: 80 }) catalogVersion: string;
  @Column({ type: 'jsonb' }) definition: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'project_proposal_sets' })
export class ProjectProposalSet extends ImmutableSnapshot {
  @Column('uuid', { name: 'career_diff_snapshot_id' }) careerDiffSnapshotId: string;
}

@Entity({ name: 'project_proposals' })
@Unique('UQ_project_proposal_set_rank', ['proposalSetId', 'rank'])
export class ProjectProposal {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'proposal_set_id' }) @Index() proposalSetId: string;
  @Column('uuid', { name: 'blueprint_version_id' }) blueprintVersionId: string;
  @Column({ type: 'smallint' }) rank: number;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'project_plan_snapshots' })
export class ProjectPlanSnapshot extends ImmutableSnapshot {
  @Column('uuid', { name: 'project_proposal_id' }) projectProposalId: string;
  @Column('uuid', { name: 'career_diff_snapshot_id' }) careerDiffSnapshotId: string;
  @Column('uuid', { name: 'candidate_profile_snapshot_id' }) candidateProfileSnapshotId: string;
  @Column('uuid', { name: 'blueprint_version_id' }) blueprintVersionId: string;
  @Column({ name: 'catalog_version', type: 'varchar', length: 80 }) catalogVersion: string;
}

@Entity({ name: 'project_tasks' })
@Unique('UQ_project_tasks_run_key', ['projectRunId', 'taskKey'])
export class ProjectTask {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'project_run_id' }) @Index() projectRunId: string;
  @Column({ name: 'task_key', type: 'varchar', length: 128 }) taskKey: string;
  @Column({ type: 'varchar', length: 300 }) title: string;
  @Column({ type: 'varchar', length: 20 }) state: ProjectTaskState;
  @Column({ type: 'boolean' }) required: boolean;
  @Column({ name: 'milestone_id', type: 'varchar', length: 128, nullable: true }) milestoneId: string | null;
  @Column({ name: 'prerequisite_ids', type: 'varchar', array: true, default: () => "'{}'" }) prerequisiteIds: string[];
  @Column({ type: 'text' }) purpose: string;
  @Column({ name: 'acceptance_criteria', type: 'jsonb' }) acceptanceCriteria: string[];
  @Column({ name: 'evidence_requirements', type: 'jsonb' }) evidenceRequirements: string[];
  @Column({ name: 'blocked_from', type: 'varchar', length: 20, nullable: true }) blockedFrom: 'READY' | 'IN_PROGRESS' | null;
  @Column({ name: 'block_reason_code', type: 'varchar', length: 80, nullable: true }) blockReasonCode: string | null;
  @Column({ name: 'block_note', type: 'varchar', length: 1000, nullable: true }) blockNote: string | null;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'project_feature_entitlements' })
export class ProjectFeatureEntitlement {
  @PrimaryColumn('uuid', { name: 'user_id' }) userId: string;
  @PrimaryColumn({ type: 'varchar', length: 40 }) feature: ProjectFeature;
  @Column({ type: 'boolean', default: false }) enabled: boolean;
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true }) expiresAt: Date | null;
  @Column({ type: 'varchar', length: 160 }) reason: string;
  @Column({ name: 'updated_by', type: 'varchar', length: 160 }) updatedBy: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'project_repository_bindings' })
export class ProjectRepositoryBinding {
  @PrimaryColumn('uuid', { name: 'project_run_id' }) projectRunId: string;
  @Column({ type: 'varchar', length: 40 }) mode: RepositoryMode;
  @Column('uuid', { name: 'installation_id', nullable: true }) installationId: string | null;
  @Column({ name: 'github_repository_id', type: 'bigint', nullable: true }) githubRepositoryId: string | null;
  @Column({ name: 'repository_name', type: 'varchar', length: 255, nullable: true }) repositoryName: string | null;
  @Column({ name: 'repository_private', type: 'boolean', nullable: true }) repositoryPrivate: boolean | null;
  @Column({ name: 'binding_version', type: 'integer', default: 1 }) bindingVersion: number;
  @Column({ name: 'pull_number', type: 'integer', nullable: true }) pullNumber: number | null;
  @Column({ name: 'expected_head_sha', type: 'char', length: 40, nullable: true }) expectedHeadSha: string | null;
  @CreateDateColumn({ name: 'bound_at', type: 'timestamptz' }) boundAt: Date;
}

@Entity({ name: 'proof_snapshots' })
export class ProofSnapshot extends ImmutableSnapshot {
  @Column('uuid', { name: 'project_run_id' }) @Index() projectRunId: string;
  @Column('uuid', { name: 'proof_mission_id' }) proofMissionId: string;
  @Column({ name: 'verification_level', type: 'varchar', length: 40 }) verificationLevel: VerificationLevel;
  @Column({ name: 'verified_at', type: 'timestamptz' }) verifiedAt: Date;
  @Column({ name: 'invalidation_generation', type: 'integer', default: 0 }) invalidationGeneration: number;
}

@Entity({ name: 'provider_invalidation_events' })
export class ProviderInvalidationEvent {
  @PrimaryColumn({ type: 'varchar', length: 20 }) provider: string;
  @PrimaryColumn({ name: 'provider_event_id', type: 'varchar', length: 160 }) providerEventId: string;
  @Column({ name: 'repository_id', type: 'varchar', length: 100 }) repositoryId: string;
  @Column({ name: 'pull_number', type: 'integer', nullable: true }) pullNumber: number | null;
  @Column({ name: 'head_sha', type: 'char', length: 40, nullable: true }) headSha: string | null;
  @Column({ type: 'varchar', length: 50 }) kind: string;
  @Column({ name: 'observed_at', type: 'timestamptz' }) observedAt: Date;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'repository_invalidation_watermarks' })
export class RepositoryInvalidationWatermark {
  @PrimaryColumn({ type: 'varchar', length: 20 }) provider: string;
  @PrimaryColumn({ name: 'repository_id', type: 'varchar', length: 100 }) repositoryId: string;
  @Column({ type: 'integer', default: 0 }) generation: number;
  @Column({ name: 'last_event_id', type: 'varchar', length: 160 }) lastEventId: string;
  @Column({ name: 'observed_at', type: 'timestamptz' }) observedAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'proof_publications' })
export class ProofPublication {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'project_run_id' }) @Index() projectRunId: string;
  @Column('uuid', { name: 'proof_snapshot_id' }) proofSnapshotId: string;
  @Column({ name: 'publication_status', type: 'varchar', length: 20 }) publicationStatus: ProofPublicationStatus;
  @Column({ type: 'varchar', length: 20 }) validity: ProofValidity;
  @Column({ type: 'integer', default: 1 }) version: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'project_run_commands' })
@Unique('UQ_project_run_commands_idempotency', ['ownerId', 'route', 'idempotencyKey'])
export class ProjectRunCommand {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'owner_id' }) ownerId: string;
  @Column({ type: 'varchar', length: 200 }) route: string;
  @Column('uuid', { name: 'idempotency_key' }) idempotencyKey: string;
  @Column({ name: 'input_hash', type: 'char', length: 64 }) inputHash: string;
  @Column({ type: 'jsonb' }) response: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
