import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowOperationState, type WorkflowOperation } from './workflow-operation.entities';
import { AiContractInvalidError, AiWorkflowHandlers } from './ai-workflow.handlers';
import { WorkflowOperationHandlers } from './workflow-operation.worker';
import { RetryableWorkflowError } from './workflow-runtime';

const operationId = '00000000-0000-4000-8000-000000000010';
const receipt = {
  provider: 'fake', model: 'fixture-v1', providerRequestId: '', promptVersion: 'v1',
  inputHash: 'a'.repeat(64), generatedAt: '2026-09-03T10:00:00Z', durationMs: 1,
  timeoutBudgetSeconds: 50,
};
const citation = { id: 'source-1', title: 'Source', url: 'https://example.com/job', quote: 'Build systems' };
const proposal = (index: number) => ({
  id: `proposal-${index}`, title: `Proposal ${index}`, projectBlueprintId: 'b1000000-0000-4000-8000-000000000001', projectBlueprintVersion: 1,
  repositoryMode: 'MANUAL_GREENFIELD', citedGapIds: ['gap-1'], citationIds: ['source-1'], boundedOutcome: 'Outcome', nonGoals: ['No deployment'], durationHours: 10,
  difficulty: 'MEDIUM', evidenceRules: ['test:unit'], confidence: 1, rejectionReasons: [],
});

const responses: Record<string, Record<string, unknown>> = {
  JOB_POSTING_EXTRACT: { schemaVersion: 1, operationId, kind: 'job_posting_extract', result: { company: 'Company', role: 'Engineer', requirements: [{ id: 'req-1', text: 'Build systems', priority: 'REQUIRED', sourceSpan: { start: 0, end: 13, quote: 'Build systems' }, confidence: 1 }], warnings: [] }, citations: [], receipt },
  CANDIDATE_EVIDENCE_INTERPRET: { schemaVersion: 1, operationId, kind: 'candidate_evidence_interpret', result: { findings: [], gaps: [] }, citations: [], receipt },
  PROJECT_PROPOSALS: { schemaVersion: 1, operationId, kind: 'project_proposals', result: { proposals: [proposal(1), proposal(2), proposal(3)] }, citations: [citation], receipt },
  PROJECT_PLAN: {
    schemaVersion: 1, operationId, kind: 'project_plan', citations: [citation], receipt,
    result: { artifact: {
      id: 'plan-1', schemaVersion: 1, title: 'Plan', target: 'project_run',
      projectBlueprintId: 'b1000000-0000-4000-8000-000000000001', projectBlueprintVersion: 1, firstAction: 'task-1',
      milestones: [{ id: 'm-1', title: 'Milestone' }],
      tasks: [{ id: 'task-1', title: 'Ship', milestoneId: 'm-1', prerequisiteIds: [], purpose: 'Ship', acceptanceCriteria: ['Pass'], evidenceRules: ['test:unit'], citationIds: ['source-1'], gapIds: ['gap-1'] }],
    } },
  },
};

function setup(response: Record<string, unknown>, entitled = true) {
  const registry = new WorkflowOperationHandlers();
  const config = { get: vi.fn((key: string, fallback?: unknown) => ['PROJECT_RUNS_ENABLED', 'AI_FEATURES_ENABLED'].includes(key) ? 'true' : key === 'AI_TIMEOUT_MS' ? fallback : undefined), getOrThrow: vi.fn(() => 'http://ai.internal') };
  const tokens = { issueInternal: vi.fn(() => 'internal-jwt') };
  const orchestration = { createProjectRun: vi.fn().mockResolvedValue({ projectRun: { id: 'run-1' }, proofMissionIds: [] }) };
  new AiWorkflowHandlers(config as never, tokens as never, registry, { exists: vi.fn().mockResolvedValue(entitled) } as never, orchestration as never).onModuleInit();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }));
  return { registry, tokens, orchestration };
}

function operation(kind: string): WorkflowOperation {
  return {
    id: operationId, ownerId: 'owner-1', kind,
    input: kind === 'PROJECT_PLAN' ? { title: 'Plan', targetId: '00000000-0000-4000-8000-000000000020', competencySlugs: ['ts'] } : {},
    state: WorkflowOperationState.Running,
  } as WorkflowOperation;
}

describe('AiWorkflowHandlers canonical response validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(Object.keys(responses))('accepts a complete canonical %s response', async (kind) => {
    const subject = setup(structuredClone(responses[kind]!));
    await expect(subject.registry.get(kind)!(operation(kind), new AbortController().signal)).resolves.toBeTruthy();
    expect(subject.tokens.issueInternal).toHaveBeenCalledOnce();
    expect(subject.orchestration.createProjectRun).toHaveBeenCalledTimes(kind === 'PROJECT_PLAN' ? 1 : 0);
  });

  it.each(Object.keys(responses))('rejects an invalid %s response before orchestration', async (kind) => {
    const invalid = structuredClone(responses[kind]!);
    delete invalid.receipt;
    const subject = setup(invalid);
    const promise = subject.registry.get(kind)!(operation(kind), new AbortController().signal);
    await expect(promise).rejects.toBeInstanceOf(AiContractInvalidError);
    await expect(promise).rejects.toMatchObject({ code: 'AI_CONTRACT_INVALID' });
    expect(subject.orchestration.createProjectRun).not.toHaveBeenCalled();
  });

  it('registers no claimable kinds while the global gate is closed', () => {
    const registry = new WorkflowOperationHandlers();
    new AiWorkflowHandlers({ get: () => 'false' } as never, {} as never, registry, {} as never, {} as never).onModuleInit();
    expect(registry.kinds()).toEqual([]);
  });

  it('fails before network access when the operation owner is not entitled', async () => {
    const subject = setup(responses.PROJECT_PLAN!, false);
    const fetchMock = vi.mocked(fetch);
    await expect(subject.registry.get('PROJECT_PLAN')!(operation('PROJECT_PLAN'), new AbortController().signal)).rejects.toThrow('entitlement');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies transient AI responses and network failures as retryable', async () => {
    const subject = setup(responses.PROJECT_PLAN!);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(subject.registry.get('PROJECT_PLAN')!(operation('PROJECT_PLAN'), new AbortController().signal))
      .rejects.toBeInstanceOf(RetryableWorkflowError);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network detail')));
    await expect(subject.registry.get('PROJECT_PLAN')!(operation('PROJECT_PLAN'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', retryable: true });
  });
});
