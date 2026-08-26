import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum GithubInstallationStatus {
  Active = 'ACTIVE',
  Suspended = 'SUSPENDED',
  Revoked = 'REVOKED',
}

export enum GithubWebhookDeliveryState {
  LocalApplied = 'LOCAL_APPLIED',
  Reconciled = 'RECONCILED',
  ReconcileFailed = 'RECONCILE_FAILED',
}

@Entity({ name: 'github_installation_claim_attempts' })
@Index('IDX_github_claim_attempt_user_expiry', ['userId', 'expiresAt'])
@Index('IDX_github_claim_attempt_unconsumed', ['expiresAt'], {
  where: '"consumed_at" IS NULL',
})
export class GithubInstallationClaimAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column({ name: 'state_hash', type: 'char', length: 64, unique: true })
  stateHash: string;

  @Column({ name: 'return_path', type: 'varchar', length: 500 })
  returnPath: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity({ name: 'github_installations' })
@Unique('UQ_github_installation_owner', ['id', 'ownerUserId'])
@Index('IDX_github_installation_owner_status', ['ownerUserId', 'status'])
@Check('CHK_github_installation_personal_account', '"account_type" = \'USER\'')
export class GithubInstallation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'owner_user_id' })
  ownerUserId: string;

  @Column({ name: 'github_installation_id', type: 'bigint', unique: true })
  githubInstallationId: string;

  @Column({ name: 'github_account_id', type: 'bigint' })
  @Index('IDX_github_installation_account')
  githubAccountId: string;

  @Column({ name: 'account_type', type: 'varchar', length: 16 })
  accountType: 'USER';

  @Column({ type: 'enum', enum: GithubInstallationStatus })
  status: GithubInstallationStatus;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'github_installation_repositories' })
@Index('IDX_github_repository_active', ['githubRepositoryId', 'active'])
export class GithubInstallationRepository {
  @PrimaryColumn('uuid', { name: 'installation_id' })
  installationId: string;

  @PrimaryColumn({ name: 'github_repository_id', type: 'bigint' })
  githubRepositoryId: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  @Column({ type: 'boolean' })
  private: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'github_webhook_deliveries' })
@Index('IDX_github_delivery_state_received', ['state', 'receivedAt'])
@Index('IDX_github_delivery_installation_received', ['installationId', 'receivedAt'])
@Index('IDX_github_delivery_repository_pull', ['githubRepositoryId', 'pullNumber'])
export class GithubWebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'delivery_id', type: 'uuid', unique: true })
  deliveryId: string;

  @Column({ name: 'event_name', type: 'varchar', length: 40 })
  eventName: string;

  @Column('uuid', { name: 'installation_id', nullable: true })
  installationId: string | null;

  @Column({ name: 'github_installation_id', type: 'bigint', nullable: true })
  githubInstallationId: string | null;

  @Column({ name: 'github_repository_id', type: 'bigint', nullable: true })
  githubRepositoryId: string | null;

  @Column({ name: 'pull_number', type: 'integer', nullable: true })
  pullNumber: number | null;

  @Column({ name: 'head_sha', type: 'char', length: 40, nullable: true })
  headSha: string | null;

  @Column({ type: 'enum', enum: GithubWebhookDeliveryState })
  state: GithubWebhookDeliveryState;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ name: 'reconciled_at', type: 'timestamptz', nullable: true })
  reconciledAt: Date | null;
}
