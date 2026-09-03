import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, MinLength, Validate, ValidateIf, ValidateNested, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';

const REPOSITORY_MODES = ['EXISTING_OWNED', 'OPEN_SOURCE_CONTRIBUTION', 'MANUAL_GREENFIELD'] as const;

@ValidatorConstraint({ name: 'targetInputVariant', async: false })
class TargetInputVariantConstraint implements ValidatorConstraintInterface {
  validate(value: TargetInputDto): boolean {
    return value?.kind === 'FETCHED_URL'
      ? typeof value.url === 'string' && value.originalUrl === undefined && value.sourceText === undefined
      : value?.kind === 'MANUAL_CAPTURE' && value.url === undefined && typeof value.sourceText === 'string';
  }
  defaultMessage(): string { return 'input must contain exactly one supported tagged input form'; }
}

@ValidatorConstraint({ name: 'repositoryBindingVariant', async: false })
class RepositoryBindingVariantConstraint implements ValidatorConstraintInterface {
  validate(value: RepositoryBindingDto): boolean {
    return value?.mode === 'MANUAL_GREENFIELD'
      ? value.githubRepositoryId === undefined
      : REPOSITORY_MODES.includes(value?.mode) && typeof value.githubRepositoryId === 'string';
  }
  defaultMessage(): string { return 'repository mode and githubRepositoryId do not form a supported binding'; }
}

export class TargetInputDto {
  @ApiProperty({ enum: ['FETCHED_URL', 'MANUAL_CAPTURE'] }) @IsIn(['FETCHED_URL', 'MANUAL_CAPTURE']) kind: 'FETCHED_URL' | 'MANUAL_CAPTURE';
  @ApiPropertyOptional({ type: String, format: 'uri', maxLength: 2048 }) @ValidateIf((input) => input.kind === 'FETCHED_URL') @IsString() @MaxLength(2048) @IsUrl({ protocols: ['https'], require_protocol: true }) url?: string;
  @ApiPropertyOptional({ type: String, format: 'uri', maxLength: 2048 }) @IsOptional() @IsString() @MaxLength(2048) @IsUrl({ protocols: ['https'], require_protocol: true }) originalUrl?: string;
  @ApiPropertyOptional({ type: String, minLength: 20, maxLength: 200000 }) @ValidateIf((input) => input.kind === 'MANUAL_CAPTURE') @IsString() @MinLength(20) @MaxLength(200000) sourceText?: string;
}

export class TargetImportDto {
  @ApiProperty({ type: TargetInputDto, oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'url'], properties: { kind: { type: 'string', enum: ['FETCHED_URL'] }, url: { type: 'string', format: 'uri', maxLength: 2048 } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'sourceText'], properties: { kind: { type: 'string', enum: ['MANUAL_CAPTURE'] }, originalUrl: { type: 'string', format: 'uri', maxLength: 2048 }, sourceText: { type: 'string', minLength: 20, maxLength: 200000 } } },
  ] })
  @ValidateNested() @Type(() => TargetInputDto) @Validate(TargetInputVariantConstraint) input: TargetInputDto;
}

export class ProfileSnapshotOperationDto {
  @ApiProperty({ type: [String], maxItems: 50, description: 'Empty selects all eligible installed repositories within the server cap.' })
  @IsArray() @ArrayMaxSize(50) @Matches(/^[1-9]\d{0,19}$/, { each: true }) repositoryIds: string[];
}

export class CreateCareerDiffDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() careerTargetVersionId: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() candidateProfileSnapshotId: string;
}

export class ProposalConstraintsDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 160 }) @IsInt() @Min(1) @Max(160) availableHours: number;
  @ApiProperty({ type: [String], maxItems: 20 }) @IsArray() @ArrayMaxSize(20) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:+#-]{0,79}$/, { each: true }) preferredStack: string[];
  @ApiProperty({ enum: REPOSITORY_MODES, isArray: true, maxItems: 3 }) @IsArray() @ArrayMaxSize(3) @IsIn(REPOSITORY_MODES, { each: true }) allowedRepositoryModes: Array<(typeof REPOSITORY_MODES)[number]>;
}

export class ProjectProposalOperationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() careerDiffSnapshotId: string;
  @ApiProperty({ type: ProposalConstraintsDto }) @ValidateNested() @Type(() => ProposalConstraintsDto) constraints: ProposalConstraintsDto;
}

export class RepositoryBindingDto {
  @ApiProperty({ enum: REPOSITORY_MODES }) @IsIn(REPOSITORY_MODES) mode: (typeof REPOSITORY_MODES)[number];
  @ApiPropertyOptional({ type: String, pattern: '^[1-9]\\d{0,19}$' }) @IsOptional() @Matches(/^[1-9]\d{0,19}$/) githubRepositoryId?: string;
}

export class ProjectRunConstraintsDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 160 }) @IsInt() @Min(1) @Max(160) availableHours: number;
}

export class CreateProjectRunOperationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() projectProposalId: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() candidateProfileSnapshotId: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() careerDiffSnapshotId: string;
  @ApiProperty({ type: RepositoryBindingDto }) @ValidateNested() @Type(() => RepositoryBindingDto) @Validate(RepositoryBindingVariantConstraint) repository: RepositoryBindingDto;
  @ApiProperty({ type: ProjectRunConstraintsDto }) @ValidateNested() @Type(() => ProjectRunConstraintsDto) constraints: ProjectRunConstraintsDto;
}

class CompetencyCorrectionDto {
  @ApiProperty({ minLength: 1, maxLength: 128 }) @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) competencyId: string;
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] }) @IsIn(['ACCEPT', 'REJECT']) action: 'ACCEPT' | 'REJECT';
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ConfirmProfileSnapshotDto {
  @ApiPropertyOptional({ type: [String], maxItems: 50 }) @IsOptional() @IsArray() @ArrayMaxSize(50) @Matches(/^[1-9]\d{0,19}$/, { each: true }) acceptedRepositoryIds?: string[];
  @ApiPropertyOptional({ type: [CompetencyCorrectionDto], maxItems: 50 }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CompetencyCorrectionDto) competencyCorrections?: CompetencyCorrectionDto[];
}

class DiffCorrectionDto {
  @ApiProperty({ minLength: 1, maxLength: 128 }) @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) competencyId: string;
  @ApiProperty({ enum: ['OBSERVED', 'INFERRED', 'MISSING'] }) @IsIn(['OBSERVED', 'INFERRED', 'MISSING']) status: 'OBSERVED' | 'INFERRED' | 'MISSING';
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ConfirmCareerDiffDto {
  @ApiPropertyOptional({ type: [String], maxItems: 50 }) @IsOptional() @IsArray() @ArrayMaxSize(50) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, { each: true }) acceptedCompetencyIds?: string[];
  @ApiPropertyOptional({ type: [DiffCorrectionDto], maxItems: 50 }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DiffCorrectionDto) corrections?: DiffCorrectionDto[];
}
