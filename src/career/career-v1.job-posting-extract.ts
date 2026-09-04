import type { JobSourceCapture } from '../job-sources/job-source.types';

/** Build the AI v1 job-posting-extract request body from a normalized capture. */
export function buildJobPostingExtractRequest(
  capture: Pick<JobSourceCapture, 'normalizedText' | 'sourceTitle' | 'provenance'>,
): Record<string, string> {
  const sourceUrl = capture.provenance.finalUrl ?? capture.provenance.requestedUrl;
  return {
    text: capture.normalizedText,
    sourceTitle: capture.sourceTitle,
    ...(typeof sourceUrl === 'string' ? { sourceUrl } : {}),
  };
}
