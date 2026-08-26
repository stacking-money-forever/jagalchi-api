import { createHash, createHmac } from 'node:crypto';
import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

export const RATE_LIMIT_POLICY = 'jagalchi:rate-limit-policy';
export type RateLimitPolicy = 'entry' | 'request' | 'completion';
export const RateLimited = (policy: RateLimitPolicy): MethodDecorator =>
  SetMetadata(RATE_LIMIT_POLICY, policy);

type RequestLike = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  rateLimitIdentity?: RateIdentity;
};

type RateIdentity = { ip: string; user: string | null; account: string | null };

const requestFrom = (context: ExecutionContext): RequestLike => context.switchToHttp().getRequest();
const policyFrom = (context: ExecutionContext): RateLimitPolicy | undefined =>
  Reflect.getMetadata(RATE_LIMIT_POLICY, context.getHandler()) as RateLimitPolicy | undefined;

const bearer = (request: RequestLike): string | null => {
  const header = request.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
};

const normalizedAccount = (request: RequestLike): string | null => {
  for (const value of [
    request.body?.email,
    request.body?.identifier,
    request.body?.code,
    request.query?.state,
  ]) {
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return null;
};

const resolveIdentity = async (
  request: RequestLike,
  jwt: JwtService,
  hashSecret: string,
): Promise<RateIdentity> => {
  if (request.rateLimitIdentity) return request.rateLimitIdentity;
  let user: string | null = null;
  const token = bearer(request);
  if (token) {
    try {
      const payload = await jwt.verifyAsync<{ sub?: string }>(token);
      user = typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      user = null;
    }
  }
  const accountValue = normalizedAccount(request);
  const identity = {
    ip: request.ip || 'unknown-peer',
    user,
    account: accountValue
      ? createHmac('sha256', hashSecret).update(accountValue).digest('hex')
      : user,
  };
  Object.defineProperty(request, 'rateLimitIdentity', { value: identity, enumerable: false });
  return identity;
};

export const createRateLimitOptions = (
  jwt: JwtService,
  config: ConfigService,
): ThrottlerModuleOptions => {
  const hashSecret = config.getOrThrow<string>('RATE_LIMIT_HASH_SECRET');
  const identityFor = (context: ExecutionContext) =>
    resolveIdentity(requestFrom(context), jwt, hashSecret);
  const applies = (policy: RateLimitPolicy) => (context: ExecutionContext) =>
    policyFrom(context) !== policy;

  return {
    getTracker: async (request, _context) =>
      JSON.stringify(await resolveIdentity(request as RequestLike, jwt, hashSecret)),
    generateKey: (context, tracker, throttlerName) => {
      const identity = JSON.parse(tracker) as RateIdentity;
      const suffix = throttlerName.includes('Account')
        ? identity.account ?? identity.user ?? identity.ip
        : throttlerName === 'default'
          ? identity.user ?? identity.ip
          : identity.ip;
      return createHash('sha256')
        .update(`${context.getClass().name}:${context.getHandler().name}:${throttlerName}:${suffix}`)
        .digest('hex');
    },
    errorMessage: 'Too many requests',
    throttlers: [
      {
        name: 'default',
        ttl: 60_000,
        limit: async (context) => ((await identityFor(context)).user ? 120 : 60),
      },
      { name: 'ip', ttl: 60_000, limit: 60 },
      { name: 'entryIp', ttl: 60_000, limit: 5, skipIf: applies('entry') },
      { name: 'entryAccount', ttl: 3_600_000, limit: 20, skipIf: applies('entry') },
      { name: 'requestIp', ttl: 3_600_000, limit: 10, skipIf: applies('request') },
      { name: 'requestAccount', ttl: 3_600_000, limit: 3, skipIf: applies('request') },
      { name: 'completionIp', ttl: 60_000, limit: 10, skipIf: applies('completion') },
      { name: 'completionAccount', ttl: 3_600_000, limit: 20, skipIf: applies('completion') },
    ],
  };
};
