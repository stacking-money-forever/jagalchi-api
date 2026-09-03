import { createHash } from 'node:crypto';

import { VerificationProviderError } from './verification-provider.errors';
import type {
  MachineProofResult,
  PullRequestFacts,
  RepositoryBindingFacts,
  TaskEvidenceEvaluation,
  TaskEvidenceEvaluatorPort,
  TaskEvidenceRule,
  VerificationFence,
} from './verification-provider.types';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[0-9a-f]{40}$/;
const CHECK_CONCLUSIONS = new Set([
  'SUCCESS', 'FAILURE', 'PENDING', 'CANCELLED', 'SKIPPED',
  'TIMED_OUT', 'ACTION_REQUIRED', 'NEUTRAL', 'STALE',
]);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

export function verificationFactsDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value));
}

function pathMatches(glob: string, path: string): boolean {
  const escaped = glob
    .split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('\0')
    .split('*').join('[^/]*')
    .split('\0').join('.*');
  return new RegExp(`^${escaped}$`, 'u').test(path);
}

export function assertRepositoryBindingFacts(facts: RepositoryBindingFacts): void {
  const { factsDigest, ...unsignedFacts } = facts;
  if (
    facts.schemaVersion !== 1 || !['fixture', 'github'].includes(facts.provider) ||
    !facts.repositoryId || facts.repositoryId.length > 100 ||
    !/^[^/\s]{1,100}\/[^/\s]{1,100}$/.test(facts.fullName) ||
    typeof facts.private !== 'boolean' || !facts.defaultBranch || facts.defaultBranch.length > 255 ||
    !validTimestamp(facts.observedAt) || !/^[0-9a-f]{64}$/.test(factsDigest) ||
    verificationFactsDigest(unsignedFacts) !== factsDigest
  ) throw new VerificationProviderError('VERIFICATION_FACTS_INVALID');
}

export function assertPullRequestFacts(facts: PullRequestFacts): void {
  const { factsDigest, ...unsignedFacts } = facts;
  if (
    facts.schemaVersion !== 1 || !['fixture', 'github'].includes(facts.provider) ||
    !facts.repositoryId || facts.repositoryId.length > 100 ||
    !Number.isSafeInteger(facts.pullNumber) || facts.pullNumber < 1 ||
    !SHA.test(facts.headSha) || !facts.baseBranch || facts.baseBranch.length > 255 ||
    !['OPEN', 'CLOSED', 'MERGED'].includes(facts.state) ||
    (facts.state === 'MERGED' ? !validTimestamp(facts.mergedAt) : facts.mergedAt !== null) ||
    !validTimestamp(facts.observedAt) || facts.changedPaths.length > 3_000 ||
    facts.changedPaths.some((path) => !path || path.length > 500 || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) ||
    new Set(facts.changedPaths).size !== facts.changedPaths.length ||
    facts.namedChecks.length > 100 ||
    facts.namedChecks.some(({ context, conclusion, completedAt }) =>
      !context || context.length > 200 || !CHECK_CONCLUSIONS.has(conclusion) ||
      !(completedAt === null || validTimestamp(completedAt))) ||
    new Set(facts.namedChecks.map(({ context }) => context)).size !== facts.namedChecks.length ||
    !/^[0-9a-f]{64}$/.test(factsDigest) ||
    verificationFactsDigest(unsignedFacts) !== factsDigest
  ) throw new VerificationProviderError('VERIFICATION_FACTS_INVALID');
}

function validateRule(rule: TaskEvidenceRule): void {
  if (!ID.test(rule.id)) throw new VerificationProviderError('VERIFICATION_RULE_UNSUPPORTED');
  if (rule.type === 'MERGED_PR') return;
  if (rule.type === 'BASE_BRANCH' && rule.branch.length > 0 && rule.branch.length <= 255) return;
  if (
    rule.type === 'CHANGED_PATH' && rule.glob.length > 0 && rule.glob.length <= 500 &&
    !rule.glob.startsWith('/') && !rule.glob.includes('\\') && !rule.glob.split('/').includes('..')
  ) return;
  if (rule.type === 'NAMED_CHECK' && rule.context.length > 0 && rule.context.length <= 200) return;
  throw new VerificationProviderError('VERIFICATION_RULE_UNSUPPORTED');
}

export class DeterministicTaskEvidenceEvaluator implements TaskEvidenceEvaluatorPort {
  evaluate(
    facts: PullRequestFacts,
    rules: readonly TaskEvidenceRule[],
    fence: VerificationFence,
  ): MachineProofResult {
    assertPullRequestFacts(facts);
    if (
      !rules.length || new Set(rules.map(({ id }) => id)).size !== rules.length ||
      !Number.isSafeInteger(fence.bindingVersion) || fence.bindingVersion < 1 ||
      !Number.isSafeInteger(fence.criteriaVersion) || fence.criteriaVersion < 1 ||
      !SHA.test(fence.expectedHeadSha)
    ) throw new VerificationProviderError('VERIFICATION_RULE_UNSUPPORTED');
    if (facts.headSha !== fence.expectedHeadSha) {
      throw new VerificationProviderError('VERIFICATION_PROVIDER_DRIFTED');
    }
    const evaluations = rules.map((rule): TaskEvidenceEvaluation => {
      validateRule(rule);
      if (rule.type === 'MERGED_PR') {
        const passed = facts.state === 'MERGED';
        return { ruleId: rule.id, type: rule.type, passed, code: passed ? 'PASS' : 'PR_NOT_MERGED' };
      }
      if (rule.type === 'BASE_BRANCH') {
        const passed = facts.baseBranch === rule.branch;
        return { ruleId: rule.id, type: rule.type, passed, code: passed ? 'PASS' : 'BASE_BRANCH_MISMATCH' };
      }
      if (rule.type === 'CHANGED_PATH') {
        const passed = facts.changedPaths.some((path) => pathMatches(rule.glob, path));
        return { ruleId: rule.id, type: rule.type, passed, code: passed ? 'PASS' : 'CHANGED_PATH_MISSING' };
      }
      if (rule.type === 'NAMED_CHECK') {
        const check = facts.namedChecks.find(({ context }) => context === rule.context);
        const passed = check?.conclusion === 'SUCCESS';
        return {
          ruleId: rule.id, type: rule.type, passed,
          code: passed ? 'PASS' : check ? 'NAMED_CHECK_NOT_SUCCESSFUL' : 'NAMED_CHECK_MISSING',
        };
      }
      throw new VerificationProviderError('VERIFICATION_RULE_UNSUPPORTED');
    });
    const proofWithoutDigest = {
      schemaVersion: 1 as const,
      provider: facts.provider,
      status: evaluations.every(({ passed }) => passed) ? 'PASS' as const : 'FAIL' as const,
      repositoryId: facts.repositoryId,
      pullNumber: facts.pullNumber,
      headSha: facts.headSha,
      fence: { ...fence },
      evaluations,
      observedAt: facts.observedAt,
    };
    return { ...proofWithoutDigest, factsDigest: verificationFactsDigest(proofWithoutDigest) };
  }
}
