import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiJobsService } from './ai-jobs.service';

const evidence = { source: 'fixture', id: 'source-1', snippet: 'Grounded fixture' };
const validResponses = {
  coaching: {
    user_id: 'user-1', question: '캐시는 무엇인가요?', intent: 'learn', toolchain: [], plan: [],
    answer: 'ok', retrieval_evidence: [evidence], behavior_summary: {}, model_version: 'v1',
    prompt_version: 'v1', created_at: '2026-09-03T00:00:00Z', cache_hit: false,
  },
  node_explanation: {
    node_title: 'Cache', description: 'Description', generated_at: '2026-09-03T00:00:00Z',
  },
  resource_recommendation: {
    query: 'query', generated_at: '2026-09-03T00:00:00Z', items: [], model_version: 'v1',
    retrieval_evidence: [evidence],
  },
  deep_search: {
    retrieval_evidence: [evidence], graph_snapshot: { nodes: [], edges: [] },
  },
  feedback: {
    record_id: 'record-1', model_version: 'v1', prompt_version: 'v1',
    created_at: '2026-09-03T00:00:00Z',
    scores: { evidence_level: 1, structure_score: 1, specificity_score: 1, reproducibility_score: 1, quality_score: 1 },
    strengths: [], gaps: [], rewrite_suggestions: { portfolio_bullets: [], improved_memo: '' },
    code_feedback: {}, next_actions: [], followup_questions: [], retrieval_evidence: [evidence],
  },
  roadmap_generation: {
    roadmap_id: 'roadmap-1', title: 'Roadmap', description: 'Description', nodes: [],
    edges: [{ source: 'node-1', target: 'node-2', type: null }],
    tags: [], model_version: 'v1', prompt_version: 'v1', created_at: '2026-09-03T00:00:00Z',
    retrieval_evidence: [evidence],
  },
  document_conversion: {
    document_summary: 'Summary', extracted_keywords: [], recommended_roadmaps: [],
    suggested_topics: [], model_version: 'v1', created_at: '2026-09-03T00:00:00Z',
  },
} as const;

describe('AiJobsService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createSubject = () => {
    const tickets = {
      reserveAiUsage: vi.fn().mockResolvedValue({ id: 'reservation-1' }),
      commitAiUsage: vi.fn().mockResolvedValue(undefined),
      refundAiUsage: vi.fn().mockResolvedValue(undefined),
    };
    const tokens = { issue: vi.fn().mockReturnValue('internal-token') };
    const config = {
      getOrThrow: vi.fn().mockReturnValue('https://ai.internal'),
      get: vi.fn().mockReturnValue(1_000),
    };
    const service = new AiJobsService(config as never, tickets as never, tokens as never);
    return { config, service, tickets, tokens };
  };

  it('fails closed before payload validation, tickets, tokens, or network when AI is disabled', async () => {
    const subject = createSubject();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    subject.config.get.mockImplementation((key: string) =>
      key === 'AI_FEATURES_ENABLED' ? 'false' : 1_000,
    );

    await expect(
      subject.service.run('user-1', 'deep_search', 'request-disabled', {
        invalid: 'payload validation must not run',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(subject.tickets.reserveAiUsage).not.toHaveBeenCalled();
    expect(subject.tokens.issue).not.toHaveBeenCalled();
    expect(subject.config.getOrThrow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('commits a reservation only after the AI service succeeds', async () => {
    const subject = createSubject();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(validResponses.coaching), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      subject.service.run(
        'user-1',
        'coaching',
        'request-1234',
        { question: '캐시는 무엇인가요?' },
        'roadmap-1',
      ),
    ).resolves.toEqual(validResponses.coaching);

    expect(subject.tickets.commitAiUsage).toHaveBeenCalledWith('reservation-1');
    expect(subject.tickets.refundAiUsage).not.toHaveBeenCalled();
    expect(subject.tokens.issue).toHaveBeenCalledWith('user-1', 'roadmap-1');
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://ai.internal/ai/learning-coach?question=%EC%BA%90%EC%8B%9C%EB%8A%94+%EB%AC%B4%EC%97%87%EC%9D%B8%EA%B0%80%EC%9A%94%3F'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('refunds the reservation when the AI service fails', async () => {
    const subject = createSubject();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection failed')));

    await expect(
      subject.service.run(
        'user-1',
        'deep_search',
        'request-5678',
        { query: '근거를 찾아줘' },
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(subject.tickets.refundAiUsage).toHaveBeenCalledWith('reservation-1');
    expect(subject.tickets.commitAiUsage).not.toHaveBeenCalled();
  });

  it('uses the Django document POST contract and strips unknown identity fields', async () => {
    const subject = createSubject();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(validResponses.document_conversion), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await subject.service.run('user-1', 'document_conversion', 'request-document', {
      document: 'Expo와 React Native를 학습했습니다.',
      goal: '모바일 개발자',
      user_id: 'attacker',
      roadmap_id: 'attacker-roadmap',
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL('https://ai.internal/ai/document-roadmap'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          document: 'Expo와 React Native를 학습했습니다.',
          goal: '모바일 개발자',
        }),
      }),
    );
  });

  it('rejects mismatched feature payloads before reserving tickets', async () => {
    const subject = createSubject();
    await expect(
      subject.service.run('user-1', 'deep_search', 'request-invalid', {
        question: 'Django가 읽지 않는 필드',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subject.tickets.reserveAiUsage).not.toHaveBeenCalled();
  });

  it('serializes roadmap tags exactly as the Django query contract expects', async () => {
    const subject = createSubject();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(validResponses.roadmap_generation), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await subject.service.run('user-1', 'roadmap_generation', 'request-roadmap', {
      goal: '앱 출시',
      preferred_tags: ['Expo', 'StoreKit'],
      max_nodes: 8,
      compose_level: 'full',
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL(
        'https://ai.internal/ai/roadmap-generated?goal=%EC%95%B1+%EC%B6%9C%EC%8B%9C&preferred_tags=Expo%2CStoreKit&max_nodes=8&compose_level=full',
      ),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('validates successful responses for every exact legacy mapping', async () => {
    const cases = [
      ['coaching', { question: 'Question' }, '/ai/learning-coach', 'GET'],
      ['node_explanation', { node_title: 'Node' }, '/ai/node-description', 'GET'],
      ['resource_recommendation', { query: 'Query' }, '/ai/resource-recommendation', 'GET'],
      ['deep_search', { query: 'Query' }, '/ai/graph-rag', 'GET'],
      ['feedback', { node_id: 'node-1' }, '/ai/record-coach', 'GET'],
      ['roadmap_generation', { goal: 'Goal' }, '/ai/roadmap-generated', 'GET'],
      ['document_conversion', { document: 'Document' }, '/ai/document-roadmap', 'POST'],
    ] as const;
    for (const [feature, payload, path, method] of cases) {
      const subject = createSubject();
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json(validResponses[feature]),
      );
      vi.stubGlobal('fetch', fetchMock);
      await subject.service.run('user-1', feature, `request-${feature}`, payload);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect((url as URL).pathname).toBe(path);
      expect((init as RequestInit).method).toBe(method);
    }
  });

  it('refunds and fails closed when Django returns a drifted 2xx response', async () => {
    const subject = createSubject();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ answer: 'partial' })));
    await expect(
      subject.service.run('user-1', 'coaching', 'request-drifted', { question: 'Question' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(subject.tickets.refundAiUsage).toHaveBeenCalledWith('reservation-1');
    expect(subject.tickets.commitAiUsage).not.toHaveBeenCalled();
  });
});
