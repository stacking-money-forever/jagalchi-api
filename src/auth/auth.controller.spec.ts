import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';

describe('AuthController native public-client boundary', () => {
  const result = {
    accessToken: 'access',
    refreshToken: 'refresh-token-value-that-is-long-enough',
    user: { id: 'user-1', email: 'user@example.test', name: 'User', roles: ['USER'] },
  };

  const subject = () => {
    const auth = {
      login: vi.fn().mockResolvedValue(result),
      register: vi.fn().mockResolvedValue(result),
      refresh: vi.fn().mockResolvedValue(result),
      revoke: vi.fn().mockResolvedValue(undefined),
      exchangeOAuthGrant: vi.fn().mockResolvedValue(result),
    };
    return { auth, controller: new AuthController(auth as never) };
  };

  it('returns both tokens from the explicit native login without setting cookies', async () => {
    const { auth, controller } = subject();
    await expect(controller.nativeLogin(undefined, {
      email: 'user@example.test', password: 'strong-password',
    })).resolves.toEqual(result);
    expect(auth.login).toHaveBeenCalledOnce();
  });

  it('returns both tokens from explicit native registration', async () => {
    const { controller } = subject();
    await expect(controller.nativeRegister(undefined, {
      email: 'user@example.test', name: 'User', password: 'strong-password',
      registrationProof: 'x'.repeat(32),
    })).resolves.toEqual(result);
  });

  it.each([
    ['login', (controller: AuthController) => controller.nativeLogin('https://evil.example', { email: 'a@b.co', password: 'password' })],
    ['registration', (controller: AuthController) => controller.nativeRegister('https://evil.example', { email: 'a@b.co', name: 'A', password: 'password1234', registrationProof: 'x'.repeat(32) })],
    ['refresh', (controller: AuthController) => controller.nativeRefresh('null', { refreshToken: 'x'.repeat(48) })],
    ['logout', (controller: AuthController) => controller.nativeLogout('https://app.example', { refreshToken: 'x'.repeat(48) })],
    ['oauth exchange', (controller: AuthController) => controller.nativeExchangeOAuth('https://app.example', { code: 'x'.repeat(32) })],
  ])('rejects a browser Origin on native %s', async (_name, invoke) => {
    const { controller } = subject();
    const rejection = Promise.resolve().then(() => invoke(controller));
    await expect(rejection).rejects.toBeInstanceOf(ForbiddenException);
    await expect(Promise.resolve().then(() => invoke(controller))).rejects.toMatchObject({
      response: { code: 'NATIVE_BROWSER_ORIGIN_REJECTED' },
    });
  });

  it('preserves the web login refresh cookie contract', async () => {
    const { controller } = subject();
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    await controller.login({ email: 'user@example.test', password: 'strong-password' }, response);
    expect(response.cookie).toHaveBeenCalledWith(
      'jagalchi_refresh',
      result.refreshToken,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/api/users/auth' }),
    );
  });

  it('keeps native logout body-token based', async () => {
    const { auth, controller } = subject();
    await controller.nativeLogout(undefined, { refreshToken: 'x'.repeat(48) });
    expect(auth.revoke).toHaveBeenCalledWith('x'.repeat(48));
  });
});
