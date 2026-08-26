import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_APP_PERMISSIONS } from './github.dto';
import { GithubClient, GithubProviderError } from './github.client';

const installationToken = 'ghs_synthetic_installation_token_never_log';
const privateMarker = 'SYNTHETIC_PRIVATE_KEY_MATERIAL';
const sha = 'a'.repeat(40);
const repository = { repositoryId: '101', fullName: 'synthetic-owner/proof-repo', private: true };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function config(classicStatuses = true) {
  const values: Record<string, string> = {
    GITHUB_APP_ID: '9001',
    GITHUB_APP_PRIVATE_KEY: pem,
    GITHUB_CLASSIC_STATUSES_ENABLED: String(classicStatuses),
  };
  return { get: vi.fn((key: string) => values[key]) };
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });
}

function tokenResponse() {
  return json({
    token: installationToken,
    expires_at: '2099-01-01T00:00:00.000Z',
    permissions: GITHUB_APP_PERMISSIONS,
  });
}

function bearer(call: unknown[]) {
  return new Headers((call[1] as RequestInit).headers).get('authorization');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GithubClient trust boundary', () => {
  it('mints a short-lived RS256 app JWT and exchanges it for the exact read-only permission set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json({ repositories: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await new GithubClient(config() as never).listInstallationRepositories('501');

    const tokenExchange = fetchMock.mock.calls[0]!;
    expect(tokenExchange[0]).toBe('https://api.github.com/app/installations/501/access_tokens');
    expect((tokenExchange[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((tokenExchange[1] as RequestInit).body as string)).toEqual({ permissions: GITHUB_APP_PERMISSIONS });
    const appJwt = bearer(tokenExchange)!.slice('Bearer '.length);
    const segments = appJwt.split('.');
    expect(segments).toHaveLength(3);
    expect(JSON.parse(Buffer.from(segments[0]!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(segments[1]!, 'base64url').toString())).toMatchObject({ iss: '9001' });
    expect(bearer(fetchMock.mock.calls[1]!)).toBe(`Bearer ${installationToken}`);
  });

  it('never includes JWTs, installation tokens, private key material, or response bodies in provider errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: installationToken, private: privateMarker }), {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-github-request-id': 'SYNTHETIC-REQUEST-1' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await new GithubClient(config() as never)
      .listInstallationRepositories('501')
      .catch((caught: unknown) => caught) as GithubProviderError;
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 403, requestId: 'SYNTHETIC-REQUEST-1' });
    const exposed = `${error.name}:${error.message}:${error.stack}`;
    expect(exposed).not.toContain(installationToken);
    expect(exposed).not.toContain(privateMarker);
    expect(exposed).not.toContain('eyJ');
  });

  it('bounds pagination and fails instead of silently accepting an incomplete repository membership set', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: String(1000 + index), full_name: `synthetic-owner/repo-${index}`, private: index % 2 === 0,
    }));
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/access_tokens') ? tokenResponse() : json({ repositories: fullPage }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new GithubClient(config() as never).listInstallationRepositories('501'))
      .rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('page=10');
  });

  it('maps aborts to a typed timeout without exposing authorization', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('network detail'), { name: 'AbortError' })));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = new GithubClient(config() as never).getInstallation('501');
    const expectation = expect(pending).rejects.toMatchObject({
      code: 'TIMEOUT', status: null, requestId: null,
    });
    await vi.advanceTimersByTimeAsync(5_001);
    await expectation;
  });

  it('rejects oversized responses before parsing them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
    })));
    await expect(new GithubClient(config() as never).getInstallation('501'))
      .rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
  });

  it('normalizes canonical PR facts, deduplicates files/checks/statuses, and treats every non-success terminal or pending result as unsuccessful', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/access_tokens')) return tokenResponse();
      if (/\/pulls\/7$/.test(url)) return json({
        number: 7, merged: true, base: { ref: 'main', repo: { id: 101 } }, head: { sha: sha.toUpperCase() },
      });
      if (url.includes('/files?')) return json([
        { filename: 'tests/proof.spec.ts' }, { filename: 'src/proof.ts' }, { filename: 'src/proof.ts' },
      ]);
      if (url.includes('/check-runs?')) return json({ check_runs: [
        { name: 'ci/test', status: 'completed', conclusion: 'failure' },
        { name: 'ci/test', status: 'completed', conclusion: 'success' },
        { name: 'ci/pending', status: 'in_progress', conclusion: null },
        { name: 'ci/cancelled', status: 'completed', conclusion: 'cancelled' },
        { name: 'ci/neutral', status: 'completed', conclusion: 'neutral' },
        { name: 'ci/timed-out', status: 'completed', conclusion: 'timed_out' },
      ] });
      if (url.includes('/statuses?')) return json([
        { context: 'deploy', state: 'failure' }, { context: 'deploy', state: 'success' },
        { context: 'security', state: 'pending' },
      ]);
      throw new Error(`Unexpected synthetic URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GithubClient(config() as never).getPullRequestFacts('501', repository, 7);
    expect(result).toEqual({
      repositoryId: '101', pullNumber: 7, headSha: sha, merged: true, baseBranch: 'main',
      changedPaths: ['src/proof.ts', 'tests/proof.spec.ts'],
      checks: [
        { name: 'ci/test', successful: true },
        { name: 'ci/pending', successful: false },
        { name: 'ci/cancelled', successful: false },
        { name: 'ci/neutral', successful: false },
        { name: 'ci/timed-out', successful: false },
      ],
      statuses: [{ context: 'deploy', successful: false }, { context: 'security', successful: false }],
    });
  });

  it('keeps the newest classic status when a stale success follows a failure', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/access_tokens')) return tokenResponse();
      if (/\/pulls\/7$/.test(url)) return json({
        number: 7, merged: false, base: { ref: 'main', repo: { id: 101 } }, head: { sha },
      });
      if (url.includes('/files?')) return json([]);
      if (url.includes('/check-runs?')) return json({ check_runs: [] });
      if (url.includes('/statuses?')) return json([
        { context: 'deploy', state: 'failure' },
        { context: 'deploy', state: 'success' },
      ]);
      throw new Error(`Unexpected synthetic URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GithubClient(config() as never).getPullRequestFacts('501', repository, 7);
    expect(result.statuses).toEqual([{ context: 'deploy', successful: false }]);
  });

  it('keeps the newest classic status when a stale failure follows a success', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/access_tokens')) return tokenResponse();
      if (/\/pulls\/7$/.test(url)) return json({
        number: 7, merged: false, base: { ref: 'main', repo: { id: 101 } }, head: { sha },
      });
      if (url.includes('/files?')) return json([]);
      if (url.includes('/check-runs?')) return json({ check_runs: [] });
      if (url.includes('/statuses?')) return json([
        { context: 'deploy', state: 'success' },
        { context: 'deploy', state: 'failure' },
      ]);
      throw new Error(`Unexpected synthetic URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GithubClient(config() as never).getPullRequestFacts('501', repository, 7);
    expect(result.statuses).toEqual([{ context: 'deploy', successful: true }]);
  });

  it('lists bounded pull-request projections without exposing provider-private fields', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/access_tokens')) return tokenResponse();
      return json([{
        id: 999,
        node_id: 'provider-private',
        number: 7,
        title: 'Synthetic PR',
        state: 'closed',
        merged_at: '2026-08-25T00:00:00Z',
        base: { ref: 'main', repo: { id: 101, full_name: repository.fullName, private: true } },
        head: { sha: sha.toUpperCase(), repo: { id: 202 } },
        html_url: `${`https://github.com/${repository.fullName}`}/pull/7`,
        user: { login: 'provider-private' },
      }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GithubClient(config() as never)
      .listPullRequests('501', repository, 'all');

    expect(result).toEqual([{
      repositoryId: '101',
      pullNumber: 7,
      title: 'Synthetic PR',
      state: 'CLOSED',
      merged: true,
      baseBranch: 'main',
      headSha: sha,
      htmlUrl: `https://github.com/${repository.fullName}/pull/7`,
    }]);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/pulls?state=all&sort=updated&direction=desc&per_page=100&page=1',
    );
  });

  it('bounds pull-request pagination instead of returning a partial list', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      title: `Synthetic PR ${index + 1}`,
      state: 'open',
      merged_at: null,
      base: { ref: 'main', repo: { id: 101, full_name: repository.fullName } },
      head: { sha },
      html_url: `https://github.com/${repository.fullName}/pull/${index + 1}`,
    }));
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/access_tokens') ? tokenResponse() : json(fullPage));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new GithubClient(config() as never).listPullRequests('501', repository, 'open'))
      .rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('page=3');
  });

  it('rejects provider PR identities and URLs that do not match the authorized repository and pull number', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/access_tokens')) return tokenResponse();
      return json({
        number: 7, title: 'Synthetic PR', html_url: 'https://github.com/attacker/repo/pull/7',
        base: { repo: { id: 101, full_name: repository.fullName, private: true } },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(new GithubClient(config() as never).resolvePullRequestBinding('501', repository, 7))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
