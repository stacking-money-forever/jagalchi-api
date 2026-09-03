import { describe, expect, it } from 'vitest';
import { AiContractInvalidError } from '../workflow-operations/ai-workflow.handlers';
import { CareerV1WorkflowHandlers } from './career-v1.handlers';

const diff = { payload: { missing: ['typescript'] } };
const ai = { citations: [{ id: 'source-1' }] };
const task = (overrides: Record<string, unknown> = {}) => ({ id: 'task-1', title: 'Ship', milestoneId: 'm-1', prerequisiteIds: [], purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRules: ['test:unit'], citationIds: ['source-1'], gapIds: ['gap-1'], ...overrides });
const blueprint = (index: number) => ({ id: `b1000000-0000-4000-8000-00000000000${index + 1}`, blueprintKey: `blueprint-${index}`, version: 1, catalogVersion: 'v1', definition: {} });
const proposal = (index: number, overrides: Record<string, unknown> = {}) => ({ id: `proposal-${index}`, projectBlueprintId: `blueprint-${index}`, projectBlueprintVersion: 1, citedGapIds: index === 1 ? ['gap-1'] : [], citationIds: ['source-1'], rejectionReasons: [], ...overrides });

describe('CareerV1 plan semantic boundary', () => {
  const validate = (tasks: Array<Record<string, unknown>>) => CareerV1WorkflowHandlers.prototype['validatePlan']({ tasks }, ai, diff as never);
  it('accepts a cited acyclic plan that covers every confirmed gap', () => expect(validate([task()])).toHaveLength(1));
  it('rejects cycles before persistence', () => expect(() => validate([task({ prerequisiteIds: ['task-2'] }), task({ id: 'task-2', prerequisiteIds: ['task-1'] })])).toThrow(AiContractInvalidError));
  it('rejects missing citations, uncovered gaps, and unsupported evidence rules', () => {
    expect(() => validate([task({ citationIds: ['missing'] })])).toThrow(AiContractInvalidError);
    expect(() => validate([task({ gapIds: [] })])).toThrow(AiContractInvalidError);
    expect(() => validate([task({ evidenceRules: ['deployment:production'] })])).toThrow('Unsupported evidence rule');
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
    expect(() => qualify([proposal(1), proposal(2), proposal(3, { rejectionReasons: ['not qualified'] })], catalog, new Set(['gap-1']), new Set(['source-1']))).toThrow('Exactly three distinct eligible proposals');
    expect(() => qualify([proposal(1, { citedGapIds: [] }), proposal(2), proposal(3)], catalog, new Set(['gap-1']), new Set(['source-1']))).toThrow('Exactly three distinct eligible proposals');
  });
});
