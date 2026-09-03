import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'project_run_entitlements' })
export class ProjectRunEntitlement {
  @PrimaryColumn('uuid', { name: 'owner_id' }) ownerId: string;
  @Column({ type: 'boolean', default: false }) enabled: boolean;
  @Column({ name: 'reason', type: 'varchar', length: 160 }) reason: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
