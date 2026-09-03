import { describe, expect, it } from 'vitest';

import {
  FIXTURE_VERIFICATION_IDS,
  FixtureVerificationProvider,
} from './fixture-verification-provider';
import {
  DeterministicTaskEvidenceEvaluator,
  verificationFactsDigest,
} from './verification-evaluator';
import { VerificationProviderError } from './verification-provider.errors';
import type {
  PullRequestFacts,
  TaskEvidenceRule,
  TaskEvidenceEvaluatorPort,
  VerificationFence,
  VerificationInvalidationPort,
  VerificationProviderPort,
} from './verification-provider.types';

const bindingSelector = {
  ownerId: FIXTURE_VERIFICATION_IDS.ownerId,
  installationId: FIXTURE_VERIFICATION_IDS.installationId,
  repositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
};
const pullRequestSelector = {
  repositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
  pullNumber: FIXTURE_VERIFICATION_IDS.pullNumber,
};
const rules: readonly TaskEvidenceRule[] = [
  { id: 'merged', type: 'MERGED_PR' },
  { id: 'branch', type: 'BASE_BRANCH', branch: 'main' },
  { id: 'path', type: 'CHANGED_PATH', glob: 'src/**' },
  { id: 'check', type: 'NAMED_CHECK', context: 'ci/test' },
];
const fence = (expectedHeadSha = FIXTURE_VERIFICATION_IDS.initialHeadSha): VerificationFence => ({
  bindingVersion: 2,
  criteriaVersion: 3,
  expectedHeadSha,
});

function mutableFacts(value: PullRequestFacts): PullRequestFacts {
  return structuredClone(value);
}

function rehashFacts(value: PullRequestFacts): void {
  const { factsDigest, ...unsignedFacts } = value;
  void factsDigest;
  value.factsDigest = verificationFactsDigest(unsignedFacts);
}

describe('FixtureVerificationProvider', () => {
  it('implements the provider, evaluator, and invalidation ports without network input', () => {
    const subject = new FixtureVerificationProvider();
    const provider: VerificationProviderPort = subject;
    const evaluator: TaskEvidenceEvaluatorPort = subject;
    const invalidations: VerificationInvalidationPort = subject;
    expect(provider.provider).toBe('fixture');
    expect(evaluator).toBe(subject);
    expect(invalidations.takeInvalidationEvents()).toEqual([]);
  });

  it('returns deterministic immutable repository binding facts', async () => {
    const subject = new FixtureVerificationProvider('success');
    const first = await subject.resolveRepositoryBinding(bindingSelector);
    const second = await subject.resolveRepositoryBinding(bindingSelector);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      provider: 'fixture',
      repositoryId: FIXTURE_VERIFICATION_IDS.repositoryId,
      defaultBranch: 'main',
      private: true,
    });
    expect(first.factsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('produces a passing machine proof from merged/path/check facts', async () => {
    const subject = new FixtureVerificationProvider('success');
    const facts = await subject.getPullRequestFacts(pullRequestSelector);
    const first = subject.evaluate(facts, rules, fence());
    const second = subject.evaluate(facts, rules, fence());
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      status: 'PASS',
      headSha: FIXTURE_VERIFICATION_IDS.initialHeadSha,
      fence: { bindingVersion: 2, criteriaVersion: 3 },
    });
    expect(first.evaluations).toHaveLength(4);
    expect(first.evaluations.every(({ passed, code }) => passed && code === 'PASS')).toBe(true);
    expect(first.factsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(first.evaluations)).toBe(true);
  });

  it('returns closed evidence failures without turning fixture failure into provider error', async () => {
    const subject = new FixtureVerificationProvider('failure');
    const facts = await subject.getPullRequestFacts(pullRequestSelector);
    const proof = subject.evaluate(facts, rules, fence());
    expect(proof.status).toBe('FAIL');
    expect(proof.evaluations.map(({ code }) => code)).toEqual([
      'PR_NOT_MERGED',
      'PASS',
      'CHANGED_PATH_MISSING',
      'NAMED_CHECK_NOT_SUCCESSFUL',
    ]);
  });

  it('emits deterministic invalidations and fences stale head facts after drift', async () => {
    const subject = new FixtureVerificationProvider('drift');
    const original = await subject.getPullRequestFacts(pullRequestSelector);
    expect(subject.evaluate(original, rules, fence()).status).toBe('PASS');
    subject.advanceDrift();
    const events = subject.takeInvalidationEvents();
    expect(events.map(({ kind }) => kind)).toEqual([
      'PULL_REQUEST_HEAD_CHANGED',
      'NAMED_CHECK_CHANGED',
    ]);
    expect(events[0]).toMatchObject({
      headSha: FIXTURE_VERIFICATION_IDS.driftedHeadSha,
      invalidates: ['FACTS', 'VERIFICATION', 'MACHINE_PROOF'],
    });
    expect(Object.isFrozen(events)).toBe(true);
    expect(subject.takeInvalidationEvents()).toEqual([]);

    const changed = await subject.getPullRequestFacts(pullRequestSelector);
    expect(changed.headSha).toBe(FIXTURE_VERIFICATION_IDS.driftedHeadSha);
    expect(() => subject.evaluate(changed, rules, fence())).toThrow(
      expect.objectContaining({ code: 'VERIFICATION_PROVIDER_DRIFTED' }),
    );
    const changedFence = fence(FIXTURE_VERIFICATION_IDS.driftedHeadSha);
    expect(subject.evaluate(changed, rules, changedFence)).toMatchObject({
      status: 'FAIL',
      evaluations: expect.arrayContaining([
        expect.objectContaining({ ruleId: 'check', code: 'NAMED_CHECK_NOT_SUCCESSFUL' }),
      ]),
    });
  });

  it.each([
    [{ ...bindingSelector, installationId: 'private-installation' }, 'REPOSITORY_BINDING_NOT_FOUND'],
    [{ ...bindingSelector, repositoryId: 'private-repository' }, 'REPOSITORY_NOT_AUTHORIZED'],
  ])('fails binding with a redacted closed error %#', async (selector, code) => {
    const subject = new FixtureVerificationProvider();
    let caught: unknown;
    try {
      await subject.resolveRepositoryBinding(selector);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code });
    expect(String(caught)).not.toContain('private-');
    expect((caught as Error).cause).toBeUndefined();
  });

  it('distinguishes unauthorized repositories, absent pull requests, and provider outage', async () => {
    const subject = new FixtureVerificationProvider();
    await expect(
      subject.getPullRequestFacts({ ...pullRequestSelector, repositoryId: 'other' }),
    ).rejects.toMatchObject({ code: 'REPOSITORY_NOT_AUTHORIZED' });
    await expect(
      subject.getPullRequestFacts({ ...pullRequestSelector, pullNumber: 99 }),
    ).rejects.toMatchObject({ code: 'PULL_REQUEST_NOT_FOUND' });
    await expect(
      new FixtureVerificationProvider('unavailable').getPullRequestFacts(pullRequestSelector),
    ).rejects.toMatchObject({ code: 'VERIFICATION_PROVIDER_UNAVAILABLE' });
  });
});

describe('DeterministicTaskEvidenceEvaluator', () => {
  const evaluator = new DeterministicTaskEvidenceEvaluator();

  it('distinguishes a missing named check from an observed non-successful check', async () => {
    const facts = await new FixtureVerificationProvider('success').getPullRequestFacts(
      pullRequestSelector,
    );
    const missing = evaluator.evaluate(
      facts,
      [{ id: 'missing', type: 'NAMED_CHECK', context: 'ci/missing' }],
      fence(),
    );
    expect(missing.evaluations[0]?.code).toBe('NAMED_CHECK_MISSING');
    const pending = mutableFacts(facts);
    pending.namedChecks[0]!.conclusion = 'PENDING';
    rehashFacts(pending);
    expect(
      evaluator.evaluate(pending, [{ id: 'check', type: 'NAMED_CHECK', context: 'ci/test' }], fence())
        .evaluations[0]?.code,
    ).toBe('NAMED_CHECK_NOT_SUCCESSFUL');
  });

  it.each([
    (facts: PullRequestFacts) => { facts.headSha = 'not-a-sha'; },
    (facts: PullRequestFacts) => { facts.changedPaths = ['../secret']; },
    (facts: PullRequestFacts) => { facts.changedPaths = ['src/a.ts', 'src/a.ts']; },
    (facts: PullRequestFacts) => { facts.namedChecks.push({ ...facts.namedChecks[0]! }); },
    (facts: PullRequestFacts) => { facts.namedChecks[0]!.conclusion = 'UNKNOWN' as 'SUCCESS'; },
    (facts: PullRequestFacts) => { facts.observedAt = 'not-a-date'; },
    (facts: PullRequestFacts) => { facts.factsDigest = '0'.repeat(64); },
  ])('rejects malformed provider facts %#', async (mutate) => {
    const valid = await new FixtureVerificationProvider().getPullRequestFacts(pullRequestSelector);
    const facts = mutableFacts(valid);
    mutate(facts);
    expect(() => evaluator.evaluate(facts, rules, fence())).toThrow(
      expect.objectContaining({ code: 'VERIFICATION_FACTS_INVALID' }),
    );
  });

  it.each([
    { candidateRules: [] as TaskEvidenceRule[] },
    { candidateRules: [{ id: 'same', type: 'MERGED_PR' }, { id: 'same', type: 'MERGED_PR' }] as TaskEvidenceRule[] },
    { candidateRules: [{ id: 'bad id', type: 'MERGED_PR' }] as TaskEvidenceRule[] },
    { candidateRules: [{ id: 'path', type: 'CHANGED_PATH', glob: '../secret' }] as TaskEvidenceRule[] },
    { candidateRules: [{ id: 'unknown', type: 'HUMAN_CHECK' } as unknown as TaskEvidenceRule] },
  ])('rejects unsupported or ambiguous rule sets %#', async ({ candidateRules }) => {
    const facts = await new FixtureVerificationProvider().getPullRequestFacts(pullRequestSelector);
    expect(() => evaluator.evaluate(facts, candidateRules, fence())).toThrow(
      expect.objectContaining({ code: 'VERIFICATION_RULE_UNSUPPORTED' }),
    );
  });

  it('keeps public errors closed and free of provider details', () => {
    const error = new VerificationProviderError('VERIFICATION_PROVIDER_UNAVAILABLE');
    expect(error.message).toBe('The verification provider is unavailable.');
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('token');
  });
});
