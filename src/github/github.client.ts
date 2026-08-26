import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createSign } from 'node:crypto';
import {
  GITHUB_APP_PERMISSIONS,
  GithubInstallationAccount,
  GithubPullRequestBinding,
  GithubRepositoryIdentity,
  PullRequestFacts,
} from './github.dto';

export type GithubProviderErrorCode =
  | 'CONFIGURATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'RESPONSE_LIMIT'
  | 'INVALID_RESPONSE'
  | 'UPSTREAM';

export class GithubProviderError extends Error {
  constructor(
    readonly code: GithubProviderErrorCode,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(`GitHub provider request failed (${code})`);
    this.name = 'GithubProviderError';
  }
}

interface InstallationToken {
  token: string;
  expiresAt: Date;
}

export interface GithubPullRequestSummary {
  repositoryId: string;
  pullNumber: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  merged: boolean;
  baseBranch: string;
  headSha: string;
  htmlUrl: string;
}

type JsonObject = Record<string, unknown>;

const API_ORIGIN = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 10;
const MAX_PULL_REQUEST_PAGES = 3;
const PAGE_SIZE = 100;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DECIMAL_ID_PATTERN = /^[1-9]\d*$/;
const REPOSITORY_NAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/;

const asObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GithubProviderError('INVALID_RESPONSE');
  }
  return value as JsonObject;
};

const asArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new GithubProviderError('INVALID_RESPONSE');
  return value;
};

const asString = (value: unknown): string => {
  if (typeof value !== 'string') throw new GithubProviderError('INVALID_RESPONSE');
  return value;
};

const asBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new GithubProviderError('INVALID_RESPONSE');
  return value;
};

const asInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new GithubProviderError('INVALID_RESPONSE');
  }
  return value;
};

const asDecimalId = (value: unknown): string => {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !DECIMAL_ID_PATTERN.test(id)) {
    throw new GithubProviderError('INVALID_RESPONSE');
  }
  return id;
};

const base64Url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

@Injectable()
export class GithubClient {
  constructor(private readonly config: ConfigService) {}

  async getInstallation(githubInstallationId: string): Promise<GithubInstallationAccount> {
    const installationId = this.requireDecimalId(githubInstallationId);
    const response = asObject(
      await this.request(
        `/app/installations/${installationId}`,
        this.createAppJwt(),
        Date.now() + OPERATION_TIMEOUT_MS,
      ),
    );
    const account = asObject(response.account);
    const responseInstallationId = asDecimalId(response.id);
    const accountType = asString(account.type).toUpperCase();
    if (
      responseInstallationId !== installationId ||
      (accountType !== 'USER' && accountType !== 'ORGANIZATION')
    ) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    return {
      installationId: responseInstallationId,
      accountId: asDecimalId(account.id),
      accountType,
    };
  }

  async listInstallationRepositories(
    githubInstallationId: string,
  ): Promise<GithubRepositoryIdentity[]> {
    const deadline = Date.now() + OPERATION_TIMEOUT_MS;
    const token = await this.createInstallationToken(githubInstallationId, deadline);
    const repositories: GithubRepositoryIdentity[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = asObject(
        await this.request(
          `/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
          token.token,
          deadline,
        ),
      );
      const items = asArray(body.repositories);
      for (const value of items) {
        const repository = asObject(value);
        repositories.push({
          repositoryId: asDecimalId(repository.id),
          fullName: this.requireRepositoryName(asString(repository.full_name)),
          private: asBoolean(repository.private),
        });
      }
      if (items.length < PAGE_SIZE) return repositories;
    }

    throw new GithubProviderError('RESPONSE_LIMIT');
  }

  async getPullRequestFacts(
    githubInstallationId: string,
    repository: GithubRepositoryIdentity,
    pullNumber: number,
  ): Promise<PullRequestFacts> {
    const expectedRepositoryId = this.requireDecimalId(repository.repositoryId);
    const fullName = this.requireRepositoryName(repository.fullName);
    const canonicalPullNumber = this.requirePullNumber(pullNumber);
    const deadline = Date.now() + OPERATION_TIMEOUT_MS;
    const token = await this.createInstallationToken(githubInstallationId, deadline);
    const pull = asObject(
      await this.request(`/repos/${fullName}/pulls/${canonicalPullNumber}`, token.token, deadline),
    );
    const base = asObject(pull.base);
    const baseRepository = asObject(base.repo);
    const head = asObject(pull.head);
    const headSha = asString(head.sha).toLowerCase();
    const providerPullNumber = asInteger(pull.number);
    const providerRepositoryId = asDecimalId(baseRepository.id);
    if (
      providerPullNumber !== canonicalPullNumber ||
      providerRepositoryId !== expectedRepositoryId ||
      !SHA_PATTERN.test(headSha)
    ) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }

    const [changedPaths, checks, statuses] = await Promise.all([
      this.listPullRequestFiles(fullName, canonicalPullNumber, token.token, deadline),
      this.listCheckRuns(fullName, headSha, token.token, deadline),
      this.classicStatusesEnabled()
        ? this.listClassicStatuses(fullName, headSha, token.token, deadline)
        : Promise.resolve([]),
    ]);

    return {
      repositoryId: providerRepositoryId,
      pullNumber: providerPullNumber,
      headSha,
      merged: asBoolean(pull.merged),
      baseBranch: asString(base.ref),
      changedPaths,
      checks,
      statuses,
    };
  }

  async listPullRequests(
    githubInstallationId: string,
    repository: GithubRepositoryIdentity,
    state: 'open' | 'closed' | 'all',
  ): Promise<GithubPullRequestSummary[]> {
    const expectedRepositoryId = this.requireDecimalId(repository.repositoryId);
    const fullName = this.requireRepositoryName(repository.fullName);
    const canonicalState = this.requirePullRequestState(state);
    const deadline = Date.now() + OPERATION_TIMEOUT_MS;
    const token = await this.createInstallationToken(githubInstallationId, deadline);
    const pulls: GithubPullRequestSummary[] = [];

    for (let page = 1; page <= MAX_PULL_REQUEST_PAGES; page += 1) {
      const values = asArray(
        await this.request(
          `/repos/${fullName}/pulls?state=${canonicalState}&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`,
          token.token,
          deadline,
        ),
      );
      for (const value of values) {
        const pull = asObject(value);
        const base = asObject(pull.base);
        const baseRepository = asObject(base.repo);
        const providerRepositoryId = asDecimalId(baseRepository.id);
        const providerFullName = this.requireRepositoryName(asString(baseRepository.full_name));
        const pullNumber = this.requirePullNumber(asInteger(pull.number));
        const headSha = asString(asObject(pull.head).sha).toLowerCase();
        const providerState = asString(pull.state);
        const mergedAt = pull.merged_at;
        if (
          providerRepositoryId !== expectedRepositoryId ||
          providerFullName !== fullName ||
          !SHA_PATTERN.test(headSha) ||
          (providerState !== 'open' && providerState !== 'closed') ||
          (mergedAt !== null && typeof mergedAt !== 'string')
        ) {
          throw new GithubProviderError('INVALID_RESPONSE');
        }
        const htmlUrl = asString(pull.html_url);
        if (htmlUrl !== `https://github.com/${fullName}/pull/${pullNumber}`) {
          throw new GithubProviderError('INVALID_RESPONSE');
        }
        pulls.push({
          repositoryId: providerRepositoryId,
          pullNumber,
          title: this.requireBoundedString(pull.title, 512),
          state: providerState.toUpperCase() as 'OPEN' | 'CLOSED',
          merged: mergedAt !== null,
          baseBranch: this.requireBoundedString(base.ref, 255),
          headSha,
          htmlUrl,
        });
      }
      if (values.length < PAGE_SIZE) return pulls;
    }

    throw new GithubProviderError('RESPONSE_LIMIT');
  }

  async resolvePullRequestBinding(
    githubInstallationId: string,
    repository: GithubRepositoryIdentity,
    pullNumber: number,
  ): Promise<GithubPullRequestBinding> {
    const expectedRepositoryId = this.requireDecimalId(repository.repositoryId);
    const fullName = this.requireRepositoryName(repository.fullName);
    const canonicalPullNumber = this.requirePullNumber(pullNumber);
    const deadline = Date.now() + OPERATION_TIMEOUT_MS;
    const token = await this.createInstallationToken(githubInstallationId, deadline);
    const pull = asObject(
      await this.request(`/repos/${fullName}/pulls/${canonicalPullNumber}`, token.token, deadline),
    );
    const baseRepository = asObject(asObject(pull.base).repo);
    const providerRepositoryId = asDecimalId(baseRepository.id);
    const providerPullNumber = asInteger(pull.number);
    if (
      providerRepositoryId !== expectedRepositoryId ||
      providerPullNumber !== canonicalPullNumber
    ) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    const providerFullName = this.requireRepositoryName(asString(baseRepository.full_name));
    if (providerFullName !== fullName) throw new GithubProviderError('INVALID_RESPONSE');
    const pullUrl = asString(pull.html_url);
    const expectedUrl = `https://github.com/${fullName}/pull/${canonicalPullNumber}`;
    if (pullUrl !== expectedUrl) throw new GithubProviderError('INVALID_RESPONSE');
    return {
      repositoryId: providerRepositoryId,
      pullNumber: providerPullNumber,
      repositoryName: providerFullName,
      repositoryPrivate: asBoolean(baseRepository.private),
      pullTitle: this.requireBoundedString(pull.title, 256),
      pullUrl,
    };
  }

  async getPullRequestHead(
    githubInstallationId: string,
    repository: GithubRepositoryIdentity,
    pullNumber: number,
  ): Promise<{ repositoryId: string; pullNumber: number; headSha: string }> {
    const expectedRepositoryId = this.requireDecimalId(repository.repositoryId);
    const canonicalPullNumber = this.requirePullNumber(pullNumber);
    const fullName = this.requireRepositoryName(repository.fullName);
    const deadline = Date.now() + OPERATION_TIMEOUT_MS;
    const token = await this.createInstallationToken(githubInstallationId, deadline);
    const pull = asObject(
      await this.request(`/repos/${fullName}/pulls/${canonicalPullNumber}`, token.token, deadline),
    );
    const providerRepositoryId = asDecimalId(asObject(asObject(pull.base).repo).id);
    const providerPullNumber = asInteger(pull.number);
    const headSha = asString(asObject(pull.head).sha).toLowerCase();
    if (
      providerRepositoryId !== expectedRepositoryId ||
      providerPullNumber !== canonicalPullNumber ||
      !SHA_PATTERN.test(headSha)
    ) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    return { repositoryId: providerRepositoryId, pullNumber: providerPullNumber, headSha };
  }

  private async createInstallationToken(
    githubInstallationId: string,
    deadline: number,
  ): Promise<InstallationToken> {
    const installationId = this.requireDecimalId(githubInstallationId);
    const response = asObject(
      await this.request(
        `/app/installations/${installationId}/access_tokens`,
        this.createAppJwt(),
        deadline,
        {
          method: 'POST',
          body: JSON.stringify({ permissions: GITHUB_APP_PERMISSIONS }),
        },
      ),
    );
    const token = asString(response.token);
    const expiresAt = new Date(asString(response.expires_at));
    this.validateTokenPermissions(response.permissions);
    if (!token || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    return { token, expiresAt };
  }

  private createAppJwt(): string {
    const appId = this.config.get<string>('GITHUB_APP_ID')?.trim();
    const configuredKey = this.config.get<string>('GITHUB_APP_PRIVATE_KEY')?.trim();
    if (!appId || !DECIMAL_ID_PATTERN.test(appId) || !configuredKey) {
      throw new GithubProviderError('CONFIGURATION');
    }
    const privateKey = configuredKey.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const encodedHeader = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const encodedPayload = base64Url(
      JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }),
    );
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    try {
      const signer = createSign('RSA-SHA256');
      signer.update(unsignedToken);
      signer.end();
      return `${unsignedToken}.${signer.sign(createPrivateKey(privateKey), 'base64url')}`;
    } catch {
      throw new GithubProviderError('CONFIGURATION');
    }
  }

  private async listPullRequestFiles(
    fullName: string,
    pullNumber: number,
    token: string,
    deadline: number,
  ): Promise<string[]> {
    const paths: string[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const values = asArray(
        await this.request(
          `/repos/${fullName}/pulls/${pullNumber}/files?per_page=${PAGE_SIZE}&page=${page}`,
          token,
          deadline,
        ),
      );
      for (const value of values) paths.push(asString(asObject(value).filename));
      if (values.length < PAGE_SIZE) return [...new Set(paths)].sort();
    }
    throw new GithubProviderError('RESPONSE_LIMIT');
  }

  private async listCheckRuns(
    fullName: string,
    headSha: string,
    token: string,
    deadline: number,
  ): Promise<Array<{ name: string; successful: boolean }>> {
    const checks: Array<{ name: string; successful: boolean }> = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = asObject(
        await this.request(
          `/repos/${fullName}/commits/${headSha}/check-runs?per_page=${PAGE_SIZE}&page=${page}`,
          token,
          deadline,
          { headers: { Accept: 'application/vnd.github+json' } },
        ),
      );
      const values = asArray(body.check_runs);
      for (const value of values) {
        const check = asObject(value);
        checks.push({
          name: asString(check.name),
          successful: check.status === 'completed' && check.conclusion === 'success',
        });
      }
      if (values.length < PAGE_SIZE) {
        return [...new Map(checks.map((check) => [check.name, check])).values()];
      }
    }
    throw new GithubProviderError('RESPONSE_LIMIT');
  }

  private async listClassicStatuses(
    fullName: string,
    headSha: string,
    token: string,
    deadline: number,
  ): Promise<Array<{ context: string; successful: boolean }>> {
    const statuses: Array<{ context: string; successful: boolean }> = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const values = asArray(
        await this.request(
          `/repos/${fullName}/commits/${headSha}/statuses?per_page=${PAGE_SIZE}&page=${page}`,
          token,
          deadline,
        ),
      );
      for (const value of values) {
        const status = asObject(value);
        statuses.push({
          context: asString(status.context),
          successful: status.state === 'success',
        });
      }
      if (values.length < PAGE_SIZE) {
        const latestByContext = new Map<string, { context: string; successful: boolean }>();
        for (const status of statuses) {
          if (!latestByContext.has(status.context)) {
            latestByContext.set(status.context, status);
          }
        }
        return [...latestByContext.values()];
      }
    }
    throw new GithubProviderError('RESPONSE_LIMIT');
  }

  private async request(
    path: string,
    bearerToken: string,
    deadline: number,
    init: RequestInit = {},
  ): Promise<unknown> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GithubProviderError('TIMEOUT');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(remaining, REQUEST_TIMEOUT_MS));
    try {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/vnd.github+json');
      headers.set('Authorization', `Bearer ${bearerToken}`);
      headers.set('Content-Type', 'application/json');
      headers.set('User-Agent', 'jagalchi-api');
      headers.set('X-GitHub-Api-Version', '2022-11-28');
      const response = await fetch(`${API_ORIGIN}${path}`, {
        ...init,
        headers,
        redirect: 'error',
        signal: controller.signal,
      });
      const rawRequestId = response.headers.get('x-github-request-id');
      const requestId =
        rawRequestId && /^[A-Za-z0-9:.-]{1,100}$/.test(rawRequestId) ? rawRequestId : null;
      if (!response.ok) {
        if (response.status === 401) throw new GithubProviderError('UNAUTHORIZED', 401, requestId);
        if (response.status === 404) throw new GithubProviderError('NOT_FOUND', 404, requestId);
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
        ) {
          throw new GithubProviderError('RATE_LIMITED', response.status, requestId);
        }
        if (response.status === 403) throw new GithubProviderError('FORBIDDEN', 403, requestId);
        throw new GithubProviderError('UPSTREAM', response.status, requestId);
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new GithubProviderError('RESPONSE_LIMIT', response.status, requestId);
      }
      const body = await this.readResponseBytes(response, requestId);
      try {
        return JSON.parse(body.toString('utf8')) as unknown;
      } catch {
        throw new GithubProviderError('INVALID_RESPONSE', response.status, requestId);
      }
    } catch (error) {
      if (error instanceof GithubProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GithubProviderError('TIMEOUT');
      }
      throw new GithubProviderError('UPSTREAM');
    } finally {
      clearTimeout(timeout);
    }
  }

  private classicStatusesEnabled(): boolean {
    return this.config.get<string>('GITHUB_CLASSIC_STATUSES_ENABLED') !== 'false';
  }

  private validateTokenPermissions(value: unknown): void {
    const permissions = asObject(value);
    for (const [permission, access] of Object.entries(permissions)) {
      if (
        !['pull_requests', 'checks', 'statuses', 'metadata'].includes(permission) ||
        access !== 'read'
      ) {
        throw new GithubProviderError('FORBIDDEN');
      }
    }
    for (const permission of Object.keys(GITHUB_APP_PERMISSIONS)) {
      if (permissions[permission] !== 'read') throw new GithubProviderError('FORBIDDEN');
    }
  }

  private async readResponseBytes(response: Response, requestId: string | null): Promise<Buffer> {
    if (!response.body) throw new GithubProviderError('INVALID_RESPONSE', response.status, requestId);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GithubProviderError('RESPONSE_LIMIT', response.status, requestId);
      }
      chunks.push(Buffer.from(value));
    }
  }

  private requireDecimalId(value: string): string {
    if (!DECIMAL_ID_PATTERN.test(value)) throw new GithubProviderError('INVALID_RESPONSE');
    return value;
  }

  private requireRepositoryName(value: string): string {
    if (!REPOSITORY_NAME_PATTERN.test(value) || value.length > 255) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    return value;
  }

  private requirePullNumber(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    return value;
  }

  private requirePullRequestState(value: string): 'open' | 'closed' | 'all' {
    if (value !== 'open' && value !== 'closed' && value !== 'all') {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    return value;
  }

  private requireBoundedString(value: unknown, maxLength: number): string {
    const text = asString(value);
    if (text.length === 0 || text.length > maxLength) {
      throw new GithubProviderError('INVALID_RESPONSE');
    }
    return text;
  }
}
