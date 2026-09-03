import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { Readable } from 'node:stream';
import type { PeerCertificate } from 'node:tls';

import { describe, expect, it, vi } from 'vitest';

import { FixtureJobSourceAdapter, LiveJobSourceAdapter } from './job-source.adapters';
import { JobSourceError } from './job-source.errors';
import { createConfiguredJobSourceAdapter } from './job-source.module';
import { NodePinnedJobSourceTransport } from './node-pinned-job-source.transport';
import type { JobSourceHttpResponse, PinnedJobSourceRequest } from './job-source.types';

class FakeRequest extends EventEmitter {
  ended = false;
  destroyedWith: Error | undefined;

  end() {
    this.ended = true;
  }

  destroy(error?: Error) {
    this.destroyedWith = error;
  }
}

function incoming(
  status: number,
  headers: Record<string, string>,
  chunks: readonly Uint8Array[] = [],
): IncomingMessage {
  const response = Readable.from(chunks) as unknown as IncomingMessage;
  response.statusCode = status;
  response.headers = headers;
  return response;
}

function input(signal = new AbortController().signal): PinnedJobSourceRequest {
  return {
    url: new URL('https://jobs.example.com/roles/1?source=test'),
    approvedAddresses: [{ address: '93.184.216.34', family: 4 }],
    signal,
  };
}

async function readBody(response: JobSourceHttpResponse): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

describe('NodePinnedJobSourceTransport', () => {
  it('connects to the pinned IP while preserving Host, SNI, and certificate hostname', async () => {
    let requestOptions: RequestOptions | undefined;
    const certificateChecker = vi.fn(() => undefined);
    const request = vi.fn((options: RequestOptions, callback: (value: IncomingMessage) => void) => {
      requestOptions = options;
      const handle = new FakeRequest();
      queueMicrotask(() => callback(incoming(200, { 'content-type': 'text/plain' }, [Buffer.from('role')])));
      return handle;
    });
    const transport = new NodePinnedJobSourceTransport({
      request,
      checkServerIdentity: certificateChecker,
    });
    const response = await transport.request(input());

    expect(requestOptions).toMatchObject({
      hostname: '93.184.216.34',
      family: 4,
      servername: 'jobs.example.com',
      rejectUnauthorized: true,
      agent: false,
      method: 'GET',
      path: '/roles/1?source=test',
      headers: expect.objectContaining({ host: 'jobs.example.com', 'accept-encoding': 'identity' }),
    });
    expect(requestOptions).not.toHaveProperty('lookup');
    const check = requestOptions?.checkServerIdentity;
    expect(check).toBeTypeOf('function');
    expect(check?.('ignored.invalid', {} as PeerCertificate)).toBeUndefined();
    expect(certificateChecker).toHaveBeenCalledWith('jobs.example.com', {});
    await expect(readBody(response)).resolves.toBe('role');
  });

  it('passes redirects through without following or resolving them', async () => {
    const request = vi.fn((_options: RequestOptions, callback: (value: IncomingMessage) => void) => {
      const handle = new FakeRequest();
      queueMicrotask(() => callback(incoming(302, { location: '/next' })));
      return handle;
    });
    const response = await new NodePinnedJobSourceTransport({ request }).request(input());
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/next');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('aborts the socket and returns only the public timeout error', async () => {
    const controller = new AbortController();
    const handle = new FakeRequest();
    const transport = new NodePinnedJobSourceTransport({ request: () => handle });
    const pending = transport.request(input(controller.signal));
    controller.abort(new Error('private abort reason'));
    await expect(pending).rejects.toMatchObject({ code: 'JOB_SOURCE_TIMEOUT' });
    expect(handle.destroyedWith).toMatchObject({ code: 'JOB_SOURCE_TIMEOUT' });
    expect(String(handle.destroyedWith)).not.toContain('private abort reason');
  });

  it('caps the streamed response independently of the adapter', async () => {
    const request = vi.fn((_options: RequestOptions, callback: (value: IncomingMessage) => void) => {
      const handle = new FakeRequest();
      queueMicrotask(() => callback(incoming(200, {}, [Buffer.from('abc'), Buffer.from('def')])));
      return handle;
    });
    const response = await new NodePinnedJobSourceTransport({ maxBodyBytes: 5, request }).request(input());
    await expect(readBody(response)).rejects.toMatchObject({ code: 'JOB_SOURCE_BODY_TOO_LARGE' });
  });

  it('redacts certificate and transport failure details', async () => {
    const certificateRequest = vi.fn((options: RequestOptions) => {
      const handle = new FakeRequest();
      queueMicrotask(() => {
        const error = options.checkServerIdentity?.(
          'ignored.invalid',
          {} as PeerCertificate,
        );
        if (error) handle.emit('error', error);
      });
      return handle;
    });
    const certificateTransport = new NodePinnedJobSourceTransport({
      request: certificateRequest,
      checkServerIdentity: () => new Error('private certificate details'),
    });
    await expect(certificateTransport.request(input())).rejects.toSatisfy(
      (error: JobSourceError) =>
        error.code === 'JOB_SOURCE_FETCH_FAILED' &&
        error.cause === undefined &&
        !error.message.includes('private certificate details'),
    );

    const transportRequest = vi.fn(() => {
      const handle = new FakeRequest();
      queueMicrotask(() => handle.emit('error', new Error('private socket details')));
      return handle;
    });
    await expect(
      new NodePinnedJobSourceTransport({ request: transportRequest }).request(input()),
    ).rejects.toSatisfy(
      (error: JobSourceError) =>
        error.code === 'JOB_SOURCE_FETCH_FAILED' &&
        error.cause === undefined &&
        !error.message.includes('private socket details'),
    );
  });
});

describe('JobSourceModule factory', () => {
  const resolver = { resolve: vi.fn() };
  const transport = { request: vi.fn() };

  it('binds only the validated provider values', () => {
    expect(createConfiguredJobSourceAdapter('fixture', resolver, transport)).toBeInstanceOf(
      FixtureJobSourceAdapter,
    );
    expect(createConfiguredJobSourceAdapter('live', resolver, transport)).toBeInstanceOf(
      LiveJobSourceAdapter,
    );
    expect(() => createConfiguredJobSourceAdapter('other', resolver, transport)).toThrow(
      expect.objectContaining({ code: 'JOB_SOURCE_PROVIDER_UNSUPPORTED' }),
    );
  });
});
