import { ProjectRunState, type ProjectRunProjection, type ProjectTaskState } from './project-run.entity';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_STATES = new Set<ProjectTaskState>(['LOCKED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DEFERRED', 'VERIFYING', 'DONE']);
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

export function isProjectRunProjection(value: unknown): value is ProjectRunProjection {
  if (!record(value) || !(exact(value, ['id', 'state', 'version', 'currentTaskId', 'recommendedTaskId', 'plan', 'map', 'tasks', 'proof']) || exact(value, ['id', 'state', 'version', 'target', 'currentTaskId', 'recommendedTaskId', 'plan', 'map', 'tasks', 'proof']))) return false;
  if (typeof value.id !== 'string' || !UUID.test(value.id) || !Object.values(ProjectRunState).includes(value.state as ProjectRunState) || !Number.isInteger(value.version) || Number(value.version) < 1 || !nullableId(value.currentTaskId) || !nullableId(value.recommendedTaskId)) return false;
  if (value.target !== undefined && (!record(value.target) || !exact(value.target, ['company', 'role']) || typeof value.target.company !== 'string' || !value.target.company || value.target.company.length > 100 || typeof value.target.role !== 'string' || !value.target.role || value.target.role.length > 120)) return false;
  if (!record(value.plan) || !exact(value.plan, ['id', 'schemaVersion']) || !id(value.plan.id) || !Number.isInteger(value.plan.schemaVersion) || Number(value.plan.schemaVersion) < 1) return false;
  if (!record(value.map) || !exact(value.map, ['nodes', 'edges']) || !Array.isArray(value.map.nodes) || value.map.nodes.length > 40 || !Array.isArray(value.map.edges) || value.map.edges.length > 120) return false;
  if (!Array.isArray(value.tasks) || value.tasks.length > 40) return false;
  const taskIds = new Set<string>();
  for (const item of value.tasks) {
    if (!record(item) || !(exact(item, ['id', 'title', 'state', 'required', 'milestoneId', 'prerequisiteIds', 'purpose', 'acceptanceCriteria', 'evidenceRequirements']) || exact(item, ['id', 'title', 'state', 'required', 'milestoneId', 'prerequisiteIds', 'purpose', 'acceptanceCriteria', 'evidenceRequirements', 'verificationFailure']))) return false;
    if (!id(item.id) || taskIds.has(item.id) || typeof item.title !== 'string' || item.title.length < 1 || item.title.length > 300 || !TASK_STATES.has(item.state as ProjectTaskState) || typeof item.required !== 'boolean' || !nullableId(item.milestoneId) || !Array.isArray(item.prerequisiteIds) || item.prerequisiteIds.length > 3 || !item.prerequisiteIds.every(id) || typeof item.purpose !== 'string' || item.purpose.length > 2000 || !strings(item.acceptanceCriteria, 20) || !strings(item.evidenceRequirements, 20)) return false;
    taskIds.add(item.id);
    if (item.verificationFailure !== undefined && item.verificationFailure !== null && (!record(item.verificationFailure) || !exact(item.verificationFailure, ['code', 'note']) || !id(item.verificationFailure.code) || !(item.verificationFailure.note === null || (typeof item.verificationFailure.note === 'string' && item.verificationFailure.note.length <= 1000)))) return false;
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
  if (!record(value.proof) || !(exact(value.proof, ['summary', 'validUntil', 'publication', 'verification']) || exact(value.proof, ['summary', 'validUntil', 'publication', 'verification', 'facts'])) || typeof value.proof.summary !== 'string' || value.proof.summary.length > 2000 || !(value.proof.validUntil === null || iso(value.proof.validUntil))) return false;
  const publication = value.proof.publication;
  const verification = value.proof.verification;
  const baseValid = record(publication) && exact(publication, ['state', 'publicId']) && ['ACTIVE', 'UNPUBLISHED', 'INVALIDATED'].includes(String(publication.state)) && nullableId(publication.publicId)
    && record(verification) && exact(verification, ['state', 'verifiedAt']) && ['PENDING', 'PASS', 'FAIL', 'STALE'].includes(String(verification.state)) && (verification.verifiedAt === null || iso(verification.verifiedAt));
  if (!baseValid || value.proof.facts === undefined) return baseValid;
  const facts = value.proof.facts;
  return record(facts) && exact(facts, ['snapshotId', 'verificationLevel', 'provider', 'repositoryId', 'pullNumber', 'headSha', 'observedAt', 'evaluations'])
    && typeof facts.snapshotId === 'string' && UUID.test(facts.snapshotId) && ['MACHINE_VERIFIED', 'INDEPENDENTLY_REVIEWED'].includes(String(facts.verificationLevel))
    && ['fixture', 'github'].includes(String(facts.provider)) && typeof facts.repositoryId === 'string' && /^[1-9]\d{0,19}$/.test(facts.repositoryId)
    && Number.isInteger(facts.pullNumber) && Number(facts.pullNumber) > 0 && typeof facts.headSha === 'string' && /^[0-9a-f]{40}$/.test(facts.headSha) && iso(facts.observedAt)
    && Array.isArray(facts.evaluations) && facts.evaluations.length <= 20 && facts.evaluations.every((evaluation) => record(evaluation) && exact(evaluation, ['ruleId', 'type', 'passed', 'code']) && id(evaluation.ruleId) && ['MERGED_PR', 'BASE_BRANCH', 'CHANGED_PATH', 'NAMED_CHECK'].includes(String(evaluation.type)) && typeof evaluation.passed === 'boolean' && id(evaluation.code));
}

export function assertProjectRunProjection(value: unknown): asserts value is ProjectRunProjection {
  if (!isProjectRunProjection(value)) throw new Error('ProjectRun projection violates the closed v1 contract');
}
