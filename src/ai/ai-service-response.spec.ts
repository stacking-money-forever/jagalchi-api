import { describe, expect, it } from 'vitest';
import { AiSemanticError, assertAiServiceOk, resolveCompiledFirstAction } from './ai-service-response';
describe('assertAiServiceOk', () => {
  it('preserves semantic 422 AI codes', async () => {
    const response = new Response(JSON.stringify({ code: 'AI_PLAN_MALFORMED', message: 'Plan artifact is invalid' }), { status: 422 });
    await expect(assertAiServiceOk(response)).rejects.toBeInstanceOf(AiSemanticError);
    await expect(assertAiServiceOk(new Response(JSON.stringify({ code: 'AI_PLAN_MALFORMED', message: 'Plan artifact is invalid' }), { status: 422 }))).rejects.toMatchObject({ code: 'AI_PLAN_MALFORMED' });
  });

  it('maps provider outages to retryable AI_SERVICE_UNAVAILABLE', async () => {
    await expect(assertAiServiceOk(new Response(JSON.stringify({ code: 'ai_provider_unavailable', message: 'down' }), { status: 503 }))).rejects.toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', retryable: true });
  });

  it('falls back to AI_REQUEST_REJECTED for unknown client failures', async () => {
    await expect(assertAiServiceOk(new Response(JSON.stringify({ message: 'rejected' }), { status: 400 }))).rejects.toMatchObject({ code: 'AI_REQUEST_REJECTED' });
  });
});

describe('resolveCompiledFirstAction', () => {
  it('prefers validated firstAction over fallback', () => {
    expect(resolveCompiledFirstAction({ firstAction: 'task-2' }, new Set(['task-1', 'task-2']), 'task-1')).toBe('task-2');
  });
});
