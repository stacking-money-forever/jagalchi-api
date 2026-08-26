import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiFeature } from '../tickets/ticket-policy';
import { TicketsService } from '../tickets/tickets.service';
import { AiTokenService } from './ai-token.service';

const FEATURE_ENDPOINTS: Record<AiFeature, string> = {
  coaching: '/ai/learning-coach',
  node_explanation: '/ai/node-description',
  resource_recommendation: '/ai/resource-recommendation',
  deep_search: '/ai/graph-rag',
  feedback: '/ai/record-coach',
  roadmap_generation: '/ai/roadmap-generated',
  document_conversion: '/ai/document-roadmap',
};

function stringValue(
  payload: Record<string, unknown>,
  key: string,
  maxLength: number,
  required = false,
): string | undefined {
  const value = payload[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new BadRequestException(`AI payload field "${key}" is invalid`);
  }
  return value.trim();
}

function integerValue(
  payload: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new BadRequestException(`AI payload field "${key}" is invalid`);
  }
  return Number(value);
}

function composeLevel(payload: Record<string, unknown>): string | undefined {
  const value = payload.compose_level;
  if (value === undefined) return undefined;
  if (value !== 'quick' && value !== 'full') {
    throw new BadRequestException('AI payload field "compose_level" is invalid');
  }
  return value;
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function normalizePayload(
  feature: AiFeature,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (feature) {
    case 'coaching':
      return compact({
        question: stringValue(payload, 'question', 2_000, true),
        compose_level: composeLevel(payload),
      });
    case 'node_explanation':
      return compact({
        node_title: stringValue(payload, 'node_title', 300, true),
        context: stringValue(payload, 'context', 10_000),
      });
    case 'resource_recommendation':
      return compact({
        query: stringValue(payload, 'query', 2_000, true),
        top_k: integerValue(payload, 'top_k', 1, 20),
        recency_days: integerValue(payload, 'recency_days', 0, 3_650),
      });
    case 'deep_search':
      return compact({
        query: stringValue(payload, 'query', 2_000, true),
        top_k: integerValue(payload, 'top_k', 1, 20),
      });
    case 'feedback':
      return compact({
        node_id: stringValue(payload, 'node_id', 200, true),
        compose_level: composeLevel(payload),
      });
    case 'roadmap_generation': {
      const tags = payload.preferred_tags;
      const preferredTags =
        typeof tags === 'string'
          ? tags
          : Array.isArray(tags) &&
              tags.length <= 20 &&
              tags.every((tag) => typeof tag === 'string' && tag.length <= 100)
            ? tags.join(',')
            : undefined;
      if (tags !== undefined && preferredTags === undefined) {
        throw new BadRequestException('AI payload field "preferred_tags" is invalid');
      }
      return compact({
        goal: stringValue(payload, 'goal', 1_000, true),
        preferred_tags: preferredTags?.trim() || undefined,
        max_nodes: integerValue(payload, 'max_nodes', 1, 30),
        compose_level: composeLevel(payload),
      });
    }
    case 'document_conversion':
      return compact({
        document: stringValue(payload, 'document', 100_000, true),
        goal: stringValue(payload, 'goal', 1_000),
      });
  }
}

@Injectable()
export class AiJobsService {
  constructor(
    private readonly config: ConfigService,
    private readonly tickets: TicketsService,
    private readonly tokens: AiTokenService,
  ) {}

  async run(
    userId: string,
    feature: AiFeature,
    idempotencyKey: string,
    payload: Record<string, unknown>,
    roadmapId?: string,
  ): Promise<unknown> {
    if (this.config.get<string>('AI_FEATURES_ENABLED') === 'false') {
      throw new ServiceUnavailableException({
        code: 'AI_FEATURES_DISABLED',
        message: 'AI features are unavailable',
      });
    }
    const safePayload = normalizePayload(feature, payload);
    const reservation = await this.tickets.reserveAiUsage(
      userId,
      feature,
      idempotencyKey,
    );

    let result: unknown;
    try {
      const baseUrl = new URL(this.config.getOrThrow<string>('AI_SERVICE_URL'));
      const url = new URL(FEATURE_ENDPOINTS[feature], baseUrl);
      const usesJsonBody = feature === 'document_conversion';
      if (!usesJsonBody) {
        for (const [key, value] of Object.entries(safePayload)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            url.searchParams.set(key, String(value));
          } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
            url.searchParams.set(key, value.join(','));
          }
        }
        if (url.toString().length > 8_000) {
          throw new Error('AI request query is too large');
        }
      }
      const response = await fetch(url, {
        method: usesJsonBody ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${this.tokens.issue(userId, roadmapId)}`,
          ...(usesJsonBody ? { 'content-type': 'application/json' } : {}),
          'x-request-id': idempotencyKey,
        },
        ...(usesJsonBody ? { body: JSON.stringify(safePayload) } : {}),
        signal: AbortSignal.timeout(this.config.get<number>('AI_TIMEOUT_MS', 45_000)),
      });

      if (!response.ok) {
        throw new Error(`AI service returned ${response.status}`);
      }
      result = (await response.json()) as unknown;
    } catch (error) {
      await this.tickets.refundAiUsage(reservation.id);
      throw new BadGatewayException({
        code: 'AI_JOB_FAILED',
        message: error instanceof Error ? error.message : 'AI job failed',
        ticketsRefunded: true,
      });
    }

    await this.tickets.commitAiUsage(reservation.id);
    return result;
  }
}
