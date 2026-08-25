import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UploadStatus {
  Pending = 'PENDING',
  Ready = 'READY',
}

export enum UploadPurpose {
  ProfileImage = 'PROFILE_IMAGE',
  RoadmapAttachment = 'ROADMAP_ATTACHMENT',
}

@Entity({ name: 'upload_assets' })
export class UploadAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'owner_id' })
  @Index()
  ownerId: string;

  @Column('uuid', { name: 'roadmap_id', nullable: true })
  @Index()
  roadmapId: string | null;

  @Column({ type: 'enum', enum: UploadPurpose })
  purpose: UploadPurpose;

  @Column({ name: 'object_key', type: 'varchar', length: 700, unique: true })
  objectKey: string;

  @Column({ name: 'file_name', type: 'varchar', length: 180 })
  fileName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 120 })
  contentType: string;

  @Column({ name: 'expected_size', type: 'integer' })
  expectedSize: number;

  @Column({ type: 'enum', enum: UploadStatus, default: UploadStatus.Pending })
  status: UploadStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
