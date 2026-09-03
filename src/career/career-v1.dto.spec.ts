import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ConfirmCareerDiffDto, ConfirmProfileSnapshotDto, CreateCareerDiffDto, CreateProjectRunOperationDto, ProfileSnapshotOperationDto, ProjectProposalOperationDto, TargetImportDto } from './career-v1.dto';

const validateDto = (type: new () => object, value: unknown) => validate(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });

describe('v1 correction DTOs', () => {
  it('accepts bounded nested profile and diff corrections', async () => {
    await expect(validate(plainToInstance(ConfirmProfileSnapshotDto, { acceptedRepositoryIds: ['9000001'], competencyCorrections: [{ competencyId: 'typescript', action: 'ACCEPT', note: 'Verified' }] }), { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual([]);
    await expect(validate(plainToInstance(ConfirmCareerDiffDto, { acceptedCompetencyIds: ['typescript'], corrections: [{ competencyId: 'typescript', status: 'MISSING' }] }), { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual([]);
  });
  it('rejects unknown, oversized, and malformed nested fields', async () => {
    const errors = await validate(plainToInstance(ConfirmProfileSnapshotDto, { acceptedRepositoryIds: ['bad'], competencyCorrections: [{ competencyId: 'typescript', action: 'ADMIN', note: 'x'.repeat(501), surprise: true }], surprise: true }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });
  it('accepts every closed operation request shape', async () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    await expect(validateDto(TargetImportDto, { input: { kind: 'FETCHED_URL', url: 'https://jobs.example/1' } })).resolves.toEqual([]);
    await expect(validateDto(TargetImportDto, { input: { kind: 'MANUAL_CAPTURE', originalUrl: 'https://jobs.example/1', sourceText: 'A sufficiently long job posting.' } })).resolves.toEqual([]);
    await expect(validateDto(ProfileSnapshotOperationDto, { repositoryIds: [] })).resolves.toEqual([]);
    await expect(validateDto(CreateCareerDiffDto, { careerTargetVersionId: uuid, candidateProfileSnapshotId: uuid })).resolves.toEqual([]);
    await expect(validateDto(ProjectProposalOperationDto, { careerDiffSnapshotId: uuid, constraints: { availableHours: 20, preferredStack: ['typescript'], allowedRepositoryModes: ['EXISTING_OWNED'] } })).resolves.toEqual([]);
    await expect(validateDto(CreateProjectRunOperationDto, { projectProposalId: uuid, candidateProfileSnapshotId: uuid, careerDiffSnapshotId: uuid, repository: { mode: 'EXISTING_OWNED', githubRepositoryId: '9000001' }, constraints: { availableHours: 20 } })).resolves.toEqual([]);
  });
  it.each([
    [TargetImportDto, { input: { kind: 'FETCHED_URL', url: 'http://jobs.example/1', sourceText: 'unexpected extra variant field' } }],
    [ProfileSnapshotOperationDto, { repositoryIds: ['bad'], extra: true }],
    [CreateCareerDiffDto, { careerTargetVersionId: 'bad', candidateProfileSnapshotId: 'bad' }],
    [ProjectProposalOperationDto, { careerDiffSnapshotId: '00000000-0000-4000-8000-000000000001', constraints: { availableHours: 0, preferredStack: [], allowedRepositoryModes: ['OTHER'], extra: true } }],
    [CreateProjectRunOperationDto, { projectProposalId: '00000000-0000-4000-8000-000000000001', candidateProfileSnapshotId: '00000000-0000-4000-8000-000000000001', careerDiffSnapshotId: '00000000-0000-4000-8000-000000000001', repository: { mode: 'MANUAL_GREENFIELD', githubRepositoryId: '9000001' }, constraints: { availableHours: 161 } }],
  ])('rejects malformed or open operation shape %#', async (type, body) => {
    expect((await validateDto(type as new () => object, body)).length).toBeGreaterThan(0);
  });
});
