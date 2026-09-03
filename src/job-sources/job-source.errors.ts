import type { JobSourceFailureCode } from './job-source.types';

const PUBLIC_MESSAGES: Record<JobSourceFailureCode, string> = {
  JOB_SOURCE_PROVIDER_UNSUPPORTED: 'The configured job source provider is unsupported.',
  JOB_SOURCE_URL_INVALID: 'The job source URL is invalid.',
  JOB_SOURCE_HOST_UNSUPPORTED: 'The job source host is unsupported.',
  JOB_SOURCE_ADDRESS_BLOCKED: 'The job source resolved to a blocked network address.',
  JOB_SOURCE_REDIRECT_INVALID: 'The job source returned an invalid redirect.',
  JOB_SOURCE_REDIRECT_LIMIT: 'The job source exceeded the redirect limit.',
  JOB_SOURCE_CONTENT_TYPE_UNSUPPORTED: 'The job source returned unsupported content.',
  JOB_SOURCE_BODY_TOO_LARGE: 'The job source response is too large.',
  JOB_SOURCE_TIMEOUT: 'The job source request timed out.',
  JOB_SOURCE_FETCH_FAILED: 'The job source could not be fetched.',
  MANUAL_CAPTURE_INVALID: 'The manual job capture is invalid.',
};

export class JobSourceError extends Error {
  constructor(readonly code: JobSourceFailureCode, _options?: { cause?: unknown }) {
    // Underlying DNS, TLS, URL, and response errors may contain private targets
    // or provider text. Preserve only the closed public code and message.
    super(PUBLIC_MESSAGES[code]);
    this.name = 'JobSourceError';
  }
}
