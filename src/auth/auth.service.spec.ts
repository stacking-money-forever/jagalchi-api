import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthProvider } from './auth.entities';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  afterEach(() => vi.unstubAllGlobals());

  const createSubject = () => {
    let savedUser: Record<string, unknown> | null = null;
    const users = {
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => {
        savedUser = { id: 'user-1', ...value };
        return savedUser;
      }),
      findOne: vi.fn(async () => savedUser),
    };
    const sessions = {
      create: vi.fn((value) => ({ id: 'session-1', ...value })),
      save: vi.fn(async (value) => value),
    };
    const attempts = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ id: 'attempt-1', ...value })),
    };
    let verificationChallenge: Record<string, unknown> | null = null;
    const verificationChallenges = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => {
        verificationChallenge = {
          id: 'challenge-1',
          createdAt: new Date(),
          ...value,
        };
        return verificationChallenge;
      }),
      findOne: vi.fn(async () => verificationChallenge),
      delete: vi.fn(),
    };
    const configValues: Record<string, string> = {
      WEB_APP_URL: 'https://jagalchi.dev',
      PUBLIC_API_URL: 'https://api.jagalchi.dev',
      OAUTH_GOOGLE_CLIENT_ID: 'google-client',
      VERIFICATION_CODE_SECRET: 'verification-code-secret-with-32-characters',
      EMAIL_DELIVERY_URL: 'https://email.internal/send',
      EMAIL_DELIVERY_TOKEN: 'delivery-token',
    };
    const config = {
      getOrThrow: vi.fn((key: string) => {
        const value = configValues[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
      }),
    };
    const jwt = {
      signAsync: vi.fn().mockResolvedValue('access-token'),
      verifyAsync: vi.fn().mockResolvedValue({
        sub: 'user@example.com',
        type: 'registration-proof',
      }),
    };
    const tickets = { openAccount: vi.fn().mockResolvedValue({ balance: 30 }) };
    const service = new AuthService(
      config as never,
      jwt as never,
      {} as never,
      tickets as never,
      users as never,
      {} as never,
      sessions as never,
      attempts as never,
      {} as never,
      verificationChallenges as never,
    );
    return { attempts, service, sessions, tickets, users, verificationChallenges };
  };

  it('hashes a new password and opens the approved signup ticket account', async () => {
    const subject = createSubject();
    const result = await subject.service.register({
      email: ' USER@Example.com ',
      name: '민지',
      password: 'strong-password',
      registrationProof: 'registration-proof-token-value-1234',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(subject.users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        passwordHash: expect.stringMatching(/^scrypt\$/),
      }),
    );
    expect(subject.tickets.openAccount).toHaveBeenCalledWith('user-1');
    expect(subject.sessions.save).toHaveBeenCalledOnce();
  });

  it('does not accept a wrong password for an existing account', async () => {
    const subject = createSubject();
    await subject.service.register({
      email: 'user@example.com',
      name: '민지',
      password: 'strong-password',
      registrationProof: 'registration-proof-token-value-1234',
    });
    await expect(
      subject.service.login({
        email: 'user@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates a stateful PKCE Google authorization request', async () => {
    const subject = createSubject();
    const url = new URL(await subject.service.startOAuth(OAuthProvider.Google));

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('google-client');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.jagalchi.dev/api/users/auth/callback/google',
    );
    expect(subject.attempts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: 'https://jagalchi.dev/auth/callback',
        provider: OAuthProvider.Google,
      }),
    );
  });

  it('sends and verifies a one-time registration code without returning it to clients', async () => {
    const subject = createSubject();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await subject.service.sendEmailVerification({ email: 'USER@example.com' });
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const delivery = JSON.parse(String(request?.body)) as {
      to: string;
      variables: { code: string };
    };
    expect(delivery.to).toBe('user@example.com');
    expect(delivery.variables.code).toMatch(/^[0-9]{6}$/);

    await expect(
      subject.service.verifyEmail({
        email: 'user@example.com',
        code: delivery.variables.code,
      }),
    ).resolves.toEqual({ registrationProof: 'access-token' });
    expect(subject.verificationChallenges.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ consumedAt: expect.any(Date) }),
    );
  });
});
