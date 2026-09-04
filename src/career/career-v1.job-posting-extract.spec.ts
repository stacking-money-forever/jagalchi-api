import { describe, expect, it } from 'vitest';
import type { JobSourceCapture } from '../job-sources/job-source.types';
import { buildJobPostingExtractRequest } from './career-v1.job-posting-extract';

const MANUAL_SOURCE_TEXT = 'A manually captured backend role requiring TypeScript and reliable tests.';

const capture = (overrides: Partial<JobSourceCapture> = {}): JobSourceCapture => ({
  schemaVersion: 1,
  captureVersion: 1,
  sourceTitle: 'Manual capture',
  normalizedText: MANUAL_SOURCE_TEXT,
  sourceHash: 'hash',
  provenance: {
    mode: 'DEGRADED_MANUAL_CAPTURE',
    provider: 'manual',
    requestedUrl: null,
    finalUrl: null,
    redirectUrls: [],
    degradationReason: 'USER_SUPPLIED',
    capturedAt: '2026-09-04T17:13:32.000Z',
  },
  ...overrides,
});

describe('buildJobPostingExtractRequest', () => {
  it('omits sourceUrl for manual capture without originalUrl', () => {
    expect(buildJobPostingExtractRequest(capture())).toEqual({
      text: MANUAL_SOURCE_TEXT,
      sourceTitle: 'Manual capture',
    });
    expect(buildJobPostingExtractRequest(capture())).not.toHaveProperty('sourceUrl');
  });

  it('includes sourceUrl when manual capture carries originalUrl', () => {
    expect(
      buildJobPostingExtractRequest(
        capture({
          provenance: {
            ...capture().provenance,
            requestedUrl: 'https://jobs.example.com/backend-role',
            finalUrl: null,
          },
        }),
      ),
    ).toEqual({
      text: MANUAL_SOURCE_TEXT,
      sourceTitle: 'Manual capture',
      sourceUrl: 'https://jobs.example.com/backend-role',
    });
  });

  it('includes sourceUrl for fetched-url captures', () => {
    expect(
      buildJobPostingExtractRequest(
        capture({
          sourceTitle: 'Fixture posting',
          normalizedText: 'Fixture posting body',
          provenance: {
            mode: 'FETCHED_URL',
            provider: 'fixture',
            requestedUrl: 'https://fixture.invalid/jobs/software-engineer',
            finalUrl: 'https://fixture.invalid/jobs/software-engineer',
            redirectUrls: [],
            degradationReason: null,
            capturedAt: '2026-09-04T17:13:32.000Z',
          },
        }),
      ),
    ).toEqual({
      text: 'Fixture posting body',
      sourceTitle: 'Fixture posting',
      sourceUrl: 'https://fixture.invalid/jobs/software-engineer',
    });
  });
});
