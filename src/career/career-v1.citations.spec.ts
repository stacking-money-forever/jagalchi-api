import { describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_SOURCE_CITATION_ID,
  buildProposalFindings,
  collectDiffCitationPayload,
  collectWaveBCitationIds,
  normalizeExtractCitations,
} from './career-v1.citations';
import type { CandidateProfileSnapshot, CareerDiffSnapshot, CareerTargetVersion } from '../project-runs/product-spine.entities';
import type { JobSourceCapture } from '../job-sources/job-source.types';

const manualCapture = (): Pick<JobSourceCapture, 'sourceTitle' | 'normalizedText' | 'provenance'> => ({
  sourceTitle: 'Manual backend role',
  normalizedText: 'A manually captured backend role requiring TypeScript and reliable tests.',
  provenance: {
    mode: 'DEGRADED_MANUAL_CAPTURE',
    provider: 'manual',
    requestedUrl: null,
    finalUrl: null,
    redirectUrls: [],
    degradationReason: 'USER_SUPPLIED',
    capturedAt: '2026-09-04T00:00:00.000Z',
  },
});

const profileWithInterpret = (): CandidateProfileSnapshot => ({
  id: 'profile-1',
  ownerId: 'owner-1',
  state: 'CONFIRMED' as never,
  sourceSnapshotId: null,
  schemaVersion: 1,
  payload: {
    interpretation: {
      result: {
        findings: [{ statement: 'Fixture repository is available', confidence: 1, citationIds: ['repo-1'] }],
        gaps: [],
      },
      citations: [{ id: 'repo-1', title: 'fixture/verification-repository', url: 'https://github.com/fixture/verification-repository', quote: 'Repository fixture/verification-repository is available to the installation.' }],
    },
  },
} as CandidateProfileSnapshot);

describe('career v1 citation helpers', () => {
  it('mints deterministic source-1 when manual extract returns no citations', () => {
    const citations = normalizeExtractCitations({ citations: [] }, manualCapture());
    expect(citations).toEqual([{
      id: DETERMINISTIC_SOURCE_CITATION_ID,
      title: 'Manual backend role',
      quote: 'A manually captured backend role requiring TypeScript and reliable tests.',
    }]);
  });

  it('preserves AI extract citations for fetched URL fixtures', () => {
    const citations = normalizeExtractCitations({
      citations: [{ id: 'source-1', title: 'Fixture Software Engineer', url: 'https://fixture.invalid/jobs/software-engineer', quote: 'Build systems' }],
    }, {
      ...manualCapture(),
      provenance: { ...manualCapture().provenance, mode: 'FETCHED_URL', provider: 'fixture', requestedUrl: 'https://fixture.invalid/jobs/software-engineer', finalUrl: 'https://fixture.invalid/jobs/software-engineer' },
    });
    expect(citations[0]).toMatchObject({ id: 'source-1', url: 'https://fixture.invalid/jobs/software-engineer' });
  });

  it('builds proposal findings from persisted interpret output instead of hardcoded source-1', () => {
    const findings = buildProposalFindings(profileWithInterpret(), ['source-1']);
    expect(findings).toEqual([{ id: 'finding-1', statement: 'Fixture repository is available', citationIds: ['repo-1'] }]);
  });

  it('collects interpret and target citations for proposal qualification', () => {
    const targetVersion = { payload: { citations: [{ id: 'source-1', title: 'Manual backend role', quote: 'Manual text' }] } } as CareerTargetVersion;
    const diff = { payload: { citations: [{ id: 'source-1', title: 'Manual backend role', quote: 'Manual text' }, { id: 'repo-1', title: 'fixture/verification-repository' }] } } as CareerDiffSnapshot;
    expect([...collectWaveBCitationIds(targetVersion, diff, profileWithInterpret())]).toEqual(['source-1', 'repo-1']);
  });

  it('merges interpret citations into diff payload at creation time', () => {
    const citations = collectDiffCitationPayload(
      { citations: [{ id: 'source-1', title: 'Manual backend role', quote: 'Manual text' }] },
      profileWithInterpret(),
    );
    expect(citations.map((item) => item.id)).toEqual(['source-1', 'repo-1']);
  });
});
