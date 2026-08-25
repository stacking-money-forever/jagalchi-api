import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiJobsService } from './ai-jobs.service';

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

  it('commits a reservation only after the AI service succeeds', async () => {
    const subject = createSubject();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ answer: 'ok' }), {
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
    ).resolves.toEqual({ answer: 'ok' });

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
        new Response(JSON.stringify({ recommended_roadmaps: [] }), {
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
        new Response(JSON.stringify({ nodes: [], edges: [] }), {
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
});
