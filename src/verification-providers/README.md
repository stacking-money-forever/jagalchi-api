# Provider-neutral verification foundation

This directory defines a closed, persistence-free boundary between external
repository providers and Jagalchi verification. The real provider port observes
repository binding, pull-request head/state/base branch, changed paths, named
checks, and invalidation events. It does not mutate missions, tasks, runs,
operations, publications, or Proof snapshots.

`FixtureVerificationProvider` performs no network calls. Its explicit scenarios
are deterministic:

- `success`: merged PR, expected paths, and successful named check;
- `failure`: open PR, missing required path, and failed named check;
- `drift`: starts passing, then `advanceDrift()` changes the head/check facts and
  emits closed invalidation events;
- `unavailable`: returns only the redacted provider-unavailable error.

The evaluator accepts only `MERGED_PR`, `BASE_BRANCH`, `CHANGED_PATH`, and
`NAMED_CHECK`. Human review is intentionally outside machine verification.
Machine-Proof output pins the repository, PR, head SHA, binding version, criteria
version, individual rule results, observation time, and a deterministic digest.

## Required integration fences

The future workflow adapter must treat every provider result as an observation,
not authorization to commit. Immediately before persistence, in one database
transaction and under the existing write locks, it must recheck:

1. the worker still owns an unexpired lease and the operation is not cancelled;
2. the global feature flag, entitlement, run state, and run version still allow
   the action;
3. repository binding ID/version and criteria version equal the captured fence;
4. the current provider head SHA equals `expectedHeadSha` and the evaluated
   `facts.headSha`;
5. no matching invalidation event has advanced the binding, facts, verification,
   or Machine-Proof generation.

Only after those checks may the integration atomically persist the immutable
verification facts/result and transition the task or Proof state. Lease loss,
archive, cancellation, binding/criteria change, head drift, provider removal, or
check invalidation must discard output and leave no partial Proof mutation.

A future GitHub adapter implements the same ports and closed errors. It must
retain existing GitHub App authorization, pagination, response-size, timeout,
rate-limit, signature, and redaction guards; this foundation performs no real
GitHub request.
