import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRunState } from './project-run.entity';
import { ProjectRunsService } from './project-runs.service';

const runId = '00000000-0000-4000-8000-000000000001';
const ownerId = 'owner-1';

function subject(options: { taskState?: 'READY' | 'IN_PROGRESS' | 'VERIFYING'; currentTaskId?: string | null } = {}) {
  const taskState = options.taskState ?? 'IN_PROGRESS';
  const currentTaskId = options.currentTaskId === undefined ? 'task-1' : options.currentTaskId;
  const task = {
    id: 'task-1',
    title: 'Ship the focused change',
    state: taskState,
    required: true,
    milestoneId: 'milestone-1',
    prerequisiteIds: [],
    purpose: 'Deliver the bounded change with evidence.',
    acceptanceCriteria: ['The focused change is complete.'],
    evidenceRequirements: ['test:contract'],
    citationIds: ['source-1'],
    gapIds: ['gap-1'],
  };
  const projection = {
    id: runId,
    state: taskState === 'READY' ? ProjectRunState.Ready : ProjectRunState.Active,
    version: 1,
    currentTaskId,
    recommendedTaskId: taskState === 'READY' ? 'task-1' : null,
    eligibleReadyTaskIds: taskState === 'READY' ? ['task-1'] : [],
    plan: { id: 'plan-1', schemaVersion: 1 },
    map: { nodes: [{ id: 'task-1', title: task.title, milestoneId: 'milestone-1', state: taskState }], edges: [] },
    tasks: [task],
    citations: [{ id: 'source-1', label: 'Cited requirement', quote: 'Ship the focused change.' }],
    gaps: [{ id: 'gap-1', description: 'The focused change is not yet proven.' }],
    proof: null,
  };
  const run = { id: runId, ownerId, state: projection.state, version: 1, currentTaskId, projection };
  const runs = { findOne: vi.fn().mockResolvedValue(run) };
  const config = {
    get: vi.fn((key: string, fallback?: unknown) => key === 'AI_TIMEOUT_MS' ? '65000' : fallback),
    getOrThrow: vi.fn((_key: string) => 'https://ai.example.test'),
  };
  const aiTokens = { issueInternal: vi.fn().mockReturnValue('internal-token') };
  const service = new ProjectRunsService(
    runs as never,
    undefined,
    config as unknown as ConfigService,
    undefined,
    aiTokens as never,
  );
  return { service, runs, config, aiTokens, projection };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProjectRunsService AI help', () => {
  it('forwards canonical active-task context and returns guidance provenance', async () => {
    const { service, aiTokens } = subject();
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const input = JSON.parse(String(init.body)) as { operationId: string };
      return new Response(JSON.stringify({
        schemaVersion: 1,
        operationId: input.operationId,
        kind: 'focus_task_help',
        result: { guidance: 'Start with the cited requirement, then verify the evidence rule.' },
        citations: [],
        receipt: {
          provider: 'fixture',
          model: 'fixture-v1',
          providerRequestId: 'request-1',
          promptVersion: 'focus-task-help-v1',
          inputHash: 'a'.repeat(64),
          generatedAt: '2026-09-03T10:00:00Z',
          durationMs: 12,
          timeoutBudgetSeconds: 45,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.aiHelp(ownerId, runId, 'task-1', '  How should I start?  ');
    expect(result).toEqual({
      guidance: 'Start with the cited requirement, then verify the evidence rule.',
      provenance: {
        provider: 'fixture',
        model: 'fixture-v1',
        promptVersion: 'focus-task-help-v1',
        inputHash: 'a'.repeat(64),
        generatedAt: '2026-09-03T10:00:00Z',
      },
    });
    expect(aiTokens.issueInternal).toHaveBeenCalledWith(ownerId, 'FOCUS_TASK_HELP');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://ai.example.test/internal/v1/focus-task-help');
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      project_run_id: runId,
      task_id: 'task-1',
      title: 'Ship the focused change',
      purpose: 'Deliver the bounded change with evidence.',
      question: 'How should I start?',
      citations: [{ id: 'source-1', label: 'Cited requirement', quote: 'Ship the focused change.' }],
      gaps: [{ id: 'gap-1', description: 'The focused change is not yet proven.' }],
      prerequisites: [],
      acceptance_criteria: ['The focused change is complete.'],
      evidence_requirements: ['test:contract'],
    });
    expect(body).not.toHaveProperty('client-citation');
    expect(body).not.toHaveProperty('client-gap');
  });

  it('rejects help for a task that is not the current active Focus task', async () => {
    const { service } = subject({ taskState: 'READY', currentTaskId: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.aiHelp(ownerId, runId, 'task-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.aiHelp(ownerId, runId, 'task-1')).rejects.toMatchObject({
      response: { code: 'FOCUS_TASK_NOT_ACTIVE', details: { currentTaskId: null } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
