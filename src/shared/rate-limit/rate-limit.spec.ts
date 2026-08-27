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
  const create = () => {
    const jwt = {
      verifyAsync: vi.fn(async (token: string) => {
        if (token !== 'valid') throw new Error('invalid token');
        return { sub: 'user-1' };
      }),
    };
    const config = { getOrThrow: vi.fn(() => 's'.repeat(32)) };
    const options = createRateLimitOptions(jwt as never, config as never) as Exclude<
      ReturnType<typeof createRateLimitOptions>,
      unknown[]
    >;
    return { jwt, options };
  };

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
