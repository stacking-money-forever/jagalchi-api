import { Buffer } from 'node:buffer';
import type { IncomingMessage } from 'node:http';
import {
  request as httpsRequest,
  type RequestOptions,
} from 'node:https';
import {
  checkServerIdentity as tlsCheckServerIdentity,
  type DetailedPeerCertificate,
  type PeerCertificate,
} from 'node:tls';

import { JobSourceError } from './job-source.errors';
import type {
  JobSourceHttpResponse,
  PinnedJobSourceRequest,
  PinnedJobSourceTransport,
} from './job-source.types';

type RequestCallback = (response: IncomingMessage) => void;
type RequestHandle = {
  once(event: 'error', listener: (error: Error) => void): unknown;
  destroy(error?: Error): void;
  end(): void;
};
type RequestImplementation = (
  options: RequestOptions,
  callback: RequestCallback,
) => RequestHandle;
type CertificateChecker = (
  hostname: string,
  certificate: PeerCertificate | DetailedPeerCertificate,
) => Error | undefined;

export interface NodePinnedJobSourceTransportOptions {
  maxBodyBytes?: number;
  request?: RequestImplementation;
  checkServerIdentity?: CertificateChecker;
}

export class NodePinnedJobSourceTransport implements PinnedJobSourceTransport {
  private readonly maxBodyBytes: number;
  private readonly requestImplementation: RequestImplementation;
  private readonly certificateChecker: CertificateChecker;

  constructor(options: NodePinnedJobSourceTransportOptions = {}) {
    this.maxBodyBytes = options.maxBodyBytes ?? 512 * 1_024;
    this.requestImplementation = options.request ?? httpsRequest;
    this.certificateChecker = options.checkServerIdentity ?? tlsCheckServerIdentity;
    if (!Number.isSafeInteger(this.maxBodyBytes) || this.maxBodyBytes < 1) {
      throw new JobSourceError('JOB_SOURCE_PROVIDER_UNSUPPORTED');
    }
  }

  async request(input: PinnedJobSourceRequest): Promise<JobSourceHttpResponse> {
    if (input.signal.aborted) throw new JobSourceError('JOB_SOURCE_TIMEOUT');
    const address = input.approvedAddresses[0];
    if (!address) throw new JobSourceError('JOB_SOURCE_ADDRESS_BLOCKED');
    const originalHostname = input.url.hostname;
    return new Promise<JobSourceHttpResponse>((resolve, reject) => {
      let settled = false;
      let request: RequestHandle | undefined;
      const rejectSafely = (code: 'JOB_SOURCE_TIMEOUT' | 'JOB_SOURCE_FETCH_FAILED', cause?: unknown) => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener('abort', abort);
        reject(new JobSourceError(code, { cause }));
      };
      const abort = () => {
        const error = new JobSourceError('JOB_SOURCE_TIMEOUT');
        request?.destroy(error);
        rejectSafely('JOB_SOURCE_TIMEOUT', error);
      };
      try {
        request = this.requestImplementation(
          {
            protocol: 'https:',
            hostname: address.address,
            family: address.family,
            port: input.url.port ? Number(input.url.port) : 443,
            method: 'GET',
            path: `${input.url.pathname}${input.url.search}`,
            headers: {
              accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
              'accept-encoding': 'identity',
              host: input.url.host,
              'user-agent': 'JagalchiJobSource/1',
            },
            servername: originalHostname,
            rejectUnauthorized: true,
            agent: false,
            checkServerIdentity: (_hostname, certificate) =>
              this.certificateChecker(originalHostname, certificate),
          },
          (response) => {
            if (settled) {
              response.destroy();
              return;
            }
            settled = true;
            input.signal.removeEventListener('abort', abort);
            resolve({
              status: response.statusCode ?? 0,
              headers: this.headers(response),
              body: this.boundedBody(response, input.signal),
              dispose: () => response.destroy(),
            });
          },
        );
      } catch (error) {
        rejectSafely('JOB_SOURCE_FETCH_FAILED', error);
        return;
      }
      request.once('error', (error) => {
        rejectSafely(input.signal.aborted ? 'JOB_SOURCE_TIMEOUT' : 'JOB_SOURCE_FETCH_FAILED', error);
      });
      input.signal.addEventListener('abort', abort, { once: true });
      if (input.signal.aborted) abort();
      else request.end();
    });
  }

  private headers(response: IncomingMessage): Readonly<Record<string, string | undefined>> {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(response.headers).map(([name, value]) => [
          name.toLowerCase(),
          Array.isArray(value) ? value.join(', ') : value,
        ]),
      ),
    );
  }

  private async *boundedBody(
    response: IncomingMessage,
    signal: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    let total = 0;
    const abort = () => response.destroy(new JobSourceError('JOB_SOURCE_TIMEOUT'));
    if (signal.aborted) {
      abort();
      throw new JobSourceError('JOB_SOURCE_TIMEOUT');
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      for await (const value of response) {
        if (signal.aborted) throw new JobSourceError('JOB_SOURCE_TIMEOUT');
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
        total += chunk.byteLength;
        if (total > this.maxBodyBytes) {
          response.destroy();
          throw new JobSourceError('JOB_SOURCE_BODY_TOO_LARGE');
        }
        yield chunk;
      }
    } catch (error) {
      if (error instanceof JobSourceError) throw error;
      throw new JobSourceError(
        signal.aborted ? 'JOB_SOURCE_TIMEOUT' : 'JOB_SOURCE_FETCH_FAILED',
        { cause: error },
      );
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
}
