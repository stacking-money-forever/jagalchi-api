import { ProjectRunState, type ProjectRunProjection, type ProjectTaskState } from './project-run.entity';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_STATES = new Set<ProjectTaskState>(['LOCKED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DEFERRED', 'VERIFYING', 'DONE']);
const ROOT_REQUIRED = ['id', 'state', 'version', 'currentTaskId', 'recommendedTaskId', 'plan', 'map', 'tasks', 'proof'] as const;
const ROOT_OPTIONAL = ['updatedAt', 'target', 'citations', 'gaps', 'repositoryBinding', 'pendingOperation', 'milestones', 'eligibleReadyTaskIds'] as const;
const TASK_REQUIRED = ['id', 'title', 'state', 'required', 'milestoneId', 'prerequisiteIds', 'purpose', 'acceptanceCriteria', 'evidenceRequirements'] as const;
const TASK_OPTIONAL = ['citationIds', 'gapIds', 'verificationFailure'] as const;
const FACTS_REQUIRED = ['snapshotId', 'verificationLevel', 'provider', 'repositoryId', 'pullNumber', 'headSha', 'observedAt', 'evaluations'] as const;
const FACTS_OPTIONAL = ['repositoryName', 'taskKey', 'taskKeys', 'citationIds', 'pullUrl'] as const;

const exact = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const nullableId = (value: unknown): boolean => value === null || id(value);
const strings = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 1000);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const iso = (value: unknown): boolean => typeof value === 'string' && RFC3339.test(value) && !Number.isNaN(Date.parse(value));
const isRootShape = (value: Record<string, unknown>): boolean => {
  const keys = Object.keys(value);
  if (!ROOT_REQUIRED.every((key) => keys.includes(key))) return false;
  return keys.every((key) => ROOT_REQUIRED.includes(key as typeof ROOT_REQUIRED[number]) || ROOT_OPTIONAL.includes(key as typeof ROOT_OPTIONAL[number]));
};

const isTaskShape = (item: Record<string, unknown>): boolean => {
  const keys = Object.keys(item);
  if (!TASK_REQUIRED.every((key) => keys.includes(key))) return false;
  return keys.every((key) => TASK_REQUIRED.includes(key as typeof TASK_REQUIRED[number]) || TASK_OPTIONAL.includes(key as typeof TASK_OPTIONAL[number]));
};

const isCitation = (value: unknown): boolean => record(value) && exact(value, ['id', 'label', 'quote']) && id(value.id) && typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 300 && (value.quote === null || (typeof value.quote === 'string' && value.quote.length <= 2000));
const isReceipt = (value: unknown): boolean => record(value) && exact(value, ['provider', 'model', 'promptVersion', 'inputHash', 'generatedAt'])
  && typeof value.provider === 'string' && value.provider.length > 0 && value.provider.length <= 80
  && typeof value.model === 'string' && value.model.length > 0 && value.model.length <= 160
  && typeof value.promptVersion === 'string' && value.promptVersion.length > 0 && value.promptVersion.length <= 80
  && typeof value.inputHash === 'string' && /^[0-9a-f]{64}$/.test(value.inputHash)
  && iso(value.generatedAt);
const isPlanProvenance = (value: unknown): boolean => {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length || keys.length > 2) return false;
  if (!keys.every((key) => ['compileReceipt', 'proposalReceipt'].includes(key))) return false;
  if (value.compileReceipt !== undefined && !isReceipt(value.compileReceipt)) return false;
  if (value.proposalReceipt !== undefined && !isReceipt(value.proposalReceipt)) return false;
  return !!(value.compileReceipt || value.proposalReceipt);
};
const isMilestone = (value: unknown): boolean => record(value) && exact(value, ['id', 'title']) && id(value.id) && typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 300;
const isGap = (value: unknown): boolean => record(value) && exact(value, ['id', 'description']) && id(value.id) && typeof value.description === 'string' && value.description.length > 0 && value.description.length <= 2000;

const isPendingOperation = (value: unknown): boolean => record(value) && exact(value, ['id', 'kind'])
  && typeof value.id === 'string' && UUID.test(value.id)
  && ['TASK_VERIFICATION', 'PROOF_REVERIFICATION', 'PULL_REQUEST_BINDING'].includes(String(value.kind));

const isRepositoryBinding = (value: unknown): boolean => record(value) && exact(value, ['githubRepositoryId', 'repositoryName', 'pullNumber', 'headSha', 'pullUrl']) && typeof value.githubRepositoryId === 'string' && /^[1-9]\d{0,19}$/.test(value.githubRepositoryId)
  && (value.repositoryName === null || (typeof value.repositoryName === 'string' && value.repositoryName.length > 0 && value.repositoryName.length <= 255))
  && (value.pullNumber === null || (Number.isInteger(value.pullNumber) && Number(value.pullNumber) > 0))
  && (value.headSha === null || (typeof value.headSha === 'string' && /^[0-9a-f]{40}$/.test(value.headSha)))
  && (value.pullUrl === null || (typeof value.pullUrl === 'string' && value.pullUrl.length <= 500));

const isFactsShape = (facts: Record<string, unknown>): boolean => {
  const keys = Object.keys(facts);
  if (!FACTS_REQUIRED.every((key) => keys.includes(key))) return false;
  return keys.every((key) => FACTS_REQUIRED.includes(key as typeof FACTS_REQUIRED[number]) || FACTS_OPTIONAL.includes(key as typeof FACTS_OPTIONAL[number]));
};

export function isProjectRunProjection(value: unknown): value is ProjectRunProjection {
  if (!record(value) || !isRootShape(value)) return false;
  if (typeof value.id !== 'string' || !UUID.test(value.id) || !Object.values(ProjectRunState).includes(value.state as ProjectRunState) || !Number.isInteger(value.version) || Number(value.version) < 1 || !nullableId(value.currentTaskId) || !nullableId(value.recommendedTaskId)) return false;
  if (value.updatedAt !== undefined && !iso(value.updatedAt)) return false;
  if (value.target !== undefined && (!record(value.target) || !exact(value.target, ['company', 'role']) || typeof value.target.company !== 'string' || !value.target.company || value.target.company.length > 100 || typeof value.target.role !== 'string' || !value.target.role || value.target.role.length > 120)) return false;
  if (value.citations !== undefined && (!Array.isArray(value.citations) || value.citations.length > 40 || !value.citations.every(isCitation))) return false;
  if (value.gaps !== undefined && (!Array.isArray(value.gaps) || value.gaps.length > 40 || !value.gaps.every(isGap))) return false;
  const citationIds = new Set(
    Array.isArray(value.citations)
      ? value.citations.map((citation) => record(citation) && typeof citation.id === 'string' ? citation.id : '')
      : [],
  );
  const gapIds = new Set(
    Array.isArray(value.gaps)
      ? value.gaps.map((gap) => record(gap) && typeof gap.id === 'string' ? gap.id : '')
      : [],
  );
  if (value.repositoryBinding !== undefined && !isRepositoryBinding(value.repositoryBinding)) return false;
  if (value.pendingOperation !== undefined && !isPendingOperation(value.pendingOperation)) return false;
  if (!record(value.plan) || !id(value.plan.id) || !Number.isInteger(value.plan.schemaVersion) || Number(value.plan.schemaVersion) < 1) return false;
  const planKeys = Object.keys(value.plan);
  if (!planKeys.includes('id') || !planKeys.includes('schemaVersion') || !planKeys.every((key) => ['id', 'schemaVersion', 'provenance'].includes(key))) return false;
  if (value.plan.provenance !== undefined && !isPlanProvenance(value.plan.provenance)) return false;
  if (value.milestones !== undefined && (!Array.isArray(value.milestones) || value.milestones.length > 8 || !value.milestones.every(isMilestone))) return false;
  if (!record(value.map) || !exact(value.map, ['nodes', 'edges']) || !Array.isArray(value.map.nodes) || value.map.nodes.length > 40 || !Array.isArray(value.map.edges) || value.map.edges.length > 120) return false;
  if (!Array.isArray(value.tasks) || value.tasks.length > 40) return false;
  const taskIds = new Set<string>();
  const readyTaskIds = new Set<string>();
  for (const item of value.tasks) {
    if (!record(item) || !isTaskShape(item)) return false;
    if (!id(item.id) || taskIds.has(item.id) || typeof item.title !== 'string' || item.title.length < 1 || item.title.length > 300 || !TASK_STATES.has(item.state as ProjectTaskState) || typeof item.required !== 'boolean' || !nullableId(item.milestoneId) || !Array.isArray(item.prerequisiteIds) || item.prerequisiteIds.length > 3 || !item.prerequisiteIds.every(id) || typeof item.purpose !== 'string' || item.purpose.length > 2000 || !strings(item.acceptanceCriteria, 20) || !strings(item.evidenceRequirements, 20)) return false;
    if (item.citationIds !== undefined && (!strings(item.citationIds, 20) || item.citationIds.some((citationId) => !citationIds.has(citationId)))) return false;
    if (item.gapIds !== undefined && (!strings(item.gapIds, 20) || item.gapIds.some((gapId) => !gapIds.has(gapId)))) return false;
    taskIds.add(item.id);
    if (item.state === 'READY') readyTaskIds.add(item.id);
    if (item.verificationFailure !== undefined && item.verificationFailure !== null && (!record(item.verificationFailure) || !exact(item.verificationFailure, ['code', 'note']) || !id(item.verificationFailure.code) || !(item.verificationFailure.note === null || (typeof item.verificationFailure.note === 'string' && item.verificationFailure.note.length <= 1000)))) return false;
  }
  if (value.eligibleReadyTaskIds !== undefined) {
    const eligible = value.eligibleReadyTaskIds;
    if (!Array.isArray(eligible) || eligible.length > 40 || new Set(eligible).size !== eligible.length || !eligible.every((taskId) => typeof taskId === 'string' && readyTaskIds.has(taskId))) return false;
    if (value.recommendedTaskId !== (eligible[0] ?? null)) return false;
  }
  const nodeIds = new Set<string>();
  for (const node of value.map.nodes) {
    if (!record(node) || !exact(node, ['id', 'title', 'milestoneId', 'state']) || !id(node.id) || typeof node.title !== 'string' || node.title.length < 1 || node.title.length > 300 || !nullableId(node.milestoneId) || !TASK_STATES.has(node.state as ProjectTaskState)) return false;
    nodeIds.add(node.id);
  }
  for (const edge of value.map.edges) {
    if (!record(edge) || !exact(edge, ['id', 'source', 'target', 'kind']) || !id(edge.id) || !id(edge.source) || !id(edge.target) || !['PREREQUISITE', 'SEQUENCE'].includes(String(edge.kind))) return false;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
  }
  if (
    [...taskIds].some((taskId) => !nodeIds.has(taskId)) ||
    value.tasks.some((task) => (task.prerequisiteIds as string[]).some((prerequisiteId) => !taskIds.has(prerequisiteId)))
  ) return false;
  if ((typeof value.currentTaskId === 'string' && !taskIds.has(value.currentTaskId)) || (typeof value.recommendedTaskId === 'string' && !taskIds.has(value.recommendedTaskId))) return false;
  if (value.proof === null) return true;
  if (!record(value.proof)) return false;
  const proof = value.proof;
  const proofKeys = Object.keys(proof);
  const proofAllowed = new Set(['summary', 'validUntil', 'publication', 'verification', 'facts', 'failedCriteria']);
  if (!proofKeys.every((key) => proofAllowed.has(key)) || !['summary', 'validUntil', 'publication', 'verification'].every((key) => proofKeys.includes(key)) || typeof proof.summary !== 'string' || proof.summary.length > 2000 || !(proof.validUntil === null || iso(proof.validUntil))) return false;
  const publication = proof.publication;
  const verification = proof.verification;
  if (!record(publication) || !record(verification)) return false;
  const publicationKeys = Object.keys(publication);
  const publicationShape = publicationKeys.length === 2 ? ['state', 'publicId'] : publicationKeys.length === 3 && publicationKeys.includes('supersededSnapshotId') ? ['publicId', 'state', 'supersededSnapshotId'] : null;
  const baseValid = record(publication) && publicationShape && publicationKeys.sort().join() === [...publicationShape].sort().join() && ['ACTIVE', 'UNPUBLISHED', 'INVALIDATED'].includes(String(publication.state)) && nullableId(publication.publicId) && (!('supersededSnapshotId' in publication) || publication.supersededSnapshotId === null || (typeof publication.supersededSnapshotId === 'string' && UUID.test(publication.supersededSnapshotId)))
    && record(verification) && exact(verification, ['state', 'verifiedAt']) && ['PENDING', 'PASS', 'FAIL', 'STALE'].includes(String(verification.state)) && (verification.verifiedAt === null || iso(verification.verifiedAt));
  if (!baseValid) return false;
  if (proof.failedCriteria !== undefined) {
    const failed = proof.failedCriteria;
    if (!Array.isArray(failed) || failed.length > 20 || !failed.every((item) => record(item) && exact(item, ['ruleId', 'type', 'code']) && id(item.ruleId) && ['MERGED_PR', 'BASE_BRANCH', 'CHANGED_PATH', 'NAMED_CHECK'].includes(String(item.type)) && id(item.code))) return false;
  }
  if (proof.facts === undefined) return true;
  const facts = proof.facts;
  if (!record(facts) || !isFactsShape(facts)) return false;
  if (typeof facts.snapshotId !== 'string' || !UUID.test(facts.snapshotId) || !['MACHINE_VERIFIED', 'INDEPENDENTLY_REVIEWED'].includes(String(facts.verificationLevel))
    || !['fixture', 'github'].includes(String(facts.provider)) || typeof facts.repositoryId !== 'string' || !/^[1-9]\d{0,19}$/.test(facts.repositoryId)
    || !Number.isInteger(facts.pullNumber) || Number(facts.pullNumber) <= 0 || typeof facts.headSha !== 'string' || !/^[0-9a-f]{40}$/.test(facts.headSha) || !iso(facts.observedAt)) return false;
  if (facts.repositoryName !== undefined && (typeof facts.repositoryName !== 'string' || facts.repositoryName.length === 0 || facts.repositoryName.length > 255)) return false;
  if (facts.taskKey !== undefined && facts.taskKey !== null && (!id(facts.taskKey) || !taskIds.has(facts.taskKey))) return false;
  if (facts.taskKeys !== undefined && (!Array.isArray(facts.taskKeys) || facts.taskKeys.length > 40 || new Set(facts.taskKeys).size !== facts.taskKeys.length || !facts.taskKeys.every((taskKey) => id(taskKey) && taskIds.has(taskKey)))) return false;
  if (facts.citationIds !== undefined && (!strings(facts.citationIds, 20) || facts.citationIds.some((citationId) => !citationIds.has(citationId)))) return false;
  if (facts.pullUrl !== undefined && facts.pullUrl !== null && (typeof facts.pullUrl !== 'string' || facts.pullUrl.length > 500)) return false;
  return Array.isArray(facts.evaluations) && facts.evaluations.length <= 20 && facts.evaluations.every((evaluation) => record(evaluation) && exact(evaluation, ['ruleId', 'type', 'passed', 'code']) && id(evaluation.ruleId) && ['MERGED_PR', 'BASE_BRANCH', 'CHANGED_PATH', 'NAMED_CHECK'].includes(String(evaluation.type)) && typeof evaluation.passed === 'boolean' && id(evaluation.code));
}

export function assertProjectRunProjection(value: unknown): asserts value is ProjectRunProjection {
  if (!isProjectRunProjection(value)) throw new Error('ProjectRun projection violates the closed v1 contract');
}
