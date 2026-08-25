import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum TicketPurchaseStore {
  Apple = 'APPLE',
  Google = 'GOOGLE',
}

export enum TicketPurchaseStatus {
  Fulfilled = 'FULFILLED',
}

@Entity({ name: 'ticket_purchases' })
@Unique(['store', 'providerTransactionId'])
export class TicketPurchase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'enum', enum: TicketPurchaseStore })
  store: TicketPurchaseStore;

  @Column({ name: 'provider_transaction_id', type: 'varchar', length: 512 })
  providerTransactionId: string;

  @Column({ name: 'provider_token_hash', type: 'char', length: 64 })
  providerTokenHash: string;

  @Column({ name: 'product_id', type: 'varchar', length: 191 })
  productId: string;

  @Column({ name: 'pack_id', type: 'varchar', length: 40 })
  packId: string;

  @Column({ type: 'integer' })
  tickets: number;

  @Column({ type: 'varchar', length: 32 })
  environment: string;

  @Column({ type: 'enum', enum: TicketPurchaseStatus })
  status: TicketPurchaseStatus;

  @Column('uuid', { name: 'ledger_id', unique: true })
  ledgerId: string;

  @Column({ name: 'purchased_at', type: 'timestamptz' })
  purchasedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
