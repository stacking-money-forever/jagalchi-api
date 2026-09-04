import { describe, expect, it } from 'vitest';
import { ProjectRunState } from './project-run.entity';
import { isProjectRunProjection } from './project-run.projection';

const projection = () => ({
  id: '00000000-0000-4000-8000-000000000001', state: ProjectRunState.Ready, version: 1, currentTaskId: 'task-1', recommendedTaskId: 'task-1',
  plan: { id: 'plan-v1', schemaVersion: 1 },
  map: { nodes: [{ id: 'task-1', title: 'Ship', milestoneId: 'milestone-1', state: 'READY' }], edges: [] },
  tasks: [{ id: 'task-1', title: 'Ship', state: 'READY', required: true, milestoneId: 'milestone-1', prerequisiteIds: [], purpose: 'Deliver', acceptanceCriteria: ['Pass'], evidenceRequirements: ['PR'] }],
  proof: null,
});

describe('ProjectRun projection validation', () => {
  it('accepts the closed Map/Focus projection', () => expect(isProjectRunProjection(projection())).toBe(true));
  it('accepts the richer owner target summary without opening unknown fields', () => expect(isProjectRunProjection({ ...projection(), target: { company: 'Example', role: 'Engineer' } })).toBe(true));
  it('rejects dangling focus task IDs', () => expect(isProjectRunProjection({ ...projection(), currentTaskId: 'missing' })).toBe(false));
  it('rejects unknown nested fields', () => {
    const value = projection();
    value.tasks[0] = { ...value.tasks[0]!, extra: true } as never;
    expect(isProjectRunProjection(value)).toBe(false);
  });
  it('rejects values beyond generated schema bounds', () => {
    const longTitle = projection();
    longTitle.map.nodes[0]!.title = 'x'.repeat(301);
    expect(isProjectRunProjection(longTitle)).toBe(false);
    const dateOnly = projection();
    dateOnly.proof = { summary: 'Proof', validUntil: '2026-09-03', publication: { state: 'ACTIVE', publicId: 'proof-1' }, verification: { state: 'PASS', verifiedAt: '2026-09-03' } };
    expect(isProjectRunProjection(dateOnly)).toBe(false);
  });
  it('accepts pending operations and proof recovery fields', () => {
    const value = {
      ...projection(),
      pendingOperation: { id: '00000000-0000-4000-8000-000000000088', kind: 'PULL_REQUEST_BINDING' },
      proof: {
        summary: 'Proof', validUntil: null,
        publication: { state: 'ACTIVE', publicId: 'proof-1', supersededSnapshotId: '00000000-0000-4000-8000-000000000098' },
        verification: { state: 'FAIL', verifiedAt: '2026-09-03T10:00:00Z' },
        failedCriteria: [{ ruleId: 'rule-0', type: 'MERGED_PR', code: 'FAIL' }],
        facts: {
          snapshotId: '00000000-0000-4000-8000-000000000099', verificationLevel: 'MACHINE_VERIFIED', provider: 'fixture',
          repositoryId: '9000001', pullNumber: 17, headSha: 'a'.repeat(40), observedAt: '2026-09-03T10:00:00Z',
          evaluations: [{ ruleId: 'rule-0', type: 'MERGED_PR', passed: false, code: 'FAIL' }],
        },
      },
    };
    expect(isProjectRunProjection(value)).toBe(true);
  });

  it('accepts repository binding and focus context', () => {
    const value = {
      ...projection(),
      citations: [{ id: 'source-1', label: 'Requirement', quote: null }],
      gaps: [{ id: 'gap-1', description: 'typescript' }],
      repositoryBinding: { repositoryName: 'fixture/verification-repository', pullNumber: 17, headSha: 'a'.repeat(40), pullUrl: 'https://github.com/fixture/verification-repository/pull/17' },
      tasks: [{ ...projection().tasks[0]!, citationIds: ['source-1'], gapIds: ['gap-1'] }],
      proof: {
        summary: 'Proof', validUntil: null,
        publication: { state: 'ACTIVE', publicId: 'proof-1' },
        verification: { state: 'PASS', verifiedAt: '2026-09-03T10:00:00Z' },
        facts: {
          snapshotId: '00000000-0000-4000-8000-000000000099', verificationLevel: 'MACHINE_VERIFIED', provider: 'fixture',
          repositoryId: '9000001', repositoryName: 'fixture/verification-repository', pullNumber: 17, headSha: 'a'.repeat(40), observedAt: '2026-09-03T10:00:00Z',
          taskKey: 'task-1', pullUrl: 'https://github.com/fixture/verification-repository/pull/17',
          evaluations: [{ ruleId: 'rule-0', type: 'MERGED_PR', passed: true, code: 'PASS' }],
        },
      },
    };
    expect(isProjectRunProjection(value)).toBe(true);
  });
});
