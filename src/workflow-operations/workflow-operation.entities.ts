import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum WorkflowOperationState {
  Pending = 'PENDING',
  Running = 'RUNNING',
  CancelRequested = 'CANCEL_REQUESTED',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  Cancelled = 'CANCELLED',
}

@Entity({ name: 'workflow_operations' })
@Unique('uq_workflow_operations_idempotency', ['ownerId', 'route', 'idempotencyKey'])
@Index('idx_workflow_operations_claim', ['state', 'availableAt', 'createdAt'])
@Index('idx_workflow_operations_claim_v2', ['state', 'nextAttemptAt', 'createdAt'])
export class WorkflowOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'owner_id' })
  ownerId: string;

  @Column({ type: 'varchar', length: 160 })
  route: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 100 })
  kind: string;

  @Column({ name: 'input_hash', type: 'char', length: 64 })
  inputHash: string;

  @Column({ type: 'jsonb' })
  input: Record<string, unknown>;

  @Column({ name: 'input_schema_version', type: 'integer', default: 1 })
  inputSchemaVersion: number;

  @Column({ name: 'result_schema_version', type: 'integer', default: 1 })
  resultSchemaVersion: number;

  @Column({ type: 'enum', enum: WorkflowOperationState, default: WorkflowOperationState.Pending })
  state: WorkflowOperationState;
  @Column({ type: 'integer', default: 1 }) version: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt: Date;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt: Date;

  @Column({ name: 'lease_owner', type: 'varchar', length: 160, nullable: true })
  leaseOwner: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt: Date | null;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 3 })
  maxAttempts: number;

  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  errorMessage: string | null;

  @Column({ name: 'failure_class', type: 'varchar', length: 80, nullable: true })
  failureClass: string | null;

  @Column({ name: 'result_type', type: 'varchar', length: 100, nullable: true })
  resultType: string | null;

  @Column('uuid', { name: 'result_id', nullable: true })
  resultId: string | null;

  @Column({ name: 'result_href', type: 'varchar', length: 500, nullable: true })
  resultHref: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'workflow_worker_heartbeats' })
export class WorkflowWorkerHeartbeat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'worker_id', type: 'varchar', length: 160, unique: true })
  workerId: string;

  @Column({ name: 'heartbeat_at', type: 'timestamptz' })
  @Index('IDX_workflow_worker_heartbeats_time')
  heartbeatAt: Date;
}

@Entity({ name: 'workflow_operation_results' })
@Unique('uq_workflow_operation_results_operation', ['operationId'])
export class WorkflowOperationResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'operation_id' })
  operationId: string;

  @Column({ type: 'jsonb' })
  value: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
