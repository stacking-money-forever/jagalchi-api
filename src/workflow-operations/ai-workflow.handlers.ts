import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTokenService } from '../ai/ai-token.service';
import { AI_V1_ENDPOINTS, AI_V1_SCHEMAS } from '../contracts/ai-v1.schemas';
import { validateJsonSchema } from '../contracts/json-schema-validator';
import type { WorkflowOperation } from './workflow-operation.entities';
import { WorkflowOperationHandlers } from './workflow-operation.worker';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { ProjectRunEntitlement } from '../project-runs/project-run-entitlement.entity';
import { ProjectFeature, ProjectFeatureEntitlement } from '../project-runs/product-spine.entities';
import { ExecutionOrchestrationService } from '../execution-orchestration/execution-orchestration.service';
import type { ProjectRunProjection, ProjectTaskState } from '../project-runs/project-run.entity';
import { workflowTiming } from './workflow-timing';
import { RetryableWorkflowError } from './workflow-runtime';

const HANDLERS = {
  JOB_POSTING_EXTRACT: [AI_V1_ENDPOINTS.jobPostingExtract, 'EXTRACT', 'job-posting-extract.response.schema.json'],
  CANDIDATE_EVIDENCE_INTERPRET: [AI_V1_ENDPOINTS.candidateEvidenceInterpret, 'INTERPRET', 'candidate-evidence-interpret.response.schema.json'],
  PROJECT_PROPOSALS: [AI_V1_ENDPOINTS.projectProposals, 'PROPOSE', 'project-proposals.response.schema.json'],
  PROJECT_PLAN: [AI_V1_ENDPOINTS.projectPlan, 'COMPILE', 'project-plan.response.schema.json'],
} as const;

type Permission = (typeof HANDLERS)[keyof typeof HANDLERS][1];
type ResponseSchemaName = (typeof HANDLERS)[keyof typeof HANDLERS][2];

export class AiContractInvalidError extends Error {
  readonly code = 'AI_CONTRACT_INVALID';
  constructor(path?: string) { super(`AI response violates the canonical v1 contract${path ? ` at ${path}` : ''}`); }
}

@Injectable()
export class AiWorkflowHandlers implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly tokens: AiTokenService,
    private readonly handlers: WorkflowOperationHandlers,
    @InjectRepository(ProjectRunEntitlement)
    private readonly entitlements: Repository<ProjectRunEntitlement>,
    private readonly orchestration: ExecutionOrchestrationService,
    @InjectRepository(ProjectFeatureEntitlement)
    private readonly featureEntitlements?: Repository<ProjectFeatureEntitlement>,
  ) {}

  onModuleInit(): void {
    if (
      this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true' ||
      this.config.get<string>('AI_FEATURES_ENABLED') !== 'true'
    ) return;
    for (const [kind, [path, permission, responseSchema]] of Object.entries(HANDLERS)) {
      this.handlers.register(kind, (operation, signal) => this.execute(operation, path, permission, responseSchema, signal));
    }
  }

  private async execute(
    operation: WorkflowOperation,
    path: string,
    permission: Permission,
    responseSchema: ResponseSchemaName,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const entitled = this.featureEntitlements
      ? await this.featureEntitlements.exists({ where: [
        { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
        { userId: operation.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
      ] })
      : await this.entitlements.exists({ where: { ownerId: operation.ownerId, enabled: true } });
    if (!entitled) {
      throw new Error('Project Run entitlement is unavailable');
    }
    const { targetId, competencySlugs, ...aiInput } = operation.input;
    const url = new URL(path, this.config.getOrThrow<string>('AI_SERVICE_URL'));
    const timeout = AbortSignal.timeout(workflowTiming(this.config).aiTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.tokens.issueInternal(operation.ownerId, permission)}`,
          'content-type': 'application/json',
          'x-request-id': operation.id,
        },
        body: JSON.stringify({ schemaVersion: 1, operationId: operation.id, ...aiInput }),
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', 'AI service request failed');
    }
    if (!response.ok) {
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', `AI service returned ${response.status}`);
      }
      throw Object.assign(new Error('AI service rejected the request'), { code: 'AI_REQUEST_REJECTED' });
    }
    const value: unknown = await response.json();
    const validation = validateJsonSchema(AI_V1_SCHEMAS[responseSchema] as Record<string, unknown>, value);
    if (!validation.valid) throw new AiContractInvalidError(`${validation.path ?? '$.schema'} | ${JSON.stringify(value).slice(0, 900)}`);
    const result = value as Record<string, unknown>;
    if (result.operationId !== operation.id) throw new AiContractInvalidError('$.operationId');
    if (operation.kind !== 'PROJECT_PLAN') return result;
    if (typeof targetId !== 'string' || !Array.isArray(competencySlugs) || !competencySlugs.every((slug) => typeof slug === 'string')) {
      throw new Error('PROJECT_PLAN operation context is invalid');
    }
    const artifact = this.projectPlanArtifact(result);
    const tasks = artifact.tasks.map((task, index) => ({
      id: task.id, title: task.title,
      state: (index === 0 ? 'READY' : 'LOCKED') as ProjectTaskState,
      required: true, milestoneId: task.milestoneId, prerequisiteIds: task.prerequisiteIds,
      purpose: task.purpose, acceptanceCriteria: task.acceptanceCriteria,
      evidenceRequirements: ['PR', ...task.evidenceRules.map((rule) => rule.startsWith('pr:changed-path:') ? `CHANGED_PATH:${rule.slice(16)}` : rule.startsWith('pr:named-check:') ? `NAMED_CHECK:${rule.slice(15)}` : rule.startsWith('test:') ? 'NAMED_CHECK:ci/test' : rule)],
    }));
    const projection: Omit<ProjectRunProjection, 'id' | 'state' | 'version'> = {
      currentTaskId: null,
      recommendedTaskId: tasks.find((task) => task.state === 'READY')?.id ?? null,
      plan: { id: artifact.id, schemaVersion: 1 },
      map: {
        nodes: tasks.map(({ id, title, milestoneId, state }) => ({ id, title, milestoneId, state })),
        edges: tasks.flatMap((task, taskIndex) => task.prerequisiteIds.map((source, prerequisiteIndex) => ({ id: `edge-${taskIndex + 1}-${prerequisiteIndex + 1}`, source, target: task.id, kind: 'PREREQUISITE' as const }))),
      },
      tasks, proof: null,
    };
    const execution = await this.orchestration.createProjectRun({
      ownerId: operation.ownerId, proposalId: artifact.id, catalogVersion: 'v1', targetId,
      competencySlugs, projection,
      operationId: operation.id,
    });
    return { ai: result, execution };
  }

  private projectPlanArtifact(result: Record<string, unknown>) {
    const payload = result.result;
    const artifact = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).artifact : null;
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw new Error('PROJECT_PLAN artifact is invalid');
    const value = artifact as Record<string, unknown>;
    if (typeof value.id !== 'string' || !Array.isArray(value.tasks)) throw new Error('PROJECT_PLAN artifact is invalid');
    return value as unknown as {
      id: string;
      tasks: Array<{ id: string; title: string; milestoneId: string; prerequisiteIds: string[]; purpose: string; acceptanceCriteria: string[]; evidenceRules: string[] }>;
    };
  }
}
