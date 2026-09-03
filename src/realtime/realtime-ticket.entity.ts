import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'realtime_connection_tickets' })
export class RealtimeConnectionTicket {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'user_id' }) @Index() userId: string;
  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true }) tokenHash: string;
  @Column({ type: 'varchar', length: 40 }) audience: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) @Index() expiresAt: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true }) consumedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
