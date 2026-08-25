import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum UserStatus {
  Active = 'ACTIVE',
  Suspended = 'SUSPENDED',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 254, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'profile_image_url', type: 'varchar', length: 500, nullable: true })
  profileImageUrl: string | null;

  @Column({ name: 'external_links', type: 'jsonb', default: () => "'{}'::jsonb" })
  externalLinks: Record<string, string>;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  @Column({ type: 'varchar', array: true, default: () => "'{USER}'" })
  roles: string[];

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Active })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

export enum OAuthProvider {
  Google = 'google',
  Github = 'github',
  Apple = 'apple',
}

@Entity({ name: 'oauth_identities' })
@Unique(['provider', 'providerUserId'])
export class OAuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column({ type: 'enum', enum: OAuthProvider })
  provider: OAuthProvider;

  @Column({ name: 'provider_user_id', type: 'varchar', length: 191 })
  providerUserId: string;

  @Column({ type: 'varchar', length: 254 })
  email: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity({ name: 'refresh_sessions' })
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  @Index()
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column('uuid', { name: 'replaced_by_id', nullable: true })
  replacedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity({ name: 'oauth_attempts' })
export class OAuthAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 64, unique: true })
  state: string;

  @Column({ type: 'enum', enum: OAuthProvider })
  provider: OAuthProvider;

  @Column({ name: 'code_verifier', type: 'varchar', length: 128 })
  codeVerifier: string;

  @Column({ type: 'varchar', length: 64 })
  nonce: string;

  @Column({ name: 'return_url', type: 'varchar', length: 500 })
  returnUrl: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity({ name: 'oauth_login_grants' })
export class OAuthLoginGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column({ name: 'code_hash', type: 'char', length: 64, unique: true })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export enum EmailChallengePurpose {
  Registration = 'REGISTRATION',
  PasswordReset = 'PASSWORD_RESET',
}

@Entity({ name: 'email_verification_challenges' })
export class EmailVerificationChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 254 })
  @Index()
  email: string;

  @Column({ type: 'enum', enum: EmailChallengePurpose })
  purpose: EmailChallengePurpose;

  @Column({ name: 'code_hash', type: 'char', length: 64 })
  codeHash: string;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'proof_used_at', type: 'timestamptz', nullable: true })
  proofUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
