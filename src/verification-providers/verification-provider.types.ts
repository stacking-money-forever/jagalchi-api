export type VerificationProviderName = 'fixture' | 'github';

export interface RepositorySelector {
  ownerId: string;
  installationId: string;
  repositoryId: string;
}

export interface RepositoryBindingFacts {
  schemaVersion: 1;
  provider: VerificationProviderName;
  repositoryId: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  observedAt: string;
  factsDigest: string;
}

export interface PullRequestSelector {
  repositoryId: string;
  pullNumber: number;
}

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type NamedCheckConclusion =
  | 'SUCCESS'
  | 'FAILURE'
  | 'PENDING'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'TIMED_OUT'
  | 'ACTION_REQUIRED'
  | 'NEUTRAL'
  | 'STALE';

export interface NamedCheckFact {
  context: string;
  conclusion: NamedCheckConclusion;
  completedAt: string | null;
}

export interface PullRequestFacts {
  schemaVersion: 1;
  provider: VerificationProviderName;
  repositoryId: string;
  pullNumber: number;
  headSha: string;
  baseBranch: string;
  state: PullRequestState;
  mergedAt: string | null;
  changedPaths: string[];
  namedChecks: NamedCheckFact[];
  observedAt: string;
  factsDigest: string;
}

export type TaskEvidenceRule =
  | { id: string; type: 'MERGED_PR' }
  | { id: string; type: 'BASE_BRANCH'; branch: string }
  | { id: string; type: 'CHANGED_PATH'; glob: string }
  | { id: string; type: 'NAMED_CHECK'; context: string };

export type EvidenceEvaluationCode =
  | 'PASS'
  | 'PR_NOT_MERGED'
  | 'BASE_BRANCH_MISMATCH'
  | 'CHANGED_PATH_MISSING'
  | 'NAMED_CHECK_MISSING'
  | 'NAMED_CHECK_NOT_SUCCESSFUL';

export interface TaskEvidenceEvaluation {
  ruleId: string;
  type: TaskEvidenceRule['type'];
  passed: boolean;
  code: EvidenceEvaluationCode;
}

export interface VerificationFence {
  bindingVersion: number;
  criteriaVersion: number;
  expectedHeadSha: string;
}

export interface MachineProofResult {
  schemaVersion: 1;
  provider: VerificationProviderName;
  status: 'PASS' | 'FAIL';
  repositoryId: string;
  pullNumber: number;
  headSha: string;
  fence: VerificationFence;
  evaluations: TaskEvidenceEvaluation[];
  observedAt: string;
  factsDigest: string;
}

export type VerificationInvalidationKind =
  | 'PULL_REQUEST_HEAD_CHANGED'
  | 'PULL_REQUEST_STATE_CHANGED'
  | 'NAMED_CHECK_CHANGED'
  | 'REPOSITORY_REMOVED'
  | 'INSTALLATION_SUSPENDED';

export interface VerificationInvalidationEvent {
  schemaVersion: 1;
  provider: VerificationProviderName;
  providerEventId: string;
  kind: VerificationInvalidationKind;
  repositoryId: string;
  pullNumber: number | null;
  headSha: string | null;
  invalidates: Array<'BINDING' | 'FACTS' | 'VERIFICATION' | 'MACHINE_PROOF'>;
  observedAt: string;
}

export interface VerificationProviderPort {
  readonly provider: VerificationProviderName;
  resolveRepositoryBinding(selector: RepositorySelector): Promise<RepositoryBindingFacts>;
  getPullRequestFacts(selector: PullRequestSelector): Promise<PullRequestFacts>;
}

export interface TaskEvidenceEvaluatorPort {
  evaluate(
    facts: PullRequestFacts,
    rules: readonly TaskEvidenceRule[],
    fence: VerificationFence,
  ): MachineProofResult;
}

export interface VerificationInvalidationPort {
  takeInvalidationEvents(): readonly VerificationInvalidationEvent[];
}
