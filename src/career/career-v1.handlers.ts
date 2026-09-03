import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, MoreThan, Repository } from 'typeorm';
import { AiTokenService } from '../ai/ai-token.service';
import { CareerTarget } from './career.entities';
import { AI_V1_ENDPOINTS, AI_V1_SCHEMAS } from '../contracts/ai-v1.schemas';
import { validateJsonSchema } from '../contracts/json-schema-validator';
import { JOB_SOURCE_ADAPTER, JobSourceError, type JobSourceAdapter, validateManualCapture } from '../job-sources';
import { GithubInstallation, GithubInstallationRepository, GithubInstallationStatus } from '../github/github.entities';
import {
  CandidateProfileSnapshot, CareerDiffSnapshot, CareerTargetVersion, ProjectBlueprintVersion,
  ProjectFeature, ProjectFeatureEntitlement, ProjectProposal, ProjectProposalSet, RepositoryMode, SnapshotState,
} from '../project-runs/product-spine.entities';
import type { ProjectRunProjection } from '../project-runs/project-run.entity';
import { ExecutionOrchestrationService } from '../execution-orchestration/execution-orchestration.service';
import { WorkflowOperationHandlers } from '../workflow-operations/workflow-operation.worker';
import { WorkflowOperation, WorkflowOperationResult, WorkflowOperationState } from '../workflow-operations/workflow-operation.entities';
import { AiContractInvalidError } from '../workflow-operations/ai-workflow.handlers';
import { RetryableWorkflowError } from '../workflow-operations/workflow-runtime';

export const CAREER_V1_FAULT_INJECTOR = Symbol('CAREER_V1_FAULT_INJECTOR');
export type CareerV1FaultInjector = (point: 'AFTER_DOMAIN' | 'AFTER_RESULT') => void | Promise<void>;

@Injectable()
export class CareerV1WorkflowHandlers implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly tokens: AiTokenService,
    private readonly handlers: WorkflowOperationHandlers,
    @Inject(JOB_SOURCE_ADAPTER) private readonly jobSources: JobSourceAdapter,
    @InjectRepository(CareerTarget) private readonly targets: Repository<CareerTarget>,
    @InjectRepository(CareerTargetVersion) private readonly targetVersions: Repository<CareerTargetVersion>,
    @InjectRepository(CandidateProfileSnapshot) private readonly profiles: Repository<CandidateProfileSnapshot>,
    @InjectRepository(CareerDiffSnapshot) private readonly diffs: Repository<CareerDiffSnapshot>,
    @InjectRepository(ProjectProposalSet) private readonly proposalSets: Repository<ProjectProposalSet>,
    @InjectRepository(ProjectProposal) private readonly proposals: Repository<ProjectProposal>,
    @InjectRepository(ProjectBlueprintVersion) private readonly blueprints: Repository<ProjectBlueprintVersion>,
    @InjectRepository(GithubInstallation) private readonly installations: Repository<GithubInstallation>,
    @InjectRepository(GithubInstallationRepository) private readonly repositories: Repository<GithubInstallationRepository>,
    private readonly execution: ExecutionOrchestrationService,
    @Optional() @Inject(CAREER_V1_FAULT_INJECTOR) private readonly injectFault?: CareerV1FaultInjector,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') return;
    this.handlers.register('JOB_TARGET_IMPORT', (operation, signal) => this.targetImport(operation, signal));
    this.handlers.register('CANDIDATE_PROFILE_SNAPSHOT', (operation, signal) => this.profile(operation, signal));
    this.handlers.register('PROJECT_PROPOSALS_V1', (operation, signal) => this.proposal(operation, signal));
    this.handlers.register('PROJECT_RUN_CREATE', (operation, signal) => this.run(operation, signal));
  }

  private async targetImport(operation: WorkflowOperation, signal: AbortSignal) {
    const input = operation.input;
    let capture;
    try {
      capture = input.kind === 'FETCHED_URL'
        ? await this.jobSources.capture({ kind: 'FETCHED_URL', url: String(input.url) })
        : validateManualCapture({ kind: 'MANUAL_CAPTURE', text: String(input.sourceText), sourceTitle: typeof input.sourceTitle === 'string' ? input.sourceTitle : 'Manual capture', sourceUrl: typeof input.originalUrl === 'string' ? input.originalUrl : undefined, degradationReason: 'USER_SUPPLIED' });
    } catch (error) {
      if (error instanceof JobSourceError && ['JOB_SOURCE_TIMEOUT', 'JOB_SOURCE_FETCH_FAILED'].includes(error.code)) throw new RetryableWorkflowError(error.code, error.message, 'TRANSIENT_DEPENDENCY');
      throw error;
    }
    const cached = await this.targetVersions.findOne({ where: { ownerId: operation.ownerId, sourceHash: capture.sourceHash } });
    const ai = cached ? null : await this.ai(operation, signal, 'EXTRACT', AI_V1_ENDPOINTS.jobPostingExtract, 'job-posting-extract.response.schema.json', { text: capture.normalizedText, sourceUrl: capture.provenance.finalUrl ?? capture.provenance.requestedUrl, sourceTitle: capture.sourceTitle });
    return this.complete(operation, signal, async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`career-target:${operation.ownerId}:${capture.sourceHash}`]);
      const versions = manager.getRepository(CareerTargetVersion);
      const existing = await versions.findOne({ where: { ownerId: operation.ownerId, sourceHash: capture.sourceHash } });
      if (existing) return this.resource('CAREER_TARGET_VERSION', existing.id, `/api/career/target-versions/${existing.id}`);
      if (!ai) throw Object.assign(new Error('Cached target disappeared'), { code: 'SNAPSHOT_MISMATCH' });
      const extracted = ai.result as { company: string; role: string; requirements: Array<Record<string, unknown>> };
      const targets = manager.getRepository(CareerTarget);
      const target = await targets.save(targets.create({ userId: operation.ownerId, company: extracted.company, role: extracted.role, postingUrl: capture.provenance.finalUrl ?? capture.provenance.requestedUrl, requirements: extracted.requirements.map((item) => String(item.text)).join('\n'), competencySlugs: ['typescript'] }));
      const version = await versions.save(versions.create({ ownerId: operation.ownerId, careerTargetId: target.id, version: 1, sourceHash: capture.sourceHash, captureStatus: capture.provenance.mode === 'FETCHED_URL' ? 'AUTOMATIC' : 'DEGRADED_MANUAL_CAPTURE', schemaVersion: 1, payload: { capture, extraction: ai, requirements: extracted.requirements, citations: (ai.citations as unknown[]) ?? [] } }));
      return this.resource('CAREER_TARGET_VERSION', version.id, `/api/career/target-versions/${version.id}`);
    });
  }

  private async profile(operation: WorkflowOperation, signal: AbortSignal) {
    if (this.config.get<string>('GITHUB_PROVIDER') !== 'fixture') throw Object.assign(new Error('Real GitHub capture is not enabled in Phase 1'), { code: 'REPOSITORY_NOT_ELIGIBLE' });
    const installations = await this.installations.find({ where: { ownerUserId: operation.ownerId, status: GithubInstallationStatus.Active } });
    const allowed = new Set(Array.isArray(operation.input.repositoryIds) ? operation.input.repositoryIds as string[] : []);
    const facts = (await Promise.all(installations.map((installation) => this.repositories.find({ where: { installationId: installation.id, active: true } })))).flat().filter((repo) => allowed.size === 0 || allowed.has(repo.githubRepositoryId)).sort((left, right) => left.githubRepositoryId.localeCompare(right.githubRepositoryId));
    if (!facts.length) throw Object.assign(new Error('No eligible fixture repository facts'), { code: 'REPOSITORY_NOT_ELIGIBLE' });
    const evidence = facts.map((repo, index) => ({ id: `repo-${index + 1}`, title: repo.fullName, url: `https://github.com/${repo.fullName}`, quote: `Repository ${repo.fullName} is available to the installation.` }));
    const ai = await this.ai(operation, signal, 'INTERPRET', AI_V1_ENDPOINTS.candidateEvidenceInterpret, 'candidate-evidence-interpret.response.schema.json', { objective: 'Interpret candidate evidence', evidence });
    const expectedFacts = facts.map(({ githubRepositoryId, fullName, private: isPrivate }) => ({ githubRepositoryId, fullName, private: isPrivate }));
    return this.complete(operation, signal, async (manager) => {
      const profiles = manager.getRepository(CandidateProfileSnapshot);
      const replay = await profiles.createQueryBuilder('snapshot').where(`snapshot.payload ->> 'operationId' = :operationId`, { operationId: operation.id }).getOne();
      if (replay) return this.resource('CANDIDATE_PROFILE_SNAPSHOT', replay.id, `/api/career/profile-snapshots/${replay.id}`);
      const installationRows = await manager.getRepository(GithubInstallation).find({ where: { ownerUserId: operation.ownerId, status: GithubInstallationStatus.Active } });
      const currentFacts = (await Promise.all(installationRows.map((installation) => manager.getRepository(GithubInstallationRepository).find({ where: { installationId: installation.id, active: true } })))).flat().filter((repo) => allowed.size === 0 || allowed.has(repo.githubRepositoryId)).sort((left, right) => left.githubRepositoryId.localeCompare(right.githubRepositoryId)).map(({ githubRepositoryId, fullName, private: isPrivate }) => ({ githubRepositoryId, fullName, private: isPrivate }));
      if (JSON.stringify(currentFacts) !== JSON.stringify(expectedFacts)) throw Object.assign(new Error('Repository facts changed during interpretation'), { code: 'REPOSITORY_BINDING_CHANGED' });
      const snapshot = await profiles.save(profiles.create({ ownerId: operation.ownerId, state: SnapshotState.Draft, sourceSnapshotId: null, schemaVersion: 1, payload: { operationId: operation.id, repositories: expectedFacts, interpretation: ai } }));
      return this.resource('CANDIDATE_PROFILE_SNAPSHOT', snapshot.id, `/api/career/profile-snapshots/${snapshot.id}`);
    });
  }

  private async proposal(operation: WorkflowOperation, signal: AbortSignal) {
    const diff = await this.diffs.findOne({ where: { id: String(operation.input.careerDiffSnapshotId), ownerId: operation.ownerId, state: SnapshotState.Confirmed } });
    if (!diff) throw Object.assign(new Error('Confirmed diff is unavailable'), { code: 'SNAPSHOT_NOT_CONFIRMED' });
    const missing = Array.isArray(diff.payload.missing) ? diff.payload.missing : [];
    const findings = [{ id: 'finding-1', statement: 'Use confirmed candidate evidence', citationIds: ['source-1'] }];
    const gaps = (missing.length ? missing : ['typescript']).map((value, index) => ({ id: typeof value === 'object' && value && typeof value.id === 'string' ? value.id : `gap-${index + 1}`, description: typeof value === 'string' ? value : JSON.stringify(value) }));
    const catalog = await this.blueprints.find({ where: { catalogVersion: 'v1' }, order: { blueprintKey: 'ASC', version: 'ASC' } });
    if (catalog.length < 3) throw Object.assign(new Error('Blueprint catalog is incomplete'), { code: 'INSUFFICIENT_QUALIFIED_PROPOSALS' });
    const ai = await this.ai(operation, signal, 'PROPOSE', AI_V1_ENDPOINTS.projectProposals, 'project-proposals.response.schema.json', {
      objective: 'Generate qualified projects', findings, gaps,
      constraints: catalog.map((entry) => `Use eligible blueprint ${entry.blueprintKey}@${entry.version}`),
    });
    const result = ai.result as { proposals?: Array<Record<string, unknown>> };
    this.qualifyProposals(result.proposals, catalog, new Set(gaps.map(({ id }) => id)), new Set(findings.flatMap(({ citationIds }) => citationIds)));
    return this.complete(operation, signal, async (manager) => {
      const sets = manager.getRepository(ProjectProposalSet); const proposals = manager.getRepository(ProjectProposal);
      const replay = await sets.createQueryBuilder('proposalSet').where(`proposalSet.payload ->> 'operationId' = :operationId`, { operationId: operation.id }).getOne();
      if (replay) return this.resource('PROJECT_PROPOSAL_SET', replay.id, `/api/career/project-proposal-sets/${replay.id}`);
      const currentDiff = await manager.getRepository(CareerDiffSnapshot).findOne({ where: { id: diff.id, ownerId: operation.ownerId, state: SnapshotState.Confirmed }, lock: { mode: 'pessimistic_read' } });
      if (!currentDiff) throw Object.assign(new Error('Confirmed diff is unavailable'), { code: 'SNAPSHOT_NOT_CONFIRMED' });
      const currentCatalog = await manager.getRepository(ProjectBlueprintVersion).find({ where: { catalogVersion: 'v1' }, order: { blueprintKey: 'ASC', version: 'ASC' } });
      const persisted = this.qualifyProposals(result.proposals, currentCatalog, new Set(gaps.map(({ id }) => id)), new Set(findings.flatMap(({ citationIds }) => citationIds)));
      const stored = await sets.save(sets.create({ ownerId: operation.ownerId, careerDiffSnapshotId: diff.id, schemaVersion: 1, payload: { operationId: operation.id, receipt: ai.receipt } }));
      await proposals.save(persisted.map(({ payload, blueprint }, index) => proposals.create({ proposalSetId: stored.id, blueprintVersionId: blueprint.id, rank: index + 1, payload: { ...payload, careerDiffSnapshotId: diff.id } })));
      return this.resource('PROJECT_PROPOSAL_SET', stored.id, `/api/career/project-proposal-sets/${stored.id}`);
    });
  }

  private async run(operation: WorkflowOperation, signal: AbortSignal) {
    const proposal = await this.proposals.findOne({ where: { id: String(operation.input.projectProposalId) } });
    const profile = await this.profiles.findOne({ where: { id: String(operation.input.candidateProfileSnapshotId), ownerId: operation.ownerId, state: SnapshotState.Confirmed } });
    const diff = await this.diffs.findOne({ where: { id: String(operation.input.careerDiffSnapshotId), ownerId: operation.ownerId, state: SnapshotState.Confirmed } });
    if (!proposal || !profile || !diff || proposal.payload.careerDiffSnapshotId !== diff.id || diff.candidateProfileSnapshotId !== profile.id) throw Object.assign(new Error('Snapshot inputs do not match'), { code: 'SNAPSHOT_MISMATCH' });
    const set = await this.proposalSets.findOne({ where: { id: proposal.proposalSetId, ownerId: operation.ownerId, careerDiffSnapshotId: diff.id } });
    if (!set) throw Object.assign(new Error('Proposal ownership mismatch'), { code: 'SNAPSHOT_MISMATCH' });
    const target = await this.targets.findOne({ where: { id: diff.careerTargetId, userId: operation.ownerId } });
    if (!target) throw Object.assign(new Error('Target ownership mismatch'), { code: 'SNAPSHOT_MISMATCH' });
    const all = await this.proposals.find({ where: { proposalSetId: set.id }, order: { rank: 'ASC' } });
    const proposalFields = ['id', 'title', 'projectBlueprintId', 'projectBlueprintVersion', 'repositoryMode', 'citedGapIds', 'citationIds', 'boundedOutcome', 'nonGoals', 'durationHours', 'difficulty', 'evidenceRules', 'confidence', 'rejectionReasons'];
    const targetVersion = await this.targetVersions.findOne({ where: { careerTargetId: target.id }, order: { createdAt: 'DESC' } });
    const ai = await this.ai(operation, signal, 'COMPILE', AI_V1_ENDPOINTS.projectPlan, 'project-plan.response.schema.json', { title: String(proposal.payload.title ?? 'Project plan'), proposals: all.map(({ payload }) => Object.fromEntries(proposalFields.map((field) => [field, payload[field]]))), selectedProposalId: proposal.payload.id, target: 'project_run' });
    const artifact = (ai.result as { artifact: Record<string, unknown> }).artifact;
    if (artifact.projectBlueprintId !== proposal.payload.projectBlueprintId || artifact.projectBlueprintVersion !== proposal.payload.projectBlueprintVersion) throw new AiContractInvalidError('$.result.artifact.projectBlueprintId');
    const tasks = this.validatePlan(artifact, ai, diff, targetVersion, proposal);
    const projection: Omit<ProjectRunProjection, 'id' | 'state' | 'version'> = { target: { company: target.company, role: target.role }, currentTaskId: null, recommendedTaskId: tasks[0]?.id ?? null, plan: { id: String(artifact.id), schemaVersion: 1 }, map: { nodes: tasks.map((task) => ({ id: task.id, title: task.title, milestoneId: task.milestoneId, state: task.state })), edges: tasks.flatMap((task, i) => task.prerequisiteIds.map((source, j) => ({ id: `edge-${i}-${j}`, source, target: task.id, kind: 'PREREQUISITE' as const }))) }, tasks, proof: null };
    return this.complete(operation, signal, async (manager) => {
      const lockedProposal = await manager.getRepository(ProjectProposal).findOne({ where: { id: proposal.id }, lock: { mode: 'pessimistic_read' } });
      const lockedSet = lockedProposal ? await manager.getRepository(ProjectProposalSet).findOne({ where: { id: lockedProposal.proposalSetId, ownerId: operation.ownerId, careerDiffSnapshotId: diff.id }, lock: { mode: 'pessimistic_read' } }) : null;
      const lockedProfile = await manager.getRepository(CandidateProfileSnapshot).findOne({ where: { id: profile.id, ownerId: operation.ownerId, state: SnapshotState.Confirmed }, lock: { mode: 'pessimistic_read' } });
      const lockedDiff = await manager.getRepository(CareerDiffSnapshot).findOne({ where: { id: diff.id, ownerId: operation.ownerId, state: SnapshotState.Confirmed }, lock: { mode: 'pessimistic_read' } });
      const lockedTarget = lockedDiff ? await manager.getRepository(CareerTarget).findOne({ where: { id: lockedDiff.careerTargetId, userId: operation.ownerId }, lock: { mode: 'pessimistic_read' } }) : null;
      if (!lockedProposal || !lockedSet || !lockedProfile || !lockedDiff || !lockedTarget || lockedProposal.payload.careerDiffSnapshotId !== lockedDiff.id || lockedDiff.candidateProfileSnapshotId !== lockedProfile.id || lockedProposal.blueprintVersionId !== proposal.blueprintVersionId || JSON.stringify(lockedProposal.payload) !== JSON.stringify(proposal.payload)) throw Object.assign(new Error('Snapshot inputs changed'), { code: 'SNAPSHOT_MISMATCH' });
      const blueprint = await manager.getRepository(ProjectBlueprintVersion).findOne({ where: { id: lockedProposal.blueprintVersionId, version: Number(lockedProposal.payload.projectBlueprintVersion), catalogVersion: 'v1' }, lock: { mode: 'pessimistic_read' } });
      const logicalBlueprintId = String(lockedProposal.payload.projectBlueprintId);
      // Rows produced before the catalog expansion stored the internal UUID in the AI lineage field.
      if (!blueprint || (blueprint.blueprintKey !== logicalBlueprintId && blueprint.id !== logicalBlueprintId)) throw Object.assign(new Error('Proposal blueprint is not eligible'), { code: 'SNAPSHOT_MISMATCH' });
      const repository = operation.input.repository as Record<string, unknown> | undefined;
      const mode = repository?.mode === 'EXISTING_OWNED' ? RepositoryMode.ExistingOwned : repository?.mode === 'OPEN_SOURCE_CONTRIBUTION' ? RepositoryMode.OpenSourceContribution : RepositoryMode.ManualGreenfield;
      let binding: { mode: RepositoryMode; installationId?: string; githubRepositoryId?: string; repositoryName?: string; repositoryPrivate?: boolean; bindingVersion?: number; pullNumber?: number; expectedHeadSha?: string } = { mode };
      if (mode !== RepositoryMode.ManualGreenfield) {
        const repositoryId = typeof repository?.githubRepositoryId === 'string' ? repository.githubRepositoryId : '';
        const ownerInstallations = await manager.getRepository(GithubInstallation).find({ where: { ownerUserId: operation.ownerId, status: GithubInstallationStatus.Active } });
        let member: GithubInstallationRepository | null = null; let installationId: string | undefined;
        for (const installation of ownerInstallations) { member = await manager.getRepository(GithubInstallationRepository).findOne({ where: { installationId: installation.id, githubRepositoryId: repositoryId, active: true }, lock: { mode: 'pessimistic_read' } }); if (member) { installationId = installation.id; break; } }
        if (!member || !installationId) throw Object.assign(new Error('Repository binding changed'), { code: 'REPOSITORY_BINDING_CHANGED' });
        binding = { mode, installationId, githubRepositoryId: member.githubRepositoryId, repositoryName: member.fullName, repositoryPrivate: member.private, bindingVersion: 1, pullNumber: 17, expectedHeadSha: 'a'.repeat(40) };
      }
      const created = await this.execution.createProjectRunInTransaction(manager, { ownerId: operation.ownerId, proposalId: lockedProposal.id, catalogVersion: blueprint.catalogVersion, targetId: lockedDiff.careerTargetId, competencySlugs: ['typescript'], projection, operationId: operation.id, roadmap: { title: String(artifact.title), description: 'Project Run read-only Roadmap projection', graph: { schemaVersion: 1, nodes: projection.map.nodes.map((node, index) => ({ id: node.id, type: 'jagalchi-node', position: { x: index * 240, y: 0 }, data: { title: node.title, state: node.state } })), edges: projection.map.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, data: { kind: edge.kind } })) } }, repository: binding, planSnapshot: { projectProposalId: lockedProposal.id, careerDiffSnapshotId: lockedDiff.id, candidateProfileSnapshotId: lockedProfile.id, blueprintVersionId: blueprint.id, catalogVersion: blueprint.catalogVersion, payload: artifact } });
      return this.resource('PROJECT_RUN', created.projectRun.id, `/api/project-runs/${created.projectRun.id}`, { execution: created });
    });
  }

  private validatePlan(artifact: Record<string, unknown>, ai: Record<string, unknown>, diff: CareerDiffSnapshot, targetVersion?: CareerTargetVersion | null, selectedProposal?: ProjectProposal | null) {
    if (!Array.isArray(artifact.tasks)) throw new AiContractInvalidError('$.result.artifact.tasks');
    const rows = artifact.tasks as Array<Record<string, unknown>>;
    const ids = new Set(rows.map((task) => String(task.id)));
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string): void => { if (visiting.has(id)) throw new AiContractInvalidError('$.result.artifact.tasks.cycle'); if (visited.has(id)) return; visiting.add(id); const task = rows.find((row) => row.id === id)!; for (const dep of task.prerequisiteIds as string[]) { if (!ids.has(dep)) throw new AiContractInvalidError('$.result.artifact.tasks.prerequisiteIds'); visit(dep); } visiting.delete(id); visited.add(id); };
    for (const id of ids) visit(id);
    const versionCitations = targetVersion && Array.isArray(targetVersion.payload.citations) ? targetVersion.payload.citations as Array<{ id?: unknown }> : [];
    const targetCitations = [...versionCitations, ...(Array.isArray(diff.payload.citations) ? diff.payload.citations as Array<{ id?: unknown }> : [])];
    const citationIds = new Set([...(ai.citations as Array<{ id: string }>).map(({ id }) => id), ...targetCitations.map(({ id }) => String(id))]);
    const missing = Array.isArray(diff.payload.missing) ? diff.payload.missing : [];
    const missingIds = new Set(missing.map((item, index) => (item && typeof item === 'object' && typeof item.id === 'string' ? item.id : `gap-${index + 1}`)));
    const proposedGaps = Array.isArray(selectedProposal?.payload?.citedGapIds) ? selectedProposal.payload.citedGapIds as unknown[] : [];
    const requiredGaps = new Set(proposedGaps.filter((id) => typeof id === 'string' && missingIds.has(id)));
    // 선택된 proposal이 cite한 gap이 diff에 없으면(설계 불일치 방어) diff 전체 기준으로 후퇴
    const gapIds = requiredGaps.size > 0 ? requiredGaps : missingIds;
    const covered = new Set<string>();
    return rows.map((task, index) => {
      const citations = task.citationIds as string[]; const gaps = task.gapIds as string[];
      if (citations.length === 0 || !citations.every((id) => citationIds.has(id)) || !gaps.every((id) => gapIds.has(id))) throw new AiContractInvalidError('$.result.artifact.tasks.references');
      gaps.forEach((id) => covered.add(id));
      const rules = task.evidenceRules as string[];
      const evidence = ['PR', ...rules.map((rule) => rule.startsWith('pr:changed-path:') ? `CHANGED_PATH:${rule.slice(16)}` : rule.startsWith('pr:named-check:') ? `NAMED_CHECK:${rule.slice(15)}` : rule.startsWith('test:') ? 'NAMED_CHECK:ci/test' : 'UNSUPPORTED')];
      if (!evidence.every((rule) => ['PR', 'CHANGED_PATH', 'NAMED_CHECK', 'BASE_BRANCH'].some((allowed) => rule === allowed || rule.startsWith(`${allowed}:`)))) throw Object.assign(new Error('Unsupported evidence rule'), { code: 'EVIDENCE_RULE_UNSUPPORTED' });
      return { id: String(task.id), title: String(task.title), state: (index === 0 ? 'READY' : 'LOCKED') as 'READY' | 'LOCKED', required: true, milestoneId: String(task.milestoneId), prerequisiteIds: task.prerequisiteIds as string[], purpose: String(task.purpose), acceptanceCriteria: task.acceptanceCriteria as string[], evidenceRequirements: evidence };
    }).map((task, index, result) => { if (index === result.length - 1 && [...gapIds].some((id) => !covered.has(id))) throw new AiContractInvalidError('$.result.artifact.tasks.uncoveredGaps'); return task; });
  }

  private async ai(operation: WorkflowOperation, signal: AbortSignal, permission: 'EXTRACT' | 'INTERPRET' | 'PROPOSE' | 'COMPILE', path: string, schema: keyof typeof AI_V1_SCHEMAS, input: Record<string, unknown>) {
    let response: Response;
    try { response = await fetch(new URL(path, this.config.getOrThrow<string>('AI_SERVICE_URL')), { method: 'POST', headers: { authorization: `Bearer ${this.tokens.issueInternal(operation.ownerId, permission)}`, 'content-type': 'application/json', 'x-request-id': operation.id }, body: JSON.stringify({ schemaVersion: 1, operationId: operation.id, ...input }), signal }); }
    catch { throw new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', 'AI request failed'); }
    if (!response.ok) throw new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', 'AI request failed');
    const value = await response.json() as Record<string, unknown>;
    const validation = validateJsonSchema(AI_V1_SCHEMAS[schema] as Record<string, unknown>, value);
    if (!validation.valid || value.operationId !== operation.id) throw Object.assign(new AiContractInvalidError(`${validation.path ?? '$.operationId'} | ${JSON.stringify(value).slice(0, 900)}`), {});
    return value;
  }

  private qualifyProposals(
    value: Array<Record<string, unknown>> | undefined,
    catalog: ProjectBlueprintVersion[],
    gapIds: Set<string>,
    citationIds: Set<string>,
  ): Array<{ payload: Record<string, unknown>; blueprint: ProjectBlueprintVersion }> {
    if (!Array.isArray(value) || value.length !== 3) this.proposalShortfall();
    const proposalIds = new Set<string>();
    const blueprintRefs = new Set<string>();
    const coveredGaps = new Set<string>();
    const catalogByRef = new Map(catalog.map((entry) => [`${entry.blueprintKey}@${entry.version}`, entry]));
    const qualified = value.map((payload) => {
      const proposalId = typeof payload.id === 'string' ? payload.id : '';
      const blueprintKey = typeof payload.projectBlueprintId === 'string' ? payload.projectBlueprintId : '';
      const blueprintVersion = Number(payload.projectBlueprintVersion);
      const blueprintRef = `${blueprintKey}@${blueprintVersion}`;
      const blueprint = catalogByRef.get(blueprintRef);
      const gaps = Array.isArray(payload.citedGapIds) ? payload.citedGapIds : [];
      const citations = Array.isArray(payload.citationIds) ? payload.citationIds : [];
      const rejectionReasons = Array.isArray(payload.rejectionReasons) ? payload.rejectionReasons : [];
      if (!proposalId || proposalIds.has(proposalId) || blueprintRefs.has(blueprintRef) || !blueprint || rejectionReasons.length > 0 || citations.length === 0 || !gaps.every((id) => typeof id === 'string' && gapIds.has(id)) || !citations.every((id) => typeof id === 'string' && citationIds.has(id))) this.proposalShortfall();
      proposalIds.add(proposalId); blueprintRefs.add(blueprintRef);
      gaps.forEach((id) => coveredGaps.add(String(id)));
      return { payload, blueprint };
    });
    if (proposalIds.size !== 3 || blueprintRefs.size !== 3 || [...gapIds].some((id) => !coveredGaps.has(id))) this.proposalShortfall();
    return qualified;
  }

  private proposalShortfall(): never {
    throw Object.assign(new Error('Exactly three distinct eligible proposals are required'), { code: 'INSUFFICIENT_QUALIFIED_PROPOSALS' });
  }

  private async complete(
    claimed: WorkflowOperation,
    signal: AbortSignal,
    createDomainResult: (manager: EntityManager) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const operations = manager.getRepository(WorkflowOperation);
      const operation = await operations.findOne({ where: { id: claimed.id }, lock: { mode: 'pessimistic_write' } });
      this.assertCompletionFence(operation, claimed);
      if (signal.aborted) throw Object.assign(new Error('Workflow completion was cancelled'), { code: 'SNAPSHOT_STALE' });
      if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') throw Object.assign(new Error('Project Runs disabled'), { code: 'SNAPSHOT_STALE' });
      const entitlement = await manager.getRepository(ProjectFeatureEntitlement).findOne({
        where: [
          { userId: claimed.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
          { userId: claimed.ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
        ],
        lock: { mode: 'pessimistic_read' },
      });
      if (!entitlement) throw Object.assign(new Error('Project Run entitlement expired'), { code: 'SNAPSHOT_STALE' });
      const result = await createDomainResult(manager);
      await this.injectFault?.('AFTER_DOMAIN');
      this.assertCompletionFence(operation, claimed);
      if (signal.aborted) throw Object.assign(new Error('Workflow completion was cancelled'), { code: 'SNAPSHOT_STALE' });
      if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true' || !entitlement.enabled || (entitlement.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) <= Date.now()) throw Object.assign(new Error('Project Run entitlement fence is stale'), { code: 'SNAPSHOT_STALE' });
      const resource = result.resource;
      if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new Error('Career workflow result has no resource metadata');
      const metadata = resource as Record<string, unknown>;
      if (typeof metadata.resourceType !== 'string' || typeof metadata.resourceId !== 'string' || typeof metadata.resourceHref !== 'string') throw new Error('Career workflow result metadata is invalid');
      const results = manager.getRepository(WorkflowOperationResult);
      await results.save(results.create({ operationId: operation.id, value: result }));
      await this.injectFault?.('AFTER_RESULT');
      operation.state = WorkflowOperationState.Succeeded;
      operation.version += 1;
      operation.completedAt = new Date();
      operation.leaseOwner = null;
      operation.leaseExpiresAt = null;
      operation.heartbeatAt = null;
      operation.resultType = metadata.resourceType;
      operation.resultId = metadata.resourceId;
      operation.resultHref = metadata.resourceHref;
      operation.resultSchemaVersion = 1;
      operation.errorCode = null;
      operation.errorMessage = null;
      operation.failureClass = null;
      await operations.save(operation);
      return result;
    });
  }

  private assertCompletionFence(current: WorkflowOperation | null, claimed: WorkflowOperation): asserts current is WorkflowOperation {
    if (!current || current.ownerId !== claimed.ownerId || current.kind !== claimed.kind || current.version !== claimed.version || current.state !== WorkflowOperationState.Running || !claimed.leaseOwner || current.leaseOwner !== claimed.leaseOwner || !current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= Date.now()) {
      throw Object.assign(new Error('Workflow completion fence is stale'), { code: 'SNAPSHOT_STALE' });
    }
  }

  private resource(type: string, id: string, href: string, extra: Record<string, unknown> = {}) { return { ...extra, resource: { resourceType: type, resourceId: id, resourceHref: href } }; }
}
