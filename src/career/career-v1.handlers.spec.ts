import { describe, expect, it, vi } from 'vitest';
import { AiContractInvalidError } from '../workflow-operations/ai-workflow.handlers';
import { CareerV1WorkflowHandlers } from './career-v1.handlers';
import type { CandidateProfileSnapshot, CareerDiffSnapshot, CareerTargetVersion } from '../project-runs/product-spine.entities';
import { GithubInstallationStatus } from '../github/github.entities';

const diff = { payload: { missing: ['typescript'] } };
const ai = { citations: [{ id: 'source-1' }] };
const task = (overrides: Record<string, unknown> = {}) => ({ id: 'task-1', title: 'Ship', milestoneId: 'm-1', prerequisiteIds: [], required: true, purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRules: ['test:unit'], citationIds: ['source-1'], gapIds: ['gap-1'], ...overrides });
const blueprint = (index: number) => ({ id: `b1000000-0000-4000-8000-00000000000${index + 1}`, blueprintKey: `blueprint-${index}`, version: 1, catalogVersion: 'v1', definition: {} });
const proposal = (index: number, overrides: Record<string, unknown> = {}) => ({ id: `proposal-${index}`, projectBlueprintId: `blueprint-${index}`, projectBlueprintVersion: 1, citedGapIds: index === 1 ? ['gap-1'] : [], citationIds: ['source-1'], rejectionReasons: ['Weaker trade-off for the cited gap coverage balance.'], ...overrides });

describe('CareerV1 plan semantic boundary', () => {
  const validate = (tasks: Array<Record<string, unknown>>) => CareerV1WorkflowHandlers.prototype['validatePlan']({ tasks }, ai, diff as never);
  it('accepts a cited acyclic plan that covers every confirmed gap', () => expect(validate([task()])).toHaveLength(1));
  it('rejects cycles before persistence', () => expect(() => validate([task({ prerequisiteIds: ['task-2'] }), task({ id: 'task-2', prerequisiteIds: ['task-1'] })])).toThrow(AiContractInvalidError));
  it('rejects missing citations, uncovered gaps, unsupported evidence rules, and all-optional tasks', () => {
    expect(() => validate([task({ citationIds: ['missing'] })])).toThrow(AiContractInvalidError);
    expect(() => validate([task({ gapIds: [] })])).toThrow(AiContractInvalidError);
    expect(() => validate([task({ evidenceRules: ['deployment:production'] })])).toThrow('Unsupported evidence rule');
    expect(() => validate([task({ required: false })])).toThrow(AiContractInvalidError);
  });

  it('accepts only three distinct qualified proposals that preserve exact catalog lineage', () => {
    const qualify = CareerV1WorkflowHandlers.prototype['qualifyProposals'].bind(CareerV1WorkflowHandlers.prototype);
    const catalog = [blueprint(1), blueprint(2), blueprint(3)] as never;
    const accepted = qualify([proposal(1), proposal(2), proposal(3)], catalog, new Set(['gap-1']), new Set(['source-1']));
    expect(accepted.map(({ blueprint: item }) => item.id)).toEqual([
      'b1000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000003',
      'b1000000-0000-4000-8000-000000000004',
    ]);
    expect(() => qualify([proposal(1), proposal(2), proposal(3, { projectBlueprintId: 'blueprint-2' })], catalog, new Set(['gap-1']), new Set(['source-1']))).toThrow('Exactly three distinct eligible proposals');
    expect(() => qualify([proposal(1), proposal(2), proposal(3, { rejectionReasons: [] })], catalog, new Set(['gap-1']), new Set(['source-1']))).toThrow('Exactly three distinct eligible proposals');
    expect(() => qualify([proposal(1, { citedGapIds: [] }), proposal(2), proposal(3)], catalog, new Set(['gap-1']), new Set(['source-1']))).toThrow('Exactly three distinct eligible proposals');
  });

  it('accepts interpret-grounded proposal citations through validatePlan', () => {
    const validate = CareerV1WorkflowHandlers.prototype['validatePlan'].bind(CareerV1WorkflowHandlers.prototype);
    const targetVersion = { payload: { citations: [{ id: 'source-1', title: 'Manual role', quote: 'Manual text' }] } } as CareerTargetVersion;
    const groundedDiff = {
      payload: {
        missing: [{ id: 'gap-1', description: 'typescript' }],
        citations: [{ id: 'source-1', title: 'Manual role', quote: 'Manual text' }, { id: 'repo-1', title: 'fixture/verification-repository' }],
      },
    } as CareerDiffSnapshot;
    const profile = {
      payload: {
        interpretation: {
          result: { findings: [{ statement: 'Fixture repository is available', confidence: 1, citationIds: ['repo-1'] }], gaps: [] },
          citations: [{ id: 'repo-1', title: 'fixture/verification-repository', url: 'https://github.com/fixture/verification-repository', quote: 'Repository available.' }],
        },
      },
    } as CandidateProfileSnapshot;
    const tasks = validate(
      { tasks: [{ id: 'task-1', title: 'Ship', milestoneId: 'm-1', prerequisiteIds: [], required: true, purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRules: ['test:unit'], citationIds: ['repo-1'], gapIds: ['gap-1'] }] },
      { citations: [] },
      groundedDiff,
      targetVersion,
      { payload: { citedGapIds: ['gap-1'], citationIds: ['repo-1'] } },
      profile,
    );
    expect(tasks[0]?.citationIds).toEqual(['repo-1']);
  });
});

describe('CareerV1 candidate profile repository capture', () => {
  it('accepts synchronized repository facts when the production GitHub provider is enabled', async () => {
    const installation = {
      id: 'installation-1',
      ownerUserId: 'owner-1',
      status: GithubInstallationStatus.Active,
    };
    const repository = {
      installationId: installation.id,
      githubRepositoryId: '9000001',
      fullName: 'fixture/verification-repository',
      private: true,
      active: true,
    };
    const ai = vi.fn().mockResolvedValue({ result: { findings: [], gaps: [] }, citations: [] });
    const complete = vi.fn().mockResolvedValue({
      resource: {
        resourceType: 'CANDIDATE_PROFILE_SNAPSHOT',
        resourceId: 'snapshot-1',
        resourceHref: '/api/career/profile-snapshots/snapshot-1',
      },
    });
    const instance = Object.create(CareerV1WorkflowHandlers.prototype) as CareerV1WorkflowHandlers;
    Object.assign(instance, {
      config: { get: vi.fn().mockReturnValue('github') },
      installations: { find: vi.fn().mockResolvedValue([installation]) },
      repositories: { find: vi.fn().mockResolvedValue([repository]) },
      ai,
      complete,
    });

    await expect(instance['profile']({
      id: 'operation-1',
      ownerId: installation.ownerUserId,
      input: { repositoryIds: [] },
    } as never, new AbortController().signal)).resolves.toMatchObject({
      resource: { resourceType: 'CANDIDATE_PROFILE_SNAPSHOT' },
    });
    expect(ai).toHaveBeenCalledOnce();
    expect(ai.mock.calls[0]?.[5]).toEqual({
      objective: 'Interpret candidate evidence',
      evidence: [{
        id: 'repo-1',
        title: repository.fullName,
        url: `https://github.com/${repository.fullName}`,
        quote: `Repository ${repository.fullName} is available to the installation.`,
      }],
    });
    expect(complete).toHaveBeenCalledOnce();
  });
});
