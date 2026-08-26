import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CareerEvidenceKind,
  CareerEvidenceStatus,
  ProofCriterionConfig,
  ProofCriterionType,
  ProofProfileState,
  ProofReviewDecision,
} from './career.entities';

const COMPETENCY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const GITHUB_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

export class CreateCareerTargetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  company: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  role: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2_048)
  postingUrl?: string;

  @IsString()
  @MinLength(20)
  @MaxLength(20_000)
  requirements: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(COMPETENCY_SLUG_PATTERN, { each: true })
  competencySlugs: string[];
}

export class CreateCareerEvidenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2_048)
  url: string;

  @IsEnum(CareerEvidenceKind)
  kind: CareerEvidenceKind;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(COMPETENCY_SLUG_PATTERN, { each: true })
  competencySlugs: string[];
}

export class ReviewCareerEvidenceDto {
  @IsEnum(CareerEvidenceStatus)
  status: CareerEvidenceStatus.Verified | CareerEvidenceStatus.Rejected;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  reviewNote?: string;
}

export class IdempotentCommandDto {
  @IsString()
  @Matches(IDEMPOTENCY_KEY_PATTERN)
  idempotencyKey: string;
}

export class CreateProofMissionDto extends IdempotentCommandDto {
  @IsUUID()
  targetId: string;

  @IsString()
  @Matches(COMPETENCY_SLUG_PATTERN)
  competencySlug: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  summary?: string;
}

export class ProofCriterionInputDto {
  @IsEnum(ProofCriterionType)
  type: ProofCriterionType;

  @IsObject()
  config: ProofCriterionConfig;
}

export class ReplaceProofCriteriaDto extends IdempotentCommandDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProofCriterionInputDto)
  criteria: ProofCriterionInputDto[];
}

export class BindProofPullRequestDto extends IdempotentCommandDto {
  @IsUUID()
  installationId: string;

  @IsString()
  @Matches(GITHUB_ID_PATTERN)
  githubRepositoryId: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  pullNumber: number;
}

export class ReviewProofMissionDto extends IdempotentCommandDto {
  @IsEnum(ProofReviewDecision)
  decision: ProofReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  note?: string;
}

export class UpdateProofProfileDto extends IdempotentCommandDto {
  @IsEnum(ProofProfileState)
  state: ProofProfileState;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  summary?: string;
}

export class PublishProofDto extends IdempotentCommandDto {}

export class UnpublishProofDto extends IdempotentCommandDto {}

export class PublicProofProfileV1Dto {
  schemaVersion: 1;
  profile: { publicId: string; displayName: string; summary: string | null };
  proofs: Array<{
    publicProofId: string;
    title: string;
    summary: string | null;
    competencyLabel: string;
    provider: 'GITHUB';
    verification: { status: 'VERIFIED'; verifiedAt: string };
    criteria: {
      passedCount: number;
      totalCount: number;
      types: ProofCriterionType[];
    };
  }>;
  updatedAt: string;
}

export class ProofMissionQueryDto {
  @IsOptional()
  @IsUUID()
  targetId?: string;
}
