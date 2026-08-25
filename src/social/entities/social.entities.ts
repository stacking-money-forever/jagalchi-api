import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'comments' })
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'roadmap_id' })
  @Index()
  roadmapId: string;

  @Column('uuid', { name: 'author_id' })
  @Index()
  authorId: string;

  @Column('uuid', { name: 'parent_id', nullable: true })
  @Index()
  parentId: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'follows' })
@Unique(['followerId', 'followeeId'])
export class Follow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'follower_id' })
  @Index()
  followerId: string;

  @Column('uuid', { name: 'followee_id' })
  @Index()
  followeeId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export enum NotificationType {
  Comment = 'COMMENT',
  Reply = 'REPLY',
  Follow = 'FOLLOW',
  Fork = 'FORK',
  Like = 'LIKE',
  AiComplete = 'AI_COMPLETE',
  LearningReminder = 'LEARNING_REMINDER',
  System = 'SYSTEM',
}

@Entity({ name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'recipient_id' })
  @Index()
  recipientId: string;

  @Column('uuid', { name: 'actor_id', nullable: true })
  actorId: string | null;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ name: 'resource_type', type: 'varchar', length: 40, nullable: true })
  resourceType: string | null;

  @Column('uuid', { name: 'resource_id', nullable: true })
  resourceId: string | null;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  @Index()
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity({ name: 'notification_preferences' })
export class NotificationPreference {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'boolean', default: true })
  comments: boolean;

  @Column({ type: 'boolean', default: true })
  replies: boolean;

  @Column({ type: 'boolean', default: true })
  follows: boolean;

  @Column({ type: 'boolean', default: true })
  forks: boolean;

  @Column({ type: 'boolean', default: true })
  likes: boolean;

  @Column({ name: 'ai_complete', type: 'boolean', default: true })
  aiComplete: boolean;

  @Column({ name: 'learning_reminders', type: 'boolean', default: true })
  learningReminders: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
