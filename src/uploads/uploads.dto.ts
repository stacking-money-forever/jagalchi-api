import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UploadPurpose } from './upload-asset.entity';

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export class CreateUploadDto {
  @IsEnum(UploadPurpose)
  purpose: UploadPurpose;

  @IsString()
  @MaxLength(180)
  fileName: string;

  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  size: number;

  @IsOptional()
  @IsUUID()
  roadmapId?: string;
}
