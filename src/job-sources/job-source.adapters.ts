import { Buffer } from 'node:buffer';

import { JobSourceError } from './job-source.errors';
import { extractText, normalizeSourceText, sourceHash } from './job-source.normalization';
import {
  LIVE_JOB_SOURCE_HOSTS,
  resolvePublicAddresses,
  validateJobSourceUrl,
} from './job-source.policy';
import type {
  FetchedUrlInput,
  JobSourceAdapter,
  JobSourceCapture,
  JobSourceDnsResolver,
  JobSourceHttpResponse,
  JobSourceProvider,
  ManualCaptureInput,
  PinnedJobSourceTransport,
} from './job-source.types';

export const FIXTURE_JOB_URL = 'https://fixture.invalid/jobs/software-engineer';
export const JOB_SOURCE_CAPTURE_VERSION = 1 as const;

const FIXTURE_TITLE = 'Fixture Software Engineer';
const FIXTURE_TEXT = normalizeSourceText(`
  Software Engineer

  Build a production-shaped TypeScript API feature with deterministic tests.
  Document rollback behavior and provide observable verification evidence.
`);

export interface LiveJobSourceOptions {
  resolver: JobSourceDnsResolver;
  transport: PinnedJobSourceTransport;
  allowedHosts?: readonly string[];
  redirectLimit?: number;
  maxBodyBytes?: number;
  timeoutMs?: number;
  now?: () => Date;
}

function capture(
  sourceTitle: string,
  normalizedText: string,
  provenance: JobSourceCapture['provenance'],
): JobSourceCapture {
  if (!normalizedText) throw new JobSourceError('JOB_SOURCE_FETCH_FAILED');
  return {
    schemaVersion: 1,
    captureVersion: JOB_SOURCE_CAPTURE_VERSION,
    sourceTitle,
    normalizedText,
    sourceHash: sourceHash(normalizedText),
    provenance,
  };
}

export class FixtureJobSourceAdapter implements JobSourceAdapter {
  readonly provider = 'fixture' as const;

  async capture(input: FetchedUrlInput): Promise<JobSourceCapture> {
    if (input.kind !== 'FETCHED_URL' || input.url !== FIXTURE_JOB_URL) {
      throw new JobSourceError('JOB_SOURCE_HOST_UNSUPPORTED');
    }
    return capture(FIXTURE_TITLE, FIXTURE_TEXT, {
      mode: 'FETCHED_URL',
      provider: 'fixture',
      requestedUrl: FIXTURE_JOB_URL,
      finalUrl: FIXTURE_JOB_URL,
      redirectUrls: [],
      degradationReason: null,
      capturedAt: '2026-09-03T00:00:00.000Z',
    });
  }
}

export class LiveJobSourceAdapter implements JobSourceAdapter {
  readonly provider = 'live' as const;
  private readonly allowedHosts: readonly string[];
  private readonly redirectLimit: number;
  private readonly maxBodyBytes: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: LiveJobSourceOptions) {
    this.allowedHosts = Object.freeze([...(options.allowedHosts ?? LIVE_JOB_SOURCE_HOSTS)]);
    this.redirectLimit = options.redirectLimit ?? 3;
    this.maxBodyBytes = options.maxBodyBytes ?? 512 * 1_024;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.now = options.now ?? (() => new Date());
    if (!this.allowedHosts.length || this.redirectLimit < 0 || this.redirectLimit > 5) {
      throw new JobSourceError('JOB_SOURCE_PROVIDER_UNSUPPORTED');
    }
  }

  async capture(input: FetchedUrlInput): Promise<JobSourceCapture> {
    if (input.kind !== 'FETCHED_URL') throw new JobSourceError('JOB_SOURCE_URL_INVALID');
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new JobSourceError('JOB_SOURCE_TIMEOUT'));
      }, this.timeoutMs);
      timeout.unref();
    });
    try {
      return await Promise.race([this.captureWithRedirects(input.url, controller.signal), deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async captureWithRedirects(rawUrl: string, signal: AbortSignal): Promise<JobSourceCapture> {
    const requested = validateJobSourceUrl(rawUrl, this.allowedHosts);
    let current = requested;
    const redirects: string[] = [];
    while (true) {
      const approvedAddresses = await resolvePublicAddresses(current, this.options.resolver);
      let response: JobSourceHttpResponse;
      try {
        response = await this.options.transport.request({
          url: new URL(current), approvedAddresses, signal,
        });
      } catch (error) {
        if (error instanceof JobSourceError) throw error;
        if (signal.aborted) throw new JobSourceError('JOB_SOURCE_TIMEOUT', { cause: error });
        throw new JobSourceError('JOB_SOURCE_FETCH_FAILED', { cause: error });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.dispose?.();
        if (redirects.length >= this.redirectLimit) {
          throw new JobSourceError('JOB_SOURCE_REDIRECT_LIMIT');
        }
        const location = this.header(response, 'location');
        if (!location) throw new JobSourceError('JOB_SOURCE_REDIRECT_INVALID');
        let redirected: URL;
        try {
          redirected = new URL(location, current);
        } catch (error) {
          throw new JobSourceError('JOB_SOURCE_REDIRECT_INVALID', { cause: error });
        }
        try {
          current = validateJobSourceUrl(redirected.toString(), this.allowedHosts);
        } catch (error) {
          throw new JobSourceError('JOB_SOURCE_REDIRECT_INVALID', { cause: error });
        }
        redirects.push(current.toString());
        continue;
      }
      if (response.status !== 200) {
        response.dispose?.();
        throw new JobSourceError('JOB_SOURCE_FETCH_FAILED');
      }
      let contentType: string;
      let bytes: Uint8Array;
      try {
        contentType = this.contentType(response);
        bytes = await this.readBody(response);
      } finally {
        response.dispose?.();
      }
      const extracted = extractText(contentType, bytes);
      return capture(extracted.sourceTitle ?? current.hostname, extracted.normalizedText, {
        mode: 'FETCHED_URL',
        provider: 'live',
        requestedUrl: requested.toString(),
        finalUrl: current.toString(),
        redirectUrls: redirects,
        degradationReason: null,
        capturedAt: this.now().toISOString(),
      });
    }
  }

  private header(response: JobSourceHttpResponse, name: string): string | undefined {
    const match = Object.entries(response.headers).find(([key]) => key.toLowerCase() === name);
    return match?.[1];
  }

  private contentType(response: JobSourceHttpResponse): string {
    const value = this.header(response, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (!value || !['text/html', 'text/plain', 'application/xhtml+xml'].includes(value)) {
      throw new JobSourceError('JOB_SOURCE_CONTENT_TYPE_UNSUPPORTED');
    }
    return value === 'application/xhtml+xml' ? 'text/html' : value;
  }

  private async readBody(response: JobSourceHttpResponse): Promise<Uint8Array> {
    const declaredLength = this.header(response, 'content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > this.maxBodyBytes)) {
      throw new JobSourceError('JOB_SOURCE_BODY_TOO_LARGE');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > this.maxBodyBytes) throw new JobSourceError('JOB_SOURCE_BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }
}

export function validateManualCapture(input: ManualCaptureInput, now = () => new Date()): JobSourceCapture {
  if (input.kind !== 'MANUAL_CAPTURE') throw new JobSourceError('MANUAL_CAPTURE_INVALID');
  const sourceTitle = normalizeSourceText(input.sourceTitle);
  const normalizedText = normalizeSourceText(input.text);
  if (
    sourceTitle.length < 1 || sourceTitle.length > 300 ||
    normalizedText.length < 20 || normalizedText.length > 200_000 ||
    !['BLOCKED_SOURCE', 'UNSUPPORTED_SOURCE', 'FETCH_FAILED', 'USER_SUPPLIED'].includes(input.degradationReason)
  ) throw new JobSourceError('MANUAL_CAPTURE_INVALID');
  let sourceUrl: string | null = null;
  if (input.sourceUrl !== undefined) {
    try {
      const parsed = new URL(input.sourceUrl);
      if (
        input.sourceUrl.length > 2_048 || parsed.protocol !== 'https:' || parsed.username ||
        parsed.password || parsed.hash || (parsed.port && parsed.port !== '443')
      ) throw new Error('invalid manual source URL');
      sourceUrl = parsed.toString();
    } catch (error) {
      throw new JobSourceError('MANUAL_CAPTURE_INVALID', { cause: error });
    }
  }
  return capture(sourceTitle, normalizedText, {
    mode: 'DEGRADED_MANUAL_CAPTURE',
    provider: 'manual',
    requestedUrl: sourceUrl,
    finalUrl: null,
    redirectUrls: [],
    degradationReason: input.degradationReason,
    capturedAt: now().toISOString(),
  });
}

export function createJobSourceAdapter(
  provider: string,
  liveOptions?: LiveJobSourceOptions,
): JobSourceAdapter {
  if (provider === 'fixture') return new FixtureJobSourceAdapter();
  if (provider === 'live' && liveOptions) return new LiveJobSourceAdapter(liveOptions);
  throw new JobSourceError('JOB_SOURCE_PROVIDER_UNSUPPORTED');
}

export function isJobSourceProvider(value: string): value is JobSourceProvider {
  return value === 'fixture' || value === 'live';
}
