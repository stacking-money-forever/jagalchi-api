import type { CandidateProfileSnapshot, CareerDiffSnapshot, CareerTargetVersion } from '../project-runs/product-spine.entities';
import type { JobSourceCapture } from '../job-sources/job-source.types';

export const DETERMINISTIC_SOURCE_CITATION_ID = 'source-1';

export interface ProposalFinding {
  id: string;
  statement: string;
  citationIds: string[];
}

function isCitationRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === 'string');
}

export function mergeCitationRecords(...groups: Array<unknown>): Array<Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (!isCitationRecord(item)) continue;
      const id = String(item.id);
      if (!id || seen.has(id)) continue;
      seen.set(id, item);
    }
  }
  return [...seen.values()];
}

export function normalizeExtractCitations(
  ai: Record<string, unknown>,
  capture: Pick<JobSourceCapture, 'sourceTitle' | 'normalizedText' | 'provenance'>,
): Array<Record<string, unknown>> {
  const existing = mergeCitationRecords(ai.citations);
  if (existing.length > 0) return existing;
  const url = capture.provenance.finalUrl ?? capture.provenance.requestedUrl;
  return [{
    id: DETERMINISTIC_SOURCE_CITATION_ID,
    title: capture.sourceTitle,
    ...(typeof url === 'string' && url.length > 0 ? { url } : {}),
    quote: capture.normalizedText.slice(0, 2_000),
  }];
}

function interpretationRecord(profile: CandidateProfileSnapshot | null | undefined): Record<string, unknown> | null {
  const payload = profile?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const interpretation = (payload as Record<string, unknown>).interpretation;
  if (!interpretation || typeof interpretation !== 'object' || Array.isArray(interpretation)) return null;
  return interpretation as Record<string, unknown>;
}

export function interpretCitations(profile: CandidateProfileSnapshot | null | undefined): Array<Record<string, unknown>> {
  const interpretation = interpretationRecord(profile);
  if (!interpretation) return [];
  return mergeCitationRecords(interpretation.citations);
}

export function collectWaveBCitationRecords(
  targetVersion: CareerTargetVersion | null | undefined,
  diff: CareerDiffSnapshot | null | undefined,
  profile: CandidateProfileSnapshot | null | undefined,
): Array<Record<string, unknown>> {
  const targetPayload = targetVersion?.payload && typeof targetVersion.payload === 'object' ? targetVersion.payload as Record<string, unknown> : {};
  const diffPayload = diff?.payload && typeof diff.payload === 'object' ? diff.payload as Record<string, unknown> : {};
  return mergeCitationRecords(targetPayload.citations, diffPayload.citations, interpretCitations(profile));
}

export function collectWaveBCitationIds(
  targetVersion: CareerTargetVersion | null | undefined,
  diff: CareerDiffSnapshot | null | undefined,
  profile: CandidateProfileSnapshot | null | undefined,
): Set<string> {
  return new Set(collectWaveBCitationRecords(targetVersion, diff, profile).map((item) => String(item.id)));
}

export function buildProposalFindings(
  profile: CandidateProfileSnapshot | null | undefined,
  fallbackCitationIds: string[],
): ProposalFinding[] {
  const interpretation = interpretationRecord(profile);
  const result = interpretation?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return [{ id: 'finding-1', statement: 'Use confirmed candidate evidence', citationIds: fallbackCitationIds }];
  }
  const rows = (result as Record<string, unknown>).findings;
  if (!Array.isArray(rows) || rows.length === 0) {
    return [{ id: 'finding-1', statement: 'Use confirmed candidate evidence', citationIds: fallbackCitationIds }];
  }
  const findings = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const citationIds = Array.isArray(record.citationIds)
      ? record.citationIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 20)
      : fallbackCitationIds;
    if (citationIds.length === 0) return null;
    return {
      id: typeof record.id === 'string' && record.id.length > 0 ? record.id : `finding-${index + 1}`,
      statement: typeof record.statement === 'string' && record.statement.length > 0 ? record.statement : 'Interpreted candidate evidence',
      citationIds,
    };
  }).filter((item): item is ProposalFinding => item !== null);
  return findings.length > 0 ? findings : [{ id: 'finding-1', statement: 'Use confirmed candidate evidence', citationIds: fallbackCitationIds }];
}

export function collectDiffCitationPayload(
  targetPayload: Record<string, unknown>,
  profile: CandidateProfileSnapshot,
): Array<Record<string, unknown>> {
  return mergeCitationRecords(targetPayload.citations, interpretCitations(profile));
}
