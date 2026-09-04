import { RetryableWorkflowError } from '../workflow-operations/workflow-runtime';

const SEMANTIC_AI_CODE = /^AI_[A-Z0-9_]+$/;

export class AiSemanticError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readErrorBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function assertAiServiceOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await readErrorBody(response);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const message = typeof body?.message === 'string' && body.message.trim()
    ? body.message.trim()
    : 'AI service rejected the request';

  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    if (code === 'ai_provider_unavailable' || code === 'ai_provider_deadline_exceeded') {
      throw new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', 'AI request failed');
    }
    throw new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', 'AI request failed');
  }

  if (code === 'ai_provider_unavailable' || code === 'ai_provider_deadline_exceeded') {
    throw new RetryableWorkflowError('AI_SERVICE_UNAVAILABLE', 'AI request failed');
  }

  if (SEMANTIC_AI_CODE.test(code) || code === 'INSUFFICIENT_QUALIFIED_PROPOSALS' || code === 'EVIDENCE_RULE_UNSUPPORTED') {
    throw new AiSemanticError(code, message);
  }

  throw Object.assign(new Error(message), { code: 'AI_REQUEST_REJECTED' });
}

export interface ProjectRunAiReceipt {
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  generatedAt: string;
}

export function normalizeAiReceipt(value: unknown): ProjectRunAiReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.provider !== 'string' || !record.provider.trim()
    || typeof record.model !== 'string' || !record.model.trim()
    || typeof record.promptVersion !== 'string' || !record.promptVersion.trim()
    || typeof record.inputHash !== 'string' || !/^[0-9a-f]{64}$/.test(record.inputHash)
    || typeof record.generatedAt !== 'string' || Number.isNaN(Date.parse(record.generatedAt))
  ) return null;
  return {
    provider: record.provider,
    model: record.model,
    promptVersion: record.promptVersion,
    inputHash: record.inputHash,
    generatedAt: record.generatedAt,
  };
}

export function normalizePlanMilestones(artifact: Record<string, unknown> | null | undefined): Array<{ id: string; title: string }> {
  if (!artifact || !Array.isArray(artifact.milestones)) return [];
  return artifact.milestones
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({ id: String(item.id), title: String(item.title) }))
    .filter((item) => item.id.length > 0 && item.title.length > 0 && item.title.length <= 300);
}

export function resolveCompiledFirstAction(
  artifact: Record<string, unknown>,
  taskIds: Set<string>,
  fallbackTaskId: string | null,
): string | null {
  const firstAction = typeof artifact.firstAction === 'string' ? artifact.firstAction : null;
  if (firstAction && taskIds.has(firstAction)) return firstAction;
  return fallbackTaskId;
}
