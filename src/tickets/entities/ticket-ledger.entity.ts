import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AiFeature } from '../ticket-policy';

export enum TicketLedgerKind {
  SignupGrant = 'SIGNUP_GRANT',
  MonthlyGrant = 'MONTHLY_GRANT',
  Purchase = 'PURCHASE',
  AiUsage = 'AI_USAGE',
}

export enum TicketLedgerStatus {
  Reserved = 'RESERVED',
  Committed = 'COMMITTED',
  Refunded = 'REFUNDED',
}

@Entity({ name: 'ticket_ledger' })
@Index(['userId', 'idempotencyKey'], { unique: true })
export class TicketLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'enum', enum: TicketLedgerKind })
  kind: TicketLedgerKind;

  @Column({ type: 'enum', enum: TicketLedgerStatus })
  status: TicketLedgerStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  feature: AiFeature | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 120 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 240 })
  description: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
