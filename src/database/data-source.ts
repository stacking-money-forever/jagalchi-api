import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { TicketAccount } from '../tickets/entities/ticket-account.entity';
import { TicketLedger } from '../tickets/entities/ticket-ledger.entity';
import { TicketPurchase } from '../tickets/entities/ticket-purchase.entity';
import {
  NodeProgress,
  Roadmap,
  RoadmapDirectory,
  RoadmapReaction,
} from '../roadmaps/entities/roadmap.entities';
import { CreateTicketLedger1770000000000 } from './migrations/1770000000000-create-ticket-ledger';
import { CreateRoadmapDomain1770000001000 } from './migrations/1770000001000-create-roadmap-domain';
import {
  Comment,
  Follow,
  Notification,
  NotificationPreference,
} from '../social/entities/social.entities';
import { CreateSocialDomain1770000002000 } from './migrations/1770000002000-create-social-domain';
import {
  OAuthAttempt,
  OAuthIdentity,
  OAuthLoginGrant,
  RefreshSession,
  User,
  EmailVerificationChallenge,
} from '../auth/auth.entities';
import { CreateAuthDomain1770000003000 } from './migrations/1770000003000-create-auth-domain';
import { RoadmapEvent, RoadmapSequence } from '../realtime/roadmap-event.entity';
import { RealtimeConnectionTicket } from '../realtime/realtime-ticket.entity';
import { CreateRealtimeDomain1770000004000 } from './migrations/1770000004000-create-realtime-domain';
import { UploadAsset } from '../uploads/upload-asset.entity';
import { CreateUploadsDomain1770000005000 } from './migrations/1770000005000-create-uploads-domain';
import { CreateTicketPurchases1770000006000 } from './migrations/1770000006000-create-ticket-purchases';
import {
  CareerEvidence,
  CareerTarget,
  CommandIdempotencyKey,
  ProofCriterion,
  ProofMission,
  ProofProfile,
  ProofReview,
  ProofVerificationRun,
  PublishedProof,
} from '../career/career.entities';
import { CreateCareerDomain1770000007000 } from './migrations/1770000007000-create-career-domain';
import {
  GithubInstallation,
  GithubInstallationClaimAttempt,
  GithubInstallationRepository,
  GithubWebhookDelivery,
} from '../github/github.entities';
import { CreateEvidenceExecution1770000008000 } from './migrations/1770000008000-create-evidence-execution';
import { CreateWorkflowOperations1770000009000 } from './migrations/1770000009000-create-workflow-operations';
import { WorkflowOperation, WorkflowOperationResult, WorkflowWorkerHeartbeat } from '../workflow-operations/workflow-operation.entities';
import { ProjectRun } from '../project-runs/project-run.entity';
import { ProjectRunEntitlement } from '../project-runs/project-run-entitlement.entity';
import { CompleteWorkflowDurability1770000010000 } from './migrations/1770000010000-complete-workflow-durability';
import { CreateProductSpine1770000011000 } from './migrations/1770000011000-create-product-spine';
import { CreateCareerTargetVersions1770000012000 } from './migrations/1770000012000-create-career-target-versions';
import { CreateInvalidationWatermarks1770000013000 } from './migrations/1770000013000-create-invalidation-watermarks';
import { SeedProjectBlueprintCatalog1770000014000 } from './migrations/1770000014000-seed-project-blueprint-catalog';
import {
  CandidateProfileSnapshot, CareerDiffSnapshot, CareerTargetVersion, ProjectBlueprintVersion, ProjectFeatureEntitlement,
  ProjectPlanSnapshot, ProjectProposal, ProjectProposalSet, ProjectRepositoryBinding, ProjectRunCommand,
  ProjectTask, ProofPublication, ProofSnapshot, ProviderInvalidationEvent, RepositoryInvalidationWatermark,
} from '../project-runs/product-spine.entities';
import { postgresExtra, postgresSsl } from './postgres-options';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [
    TicketAccount,
    TicketLedger,
    TicketPurchase,
    Roadmap,
    RoadmapDirectory,
    NodeProgress,
    RoadmapReaction,
    Comment,
    Follow,
    Notification,
    NotificationPreference,
    User,
    OAuthIdentity,
    RefreshSession,
    OAuthAttempt,
    OAuthLoginGrant,
    EmailVerificationChallenge,
    RoadmapEvent,
    RoadmapSequence,
    RealtimeConnectionTicket,
    UploadAsset,
    CareerTarget,
    CareerEvidence,
    ProofMission,
    ProofCriterion,
    ProofVerificationRun,
    ProofReview,
    ProofProfile,
    PublishedProof,
    CommandIdempotencyKey,
    GithubInstallationClaimAttempt,
    GithubInstallation,
    GithubInstallationRepository,
    GithubWebhookDelivery,
    WorkflowOperation,
    WorkflowOperationResult,
    ProjectRun,
    ProjectRunEntitlement,
    WorkflowWorkerHeartbeat,
    CandidateProfileSnapshot,
    CareerTargetVersion,
    CareerDiffSnapshot,
    ProjectBlueprintVersion,
    ProjectFeatureEntitlement,
    ProjectPlanSnapshot,
    ProjectProposal,
    ProjectProposalSet,
    ProjectRepositoryBinding,
    ProjectRunCommand,
    ProjectTask,
    ProofPublication,
    ProofSnapshot,
    ProviderInvalidationEvent,
    RepositoryInvalidationWatermark,
  ],
  migrations: [
    CreateTicketLedger1770000000000,
    CreateRoadmapDomain1770000001000,
    CreateSocialDomain1770000002000,
    CreateAuthDomain1770000003000,
    CreateRealtimeDomain1770000004000,
    CreateUploadsDomain1770000005000,
    CreateTicketPurchases1770000006000,
    CreateCareerDomain1770000007000,
    CreateEvidenceExecution1770000008000,
    CreateWorkflowOperations1770000009000,
    CompleteWorkflowDurability1770000010000,
    CreateProductSpine1770000011000,
    CreateCareerTargetVersions1770000012000,
    CreateInvalidationWatermarks1770000013000,
    SeedProjectBlueprintCatalog1770000014000,
  ],
  migrationsTableName: 'jagalchi_migrations',
  ssl: postgresSsl(process.env.DATABASE_SSL === 'true', process.env.DATABASE_SSL_CA),
  extra: postgresExtra({ get: (key: string) => process.env[key] }, true),
});
