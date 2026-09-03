import {
  DeterministicTaskEvidenceEvaluator,
  assertRepositoryBindingFacts,
  assertPullRequestFacts,
  verificationFactsDigest,
} from './verification-evaluator';
import { VerificationProviderError } from './verification-provider.errors';
import type {
  MachineProofResult,
  PullRequestFacts,
  PullRequestSelector,
  RepositoryBindingFacts,
  RepositorySelector,
  TaskEvidenceEvaluatorPort,
  TaskEvidenceRule,
  VerificationFence,
  VerificationInvalidationEvent,
  VerificationInvalidationPort,
  VerificationProviderPort,
} from './verification-provider.types';

export type FixtureVerificationScenario = 'success' | 'failure' | 'drift' | 'unavailable';

export const FIXTURE_VERIFICATION_IDS = Object.freeze({
  ownerId: 'fixture-owner',
  installationId: 'fixture-installation',
  repositoryId: '9000001',
  pullNumber: 17,
  initialHeadSha: 'a'.repeat(40),
  driftedHeadSha: 'b'.repeat(40),
});

const OBSERVED_AT = '2026-09-03T00:00:00.000Z';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function binding(): RepositoryBindingFacts {
  const facts = {
    schemaVersion: 1 as const,
    provider: 'fixture' as const,
    repositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
    fullName: 'fixture/verification-repository',
    private: true,
    defaultBranch: 'main',
    observedAt: OBSERVED_AT,
  };
  const result = { ...facts, factsDigest: verificationFactsDigest(facts) };
  assertRepositoryBindingFacts(result);
  return deepFreeze(result);
}

function pullRequestFacts(scenario: FixtureVerificationScenario, drifted: boolean): PullRequestFacts {
  const failed = scenario === 'failure';
  const changed = scenario === 'drift' && drifted;
  const facts = {
    schemaVersion: 1 as const,
    provider: 'fixture' as const,
    repositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
    pullNumber: FIXTURE_VERIFICATION_IDS.pullNumber,
    headSha: changed ? FIXTURE_VERIFICATION_IDS.driftedHeadSha : FIXTURE_VERIFICATION_IDS.initialHeadSha,
    baseBranch: 'main',
    state: failed ? 'OPEN' as const : 'MERGED' as const,
    mergedAt: failed ? null : OBSERVED_AT,
    changedPaths: failed ? ['docs/notes.md'] : ['src/core.ts', 'src/core.spec.ts'],
    namedChecks: [
      {
        context: 'ci/test',
        conclusion: failed ? 'FAILURE' as const : changed ? 'PENDING' as const : 'SUCCESS' as const,
        completedAt: changed ? null : OBSERVED_AT,
      },
    ],
    observedAt: OBSERVED_AT,
  };
  const result = { ...facts, factsDigest: verificationFactsDigest(facts) };
  assertPullRequestFacts(result);
  return deepFreeze(result);
}

export class FixtureVerificationProvider
implements VerificationProviderPort, TaskEvidenceEvaluatorPort, VerificationInvalidationPort {
  readonly provider = 'fixture' as const;
  private readonly evaluator = new DeterministicTaskEvidenceEvaluator();
  private drifted = false;
  private events: VerificationInvalidationEvent[] = [];

  constructor(readonly scenario: FixtureVerificationScenario = 'success') {}

  async resolveRepositoryBinding(selector: RepositorySelector): Promise<RepositoryBindingFacts> {
    this.requireAvailable();
    if (
      selector.ownerId !== FIXTURE_VERIFICATION_IDS.ownerId ||
      selector.installationId !== FIXTURE_VERIFICATION_IDS.installationId
    ) throw new VerificationProviderError('REPOSITORY_BINDING_NOT_FOUND');
    if (selector.repositoryId !== FIXTURE_VERIFICATION_IDS.repositoryId) {
      throw new VerificationProviderError('REPOSITORY_NOT_AUTHORIZED');
    }
    return binding();
  }

  async getPullRequestFacts(selector: PullRequestSelector): Promise<PullRequestFacts> {
    this.requireAvailable();
    if (selector.repositoryId !== FIXTURE_VERIFICATION_IDS.repositoryId) {
      throw new VerificationProviderError('REPOSITORY_NOT_AUTHORIZED');
    }
    if (selector.pullNumber !== FIXTURE_VERIFICATION_IDS.pullNumber) {
      throw new VerificationProviderError('PULL_REQUEST_NOT_FOUND');
    }
    return pullRequestFacts(this.scenario, this.drifted);
  }

  evaluate(
    facts: PullRequestFacts,
    rules: readonly TaskEvidenceRule[],
    fence: VerificationFence,
  ): MachineProofResult {
    this.requireAvailable();
    return deepFreeze(this.evaluator.evaluate(facts, rules, fence));
  }

  advanceDrift(): void {
    if (this.scenario !== 'drift' || this.drifted) return;
    this.drifted = true;
    this.events = [
      deepFreeze({
        schemaVersion: 1,
        provider: 'fixture',
        providerEventId: 'fixture-drift-head-1',
        kind: 'PULL_REQUEST_HEAD_CHANGED',
        repositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
        pullNumber: FIXTURE_VERIFICATION_IDS.pullNumber,
        headSha: FIXTURE_VERIFICATION_IDS.driftedHeadSha,
        invalidates: ['FACTS', 'VERIFICATION', 'MACHINE_PROOF'],
        observedAt: OBSERVED_AT,
      }),
      deepFreeze({
        schemaVersion: 1,
        provider: 'fixture',
        providerEventId: 'fixture-drift-check-1',
        kind: 'NAMED_CHECK_CHANGED',
        repositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
        pullNumber: FIXTURE_VERIFICATION_IDS.pullNumber,
        headSha: FIXTURE_VERIFICATION_IDS.driftedHeadSha,
        invalidates: ['VERIFICATION', 'MACHINE_PROOF'],
        observedAt: OBSERVED_AT,
      }),
    ];
  }

  takeInvalidationEvents(): readonly VerificationInvalidationEvent[] {
    const events = deepFreeze([...this.events]);
    this.events = [];
    return events;
  }

  private requireAvailable(): void {
    if (this.scenario === 'unavailable') {
      throw new VerificationProviderError('VERIFICATION_PROVIDER_UNAVAILABLE');
    }
  }
}
