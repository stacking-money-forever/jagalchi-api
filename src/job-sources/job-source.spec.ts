import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  FIXTURE_JOB_URL,
  FixtureJobSourceAdapter,
  LiveJobSourceAdapter,
  createJobSourceAdapter,
  validateManualCapture,
} from './job-source.adapters';
import { JobSourceError } from './job-source.errors';
import {
  LIVE_JOB_SOURCE_HOSTS,
  isPublicNetworkAddress,
  resolvePublicAddresses,
  validateJobSourceUrl,
} from './job-source.policy';
import type {
  JobSourceDnsResolver,
  JobSourceHttpResponse,
  PinnedJobSourceTransport,
  ResolvedAddress,
} from './job-source.types';

const ALLOWED_HOSTS = ['jobs.example.com', 'careers.example.com'];
const PUBLIC_V4: ResolvedAddress = { address: '8.8.8.8', family: 4 };

async function* body(...values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield new TextEncoder().encode(value);
}

function response(
  status: number,
  value = '',
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' },
): JobSourceHttpResponse {
  return { status, headers, body: body(value) };
}

function resolver(...answers: ReadonlyArray<readonly ResolvedAddress[]>): JobSourceDnsResolver {
  const resolve = vi.fn();
  for (const answer of answers) resolve.mockResolvedValueOnce(answer);
  return { resolve };
}

function adapter(
  dns: JobSourceDnsResolver,
  request: PinnedJobSourceTransport['request'],
  overrides: Partial<ConstructorParameters<typeof LiveJobSourceAdapter>[0]> = {},
): LiveJobSourceAdapter {
  return new LiveJobSourceAdapter({
    resolver: dns,
    transport: { request },
    allowedHosts: ALLOWED_HOSTS,
    now: () => new Date('2026-09-03T10:00:00.000Z'),
    ...overrides,
  });
}

function expectCode(code: JobSourceError['code']) {
  return expect.objectContaining({ code });
}

describe('job source URL and network policy', () => {
  it('uses a closed, static production host allowlist', () => {
    expect(LIVE_JOB_SOURCE_HOSTS).toEqual(['wanted.co.kr', 'www.wanted.co.kr']);
    expect(Object.isFrozen(LIVE_JOB_SOURCE_HOSTS)).toBe(true);
  });

  it.each([
    ['http://jobs.example.com/role', 'JOB_SOURCE_URL_INVALID'],
    ['https://user:pass@jobs.example.com/role', 'JOB_SOURCE_URL_INVALID'],
    ['https://jobs.example.com:444/role', 'JOB_SOURCE_URL_INVALID'],
    ['https://jobs.example.com/role#fragment', 'JOB_SOURCE_URL_INVALID'],
    ['https://other.example.com/role', 'JOB_SOURCE_HOST_UNSUPPORTED'],
    ['https://localhost/role', 'JOB_SOURCE_HOST_UNSUPPORTED'],
  ])('rejects unsafe URL %s', (value, code) => {
    expect(() => validateJobSourceUrl(value, [...ALLOWED_HOSTS, 'localhost'])).toThrow(
      expectCode(code as JobSourceError['code']),
    );
  });

  it.each([
    [{ address: '10.0.0.', family: 4 }, false],
    [{ address: '127.0.0.1', family: 4 }, false],
    [{ address: '169.254.1.1', family: 4 }, false],
    [{ address: '192.0.2.10', family: 4 }, false],
    [{ address: '224.0.0.1', family: 4 }, false],
    [{ address: '8.8.8.8', family: 4 }, true],
    [{ address: '::1', family: 6 }, false],
    [{ address: 'fc00::1', family: 6 }, false],
    [{ address: 'fe80::1', family: 6 }, false],
    [{ address: '2001:db8::1', family: 6 }, false],
    [{ address: '::ffff:127.0.0.1', family: 6 }, false],
    [{ address: '2606:4700:4700::1111', family: 6 }, true],
  ] as const)('classifies %o as public=%s', (value, expected) => {
    expect(isPublicNetworkAddress(value)).toBe(expected);
  });

  it('rejects the complete resolution when any answer is private', async () => {
    const dns = resolver([PUBLIC_V4, { address: '10.0.0.1', family: 4 }]);
    await expect(
      resolvePublicAddresses(new URL('https://jobs.example.com/role'), dns),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_ADDRESS_BLOCKED'));
  });
});

describe('fixture and manual capture', () => {
  it('returns a deterministic, versioned fixture capture without network dependencies', async () => {
    const subject = new FixtureJobSourceAdapter();
    const first = await subject.capture({ kind: 'FETCHED_URL', url: FIXTURE_JOB_URL });
    const second = await subject.capture({ kind: 'FETCHED_URL', url: FIXTURE_JOB_URL });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      captureVersion: 1,
      provenance: { provider: 'fixture', mode: 'FETCHED_URL', redirectUrls: [] },
    });
    expect(first.sourceHash).toBe(
      createHash('sha256').update(first.normalizedText).digest('hex'),
    );
    await expect(
      subject.capture({ kind: 'FETCHED_URL', url: 'https://fixture.invalid/jobs/other' }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_HOST_UNSUPPORTED'));
  });

  it('normalizes and hashes an explicit degraded manual capture without fetching its URL', () => {
    const result = validateManualCapture(
      {
        kind: 'MANUAL_CAPTURE',
        text: 'ＡＰＩ\r\n  contract   implementation with deterministic tests.',
        sourceTitle: '  Manual   posting ',
        sourceUrl: 'https://blocked.example/job/1',
        degradationReason: 'BLOCKED_SOURCE',
      },
      () => new Date('2026-09-03T10:00:00.000Z'),
    );
    expect(result.normalizedText).toBe(
      'API\ncontract implementation with deterministic tests.',
    );
    expect(result.provenance).toEqual({
      mode: 'DEGRADED_MANUAL_CAPTURE',
      provider: 'manual',
      requestedUrl: 'https://blocked.example/job/1',
      finalUrl: null,
      redirectUrls: [],
      degradationReason: 'BLOCKED_SOURCE',
      capturedAt: '2026-09-03T10:00:00.000Z',
    });
  });

  it.each([
    { text: 'short', sourceTitle: 'Title', degradationReason: 'USER_SUPPLIED' },
    { text: 'A sufficiently long manual job capture.', sourceTitle: '', degradationReason: 'USER_SUPPLIED' },
    { text: 'A sufficiently long manual job capture.', sourceTitle: 'Title', sourceUrl: 'http://example.com', degradationReason: 'USER_SUPPLIED' },
    { text: 'A sufficiently long manual job capture.', sourceTitle: 'Title', degradationReason: 'SUCCESS' },
  ])('rejects malformed degraded capture %#', (input) => {
    expect(() => validateManualCapture({ kind: 'MANUAL_CAPTURE', ...input } as never)).toThrow(
      expectCode('MANUAL_CAPTURE_INVALID'),
    );
  });

  it('selects only explicit fixture/live providers', () => {
    expect(createJobSourceAdapter('fixture')).toBeInstanceOf(FixtureJobSourceAdapter);
    expect(() => createJobSourceAdapter('live')).toThrow(
      expectCode('JOB_SOURCE_PROVIDER_UNSUPPORTED'),
    );
    expect(() => createJobSourceAdapter('unknown')).toThrow(
      expectCode('JOB_SOURCE_PROVIDER_UNSUPPORTED'),
    );
  });
});

describe('live job source adapter', () => {
  it('passes only validated addresses to the pinned transport and normalizes HTML', async () => {
    const dns = resolver([PUBLIC_V4]);
    const request = vi.fn().mockResolvedValue(
      response(
        200,
        '<title>  Senior ＡＰＩ Engineer </title><script>secret()</script><h1>Senior ＡＰＩ Engineer</h1><p>Build\r\n tested APIs &amp; docs.</p>',
      ),
    );
    const result = await adapter(dns, request).capture({
      kind: 'FETCHED_URL',
      url: 'https://jobs.example.com/role?id=1',
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: new URL('https://jobs.example.com/role?id=1'),
        approvedAddresses: [PUBLIC_V4],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.sourceTitle).toBe('Senior API Engineer');
    expect(result.normalizedText).toBe('Senior API Engineer\nBuild\ntested APIs & docs.');
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.provenance).toMatchObject({
      provider: 'live',
      finalUrl: 'https://jobs.example.com/role?id=1',
      capturedAt: '2026-09-03T10:00:00.000Z',
    });
  });

  it('re-resolves every redirect and blocks DNS rebinding before a second request', async () => {
    const dns = resolver([PUBLIC_V4], [{ address: '127.0.0.1', family: 4 }]);
    const request = vi.fn().mockResolvedValueOnce(
      response(302, '', { location: '/private', 'content-type': 'text/html' }),
    );
    await expect(
      adapter(dns, request).capture({
        kind: 'FETCHED_URL',
        url: 'https://jobs.example.com/start',
      }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_ADDRESS_BLOCKED'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(dns.resolve).toHaveBeenCalledTimes(2);
  });

  it('records an allowlisted redirect only after resolving and pinning both hops', async () => {
    const firstAddress: ResolvedAddress = { address: '8.8.8.8', family: 4 };
    const secondAddress: ResolvedAddress = { address: '1.1.1.1', family: 4 };
    const dns = resolver([firstAddress], [secondAddress]);
    const request = vi.fn()
      .mockResolvedValueOnce(response(307, '', { location: 'https://careers.example.com/final' }))
      .mockResolvedValueOnce(response(200, ' Final   role ', { 'content-type': 'text/plain' }));
    const result = await adapter(dns, request).capture({
      kind: 'FETCHED_URL', url: 'https://jobs.example.com/start',
    });
    expect(request.mock.calls[0]![0].approvedAddresses).toEqual([firstAddress]);
    expect(request.mock.calls[1]![0].approvedAddresses).toEqual([secondAddress]);
    expect(result.normalizedText).toBe('Final role');
    expect(result.provenance).toMatchObject({
      requestedUrl: 'https://jobs.example.com/start',
      finalUrl: 'https://careers.example.com/final',
      redirectUrls: ['https://careers.example.com/final'],
    });
  });

  it('rejects redirects to a non-allowlisted host before DNS or transport', async () => {
    const dns = resolver([PUBLIC_V4]);
    const request = vi.fn().mockResolvedValueOnce(
      response(302, '', { location: 'https://evil.example/role' }),
    );
    await expect(
      adapter(dns, request).capture({ kind: 'FETCHED_URL', url: 'https://jobs.example.com/start' }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_REDIRECT_INVALID'));
    expect(dns.resolve).toHaveBeenCalledTimes(1);
  });

  it('enforces the redirect cap', async () => {
    const dns = resolver([PUBLIC_V4], [PUBLIC_V4]);
    const request = vi.fn()
      .mockResolvedValueOnce(response(302, '', { location: '/two' }))
      .mockResolvedValueOnce(response(302, '', { location: '/three' }));
    await expect(
      adapter(dns, request, { redirectLimit: 1 }).capture({
        kind: 'FETCHED_URL', url: 'https://jobs.example.com/one',
      }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_REDIRECT_LIMIT'));
  });

  it('rejects unsupported content and declared or streamed oversize bodies', async () => {
    const unsupported = adapter(resolver([PUBLIC_V4]), vi.fn().mockResolvedValue(
      response(200, '{}', { 'content-type': 'application/json' }),
    ));
    await expect(
      unsupported.capture({ kind: 'FETCHED_URL', url: 'https://jobs.example.com/role' }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_CONTENT_TYPE_UNSUPPORTED'));

    const declared = adapter(resolver([PUBLIC_V4]), vi.fn().mockResolvedValue(
      response(200, 'small', { 'content-type': 'text/plain', 'content-length': '101' }),
    ), { maxBodyBytes: 100 });
    await expect(
      declared.capture({ kind: 'FETCHED_URL', url: 'https://jobs.example.com/role' }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_BODY_TOO_LARGE'));

    const streamed = adapter(resolver([PUBLIC_V4]), vi.fn().mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: body('a'.repeat(60), 'b'.repeat(60)),
    }), { maxBodyBytes: 100 });
    await expect(
      streamed.capture({ kind: 'FETCHED_URL', url: 'https://jobs.example.com/role' }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_BODY_TOO_LARGE'));
  });

  it('rejects non-success responses and malformed UTF-8 without exposing bodies', async () => {
    const failed = adapter(
      resolver([PUBLIC_V4]),
      vi.fn().mockResolvedValue(response(503, 'provider-private-body')),
    );
    await expect(
      failed.capture({ kind: 'FETCHED_URL', url: 'https://jobs.example.com/role' }),
    ).rejects.toEqual(expectCode('JOB_SOURCE_FETCH_FAILED'));

    const invalidUtf8 = adapter(resolver([PUBLIC_V4]), vi.fn().mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: (async function* () { yield Uint8Array.from([0xc3, 0x28]); })(),
    }));
    await expect(
      invalidUtf8.capture({ kind: 'FETCHED_URL', url: 'https://jobs.example.com/role' }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_FETCH_FAILED'));
  });

  it('enforces a total wall-clock budget even when transport ignores abort', async () => {
    const never = vi.fn(() => new Promise<JobSourceHttpResponse>(() => undefined));
    await expect(
      adapter(resolver([PUBLIC_V4]), never, { timeoutMs: 10 }).capture({
        kind: 'FETCHED_URL', url: 'https://jobs.example.com/role',
      }),
    ).rejects.toMatchObject(expectCode('JOB_SOURCE_TIMEOUT'));
  });
});
