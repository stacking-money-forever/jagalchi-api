export type JobSourceProvider = 'fixture' | 'live';

export type JobSourceFailureCode =
  | 'JOB_SOURCE_PROVIDER_UNSUPPORTED'
  | 'JOB_SOURCE_URL_INVALID'
  | 'JOB_SOURCE_HOST_UNSUPPORTED'
  | 'JOB_SOURCE_ADDRESS_BLOCKED'
  | 'JOB_SOURCE_REDIRECT_INVALID'
  | 'JOB_SOURCE_REDIRECT_LIMIT'
  | 'JOB_SOURCE_CONTENT_TYPE_UNSUPPORTED'
  | 'JOB_SOURCE_BODY_TOO_LARGE'
  | 'JOB_SOURCE_TIMEOUT'
  | 'JOB_SOURCE_FETCH_FAILED'
  | 'MANUAL_CAPTURE_INVALID';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface JobSourceDnsResolver {
  resolve(hostname: string): Promise<readonly ResolvedAddress[]>;
}

export interface PinnedJobSourceRequest {
  url: URL;
  approvedAddresses: readonly ResolvedAddress[];
  signal: AbortSignal;
}

export interface JobSourceHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: AsyncIterable<Uint8Array>;
  dispose?: () => void;
}

/**
 * The implementation must connect to one of approvedAddresses while retaining
 * url.hostname for TLS SNI and certificate verification. It must not resolve
 * the hostname again and must not follow redirects automatically.
 */
export interface PinnedJobSourceTransport {
  request(input: PinnedJobSourceRequest): Promise<JobSourceHttpResponse>;
}

export interface FetchedUrlInput {
  kind: 'FETCHED_URL';
  url: string;
}

export type ManualCaptureReason =
  | 'BLOCKED_SOURCE'
  | 'UNSUPPORTED_SOURCE'
  | 'FETCH_FAILED'
  | 'USER_SUPPLIED';

export interface ManualCaptureInput {
  kind: 'MANUAL_CAPTURE';
  text: string;
  sourceTitle: string;
  sourceUrl?: string;
  degradationReason: ManualCaptureReason;
}

export interface JobSourceProvenance {
  mode: 'FETCHED_URL' | 'DEGRADED_MANUAL_CAPTURE';
  provider: JobSourceProvider | 'manual';
  requestedUrl: string | null;
  finalUrl: string | null;
  redirectUrls: string[];
  degradationReason: ManualCaptureReason | null;
  capturedAt: string;
}

export interface JobSourceCapture {
  schemaVersion: 1;
  captureVersion: 1;
  sourceTitle: string;
  normalizedText: string;
  sourceHash: string;
  provenance: JobSourceProvenance;
}

export interface JobSourceAdapter {
  readonly provider: JobSourceProvider;
  capture(input: FetchedUrlInput): Promise<JobSourceCapture>;
}
