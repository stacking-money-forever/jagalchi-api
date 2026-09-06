import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { createRateLimitOptions, RateLimited } from './rate-limit';

const contextFor = (request: Record<string, unknown>, policy?: 'entry' | 'request' | 'completion') => {
  class Controller {}
  const handler = () => undefined;
  if (policy) RateLimited(policy)(Controller.prototype, 'handler', { value: handler } as never);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => Controller,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
};

describe('createRateLimitOptions', () => {
  const create = (configValues: { nodeEnv?: string; completionIpLimit?: string; anonymousLimit?: string; signedUserLimit?: string } = {}) => {
    const jwt = {
      verifyAsync: vi.fn(async (token: string) => {
        if (token !== 'valid') throw new Error('invalid token');
        return { sub: 'user-1' };
      }),
    };
    const config = {
      getOrThrow: vi.fn(() => 's'.repeat(32)),
      get: vi.fn((key: string) => {
        if (key === 'NODE_ENV') return configValues.nodeEnv;
        if (key === 'E2E_COMPLETION_IP_LIMIT') return configValues.completionIpLimit;
        if (key === 'E2E_DEFAULT_ANONYMOUS_LIMIT') return configValues.anonymousLimit;
        if (key === 'E2E_DEFAULT_SIGNED_USER_LIMIT') return configValues.signedUserLimit;
        return undefined;
      }),
    };
    const options = createRateLimitOptions(jwt as never, config as never) as Exclude<
      ReturnType<typeof createRateLimitOptions>,
      unknown[]
    >;
    return { jwt, options };
  };
  it('defaults completion IP throttling to 10/min', () => {
    const { options } = create();
    expect(options.throttlers.find((item) => item.name === 'completionIp')?.limit).toBe(10);
  });

  it('uses the non-production override only for completion IP throttling', () => {
    const { options } = create({ nodeEnv: 'development', completionIpLimit: '25' });
    expect(options.throttlers.find((item) => item.name === 'completionIp')?.limit).toBe(25);
    expect(options.throttlers.find((item) => item.name === 'completionAccount')?.limit).toBe(20);
  });

  it('keeps the production completion IP limit hard at 10', () => {
    const { options } = create({ nodeEnv: 'production', completionIpLimit: '25' });
    expect(options.throttlers.find((item) => item.name === 'completionIp')?.limit).toBe(10);
  });

  it('uses 60/min for anonymous requests and 120/min for signed users', async () => {
    const { options } = create();
    const defaultThrottle = options.throttlers.find((item) => item.name === 'default');
    expect(defaultThrottle).toBeDefined();
    const limit = defaultThrottle?.limit;
    expect(typeof limit).toBe('function');
    await expect((limit as (context: ExecutionContext) => Promise<number>)(contextFor({ ip: '1.1.1.1', headers: {} }))).resolves.toBe(60);
    await expect(
      (limit as (context: ExecutionContext) => Promise<number>)(
        contextFor({ ip: '1.1.1.1', headers: { authorization: 'Bearer valid' } }),
      ),
    ).resolves.toBe(120);
  });
  it('uses non-production generic throttle overrides for browser acceptance', async () => {
    const { options } = create({
      nodeEnv: 'development',
      anonymousLimit: '1000',
      signedUserLimit: '2000',
    });
    const defaultThrottle = options.throttlers.find((item) => item.name === 'default');
    const limit = defaultThrottle?.limit as (context: ExecutionContext) => Promise<number>;
    await expect(limit(contextFor({ ip: '1.1.1.1', headers: {} }))).resolves.toBe(1000);
    await expect(
      limit(contextFor({ ip: '1.1.1.1', headers: { authorization: 'Bearer valid' } })),
    ).resolves.toBe(2000);
    expect(options.throttlers.find((item) => item.name === 'ip')?.limit).toBe(1000);
  });

  it('ignores generic throttle overrides in production', async () => {
    const { options } = create({
      nodeEnv: 'production',
      anonymousLimit: '1000',
      signedUserLimit: '2000',
    });
    const defaultThrottle = options.throttlers.find((item) => item.name === 'default');
    const limit = defaultThrottle?.limit as (context: ExecutionContext) => Promise<number>;
    await expect(limit(contextFor({ ip: '1.1.1.1', headers: {} }))).resolves.toBe(60);
    await expect(
      limit(contextFor({ ip: '1.1.1.1', headers: { authorization: 'Bearer valid' } })),
    ).resolves.toBe(120);
    expect(options.throttlers.find((item) => item.name === 'ip')?.limit).toBe(60);
  });


  it('hashes normalized account identifiers and never embeds plaintext tracker values in keys', async () => {
    const { options } = create();
    const request = { ip: '1.1.1.1', headers: {}, body: { email: ' User@Example.com ' } };
    const context = contextFor(request, 'request');
    const tracker = await options.getTracker?.(request, context);
    const key = options.generateKey?.(context, tracker as string, 'requestAccount');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain('user@example.com');
  });

  it('applies sensitive throttles only to their declared route class', () => {
    const { options } = create();
    const requestThrottle = options.throttlers.find((item) => item.name === 'requestAccount');
    expect(requestThrottle?.skipIf?.(contextFor({}, 'request'))).toBe(false);
    expect(requestThrottle?.skipIf?.(contextFor({}, 'entry'))).toBe(true);
  });

  it('keeps the generic public IP throttle active independently of route-specific policies', () => {
    const { options } = create();
    const ipThrottle = options.throttlers.find((item) => item.name === 'ip');
    expect(ipThrottle?.limit).toBe(60);
    expect(ipThrottle?.skipIf).toBeUndefined();
  });
});
