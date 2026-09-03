import { createHash } from 'node:crypto';

import { JobSourceError } from './job-source.errors';

const ENTITY_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&gt;': '>',
  '&lt;': '<',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&#39;': "'",
};

export function normalizeSourceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractText(contentType: string, bytes: Uint8Array): {
  sourceTitle: string | null;
  normalizedText: string;
} {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new JobSourceError('JOB_SOURCE_FETCH_FAILED', { cause: error });
  }
  if (contentType === 'text/plain') {
    return { sourceTitle: null, normalizedText: normalizeSourceText(decoded) };
  }
  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(decoded);
  const withoutExecutableContent = decoded
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/gi, ' ')
    .replace(/<(script|style|noscript)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|section|article|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const decodeEntities = (text: string) =>
    text.replace(/&(amp|gt|lt|nbsp|quot|#39);/gi, (entity) =>
      ENTITY_REPLACEMENTS[entity.toLowerCase()] ?? entity,
    );
  return {
    sourceTitle: titleMatch ? normalizeSourceText(decodeEntities(titleMatch[1]!)) : null,
    normalizedText: normalizeSourceText(decodeEntities(withoutExecutableContent)),
  };
}

export function sourceHash(normalizedText: string): string {
  return createHash('sha256').update(normalizedText, 'utf8').digest('hex');
}
