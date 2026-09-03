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
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UploadPurpose } from './upload-asset.entity';

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export class CreateUploadDto {
  @ApiProperty({ enum: UploadPurpose, enumName: 'UploadPurpose' })
  @IsEnum(UploadPurpose)
  purpose: UploadPurpose;

  @ApiProperty({ type: String, minLength: 1, maxLength: 180, example: 'evidence.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName: string;

  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES, example: 'application/pdf' })
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5 * 1024 * 1024, example: 1024 })
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  size: number;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roadmapId?: string;
}
