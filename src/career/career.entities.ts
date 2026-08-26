import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum CareerTargetStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
}

export enum CareerEvidenceKind {
  GithubPullRequest = 'GITHUB_PULL_REQUEST',
  GithubRepository = 'GITHUB_REPOSITORY',
  Deployment = 'DEPLOYMENT',
  Article = 'ARTICLE',
  Other = 'OTHER',
}

export enum CareerEvidenceStatus {
  Submitted = 'SUBMITTED',
  Verified = 'VERIFIED',
  Rejected = 'REJECTED',
}

export enum ProofMissionState {
  Draft = 'DRAFT',
  Bound = 'BOUND',
  ReviewPending = 'REVIEW_PENDING',
  Approved = 'APPROVED',
  Returned = 'RETURNED',
  Archived = 'ARCHIVED',
}

export enum ProofCriterionType {
  MergedPr = 'MERGED_PR',
  BaseBranch = 'BASE_BRANCH',
  ChangedPath = 'CHANGED_PATH',
  NamedCheck = 'NAMED_CHECK',
  HumanCheck = 'HUMAN_CHECK',
}

export enum ProofVerificationStatus {
  Pass = 'PASS',
  Fail = 'FAIL',
  Error = 'ERROR',
}

export enum ProofReviewDecision {
  Approved = 'APPROVED',
  Returned = 'RETURNED',
}

export enum ProofProfileState {
  Disabled = 'DISABLED',
  Enabled = 'ENABLED',
}

export enum PublishedProofState {
  Active = 'ACTIVE',
  Unpublished = 'UNPUBLISHED',
  Invalidated = 'INVALIDATED',
}

export type ProofCriterionConfig =
  | Record<string, never>
  | { branch: string }
  | { glob: string }
  | { context: string }
  | { label: string };

export interface ProofCriterionResult {
  criterionId: string;
  position: number;
  type: ProofCriterionType;
  passed: boolean;
  detail: string;
}

export interface PublicProofSnapshotV1 {
  schemaVersion: 1;
  publicProofId: string;
  title: string;
  summary: string | null;
  competencyLabel: string;
  provider: 'GITHUB';
  verification: { status: 'VERIFIED'; verifiedAt: string };
  criteria: {
    passedCount: number;
    totalCount: number;
    types: ProofCriterionType[];
  };
}

@Entity({ name: 'career_targets' })
@Unique('uq_career_targets_id_user_id', ['id', 'userId'])
export class CareerTarget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 100 })
  company: string;

  @Column({ type: 'varchar', length: 120 })
  role: string;

  @Column({ name: 'posting_url', type: 'varchar', length: 2_048, nullable: true })
  postingUrl: string | null;

  @Column({ type: 'text' })
  requirements: string;

  @Column({ name: 'competency_slugs', type: 'varchar', array: true })
  competencySlugs: string[];

  @Column({ type: 'enum', enum: CareerTargetStatus, default: CareerTargetStatus.Active })
  @Index()
  status: CareerTargetStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'career_evidence' })
export class CareerEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 2_048 })
  url: string;

  @Column({ type: 'enum', enum: CareerEvidenceKind })
  kind: CareerEvidenceKind;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'competency_slugs', type: 'varchar', array: true })
  competencySlugs: string[];

  @Column({ type: 'enum', enum: CareerEvidenceStatus, default: CareerEvidenceStatus.Submitted })
  @Index()
  status: CareerEvidenceStatus;

  @Column('uuid', { name: 'reviewer_id', nullable: true })
  @Index()
  reviewerId: string | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'proof_missions' })
@Unique('uq_proof_missions_id_owner_user_id', ['id', 'ownerUserId'])
export class ProofMission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'owner_user_id' })
  @Index()
  ownerUserId: string;

  @Column('uuid', { name: 'target_id' })
  @Index()
  targetId: string;

  @Column({ name: 'competency_slug', type: 'varchar', length: 100 })
  competencySlug: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'enum', enum: ProofMissionState, default: ProofMissionState.Draft })
  @Index()
  state: ProofMissionState;

  @Column({ name: 'criteria_version', type: 'integer', default: 1 })
  criteriaVersion: number;

  @Column({ name: 'binding_version', type: 'integer', default: 0 })
  bindingVersion: number;

  @Column('uuid', { name: 'installation_id', nullable: true })
  installationId: string | null;

  @Column({ name: 'github_repository_id', type: 'bigint', nullable: true })
  githubRepositoryId: string | null;

  @Column({ name: 'pull_number', type: 'integer', nullable: true })
  pullNumber: number | null;

  @Column({ name: 'repository_name', type: 'varchar', length: 255, nullable: true })
  repositoryName: string | null;

  @Column({ name: 'repository_private', type: 'boolean', nullable: true })
  repositoryPrivate: boolean | null;

  @Column({ name: 'pull_title', type: 'varchar', length: 512, nullable: true })
  pullTitle: string | null;

  @Column({ name: 'pull_url', type: 'varchar', length: 2_048, nullable: true })
  pullUrl: string | null;

  @Column('uuid', { name: 'current_verification_run_id', nullable: true })
  currentVerificationRunId: string | null;

  @Column('uuid', { name: 'current_review_id', nullable: true })
  currentReviewId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'proof_criteria' })
@Unique('uq_proof_criteria_mission_position', ['missionId', 'position'])
export class ProofCriterion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'mission_id' })
  @Index()
  missionId: string;

  @Column({ type: 'smallint' })
  position: number;

  @Column({ type: 'enum', enum: ProofCriterionType })
  @Index()
  type: ProofCriterionType;

  @Column({ type: 'jsonb' })
  config: ProofCriterionConfig;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity({ name: 'proof_verification_runs' })
@Unique('uq_proof_runs_id_mission_id', ['id', 'missionId'])
@Unique('uq_proof_runs_observation', [
  'missionId',
  'bindingVersion',
  'criteriaVersion',
  'headSha',
  'criteriaDigest',
  'factsDigest',
])
export class ProofVerificationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'mission_id' })
  @Index()
  missionId: string;

  @Column({ name: 'binding_version', type: 'integer' })
  bindingVersion: number;

  @Column({ name: 'criteria_version', type: 'integer' })
  criteriaVersion: number;

  @Column({ name: 'head_sha', type: 'varchar', length: 64 })
  headSha: string;

  @Column({ name: 'criteria_digest', type: 'varchar', length: 64 })
  criteriaDigest: string;

  @Column({ name: 'facts_digest', type: 'varchar', length: 64 })
  factsDigest: string;

  @Column({ type: 'enum', enum: ProofVerificationStatus })
  @Index()
  status: ProofVerificationStatus;

  @Column({ type: 'jsonb' })
  results: ProofCriterionResult[];

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity({ name: 'proof_reviews' })
@Unique('uq_proof_reviews_verification_run_id', ['verificationRunId'])
@Unique('uq_proof_reviews_id_mission_run', ['id', 'missionId', 'verificationRunId'])
export class ProofReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'mission_id' })
  @Index()
  missionId: string;

  @Column('uuid', { name: 'verification_run_id' })
  verificationRunId: string;

  @Column('uuid', { name: 'reviewer_id', nullable: true })
  @Index()
  reviewerId: string | null;

  @Column({ type: 'enum', enum: ProofReviewDecision })
  @Index()
  decision: ProofReviewDecision;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'reviewed_at', type: 'timestamptz' })
  reviewedAt: Date;
}

@Entity({ name: 'proof_profiles' })
@Unique('uq_proof_profiles_owner_user_id', ['ownerUserId'])
@Unique('uq_proof_profiles_public_id', ['publicId'])
export class ProofProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'owner_user_id' })
  @Index()
  ownerUserId: string;

  @Column({ name: 'public_id', type: 'varchar', length: 64 })
  publicId: string;

  @Column({ type: 'enum', enum: ProofProfileState, default: ProofProfileState.Disabled })
  @Index()
  state: ProofProfileState;

  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'published_proofs' })
@Unique('uq_published_proofs_profile_mission', ['profileId', 'missionId'])
export class PublishedProof {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'profile_id' })
  @Index()
  profileId: string;

  @Column('uuid', { name: 'mission_id' })
  @Index()
  missionId: string;

  @Column('uuid', { name: 'verification_run_id' })
  verificationRunId: string;

  @Column('uuid', { name: 'review_id' })
  reviewId: string;

  @Column({ type: 'enum', enum: PublishedProofState })
  @Index()
  state: PublishedProofState;

  @Column({ name: 'schema_version', type: 'smallint', default: 1 })
  schemaVersion: 1;

  @Column({ type: 'jsonb' })
  snapshot: PublicProofSnapshotV1;

  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'command_idempotency_keys' })
@Unique('uq_command_idempotency_owner_command_key', ['ownerUserId', 'command', 'key'])
export class CommandIdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'owner_user_id' })
  @Index()
  ownerUserId: string;

  @Column({ type: 'varchar', length: 80 })
  command: string;

  @Column({ type: 'varchar', length: 128 })
  key: string;

  @Column({ name: 'request_digest', type: 'varchar', length: 64 })
  requestDigest: string;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  @Index()
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
