import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AI_FEATURE_COSTS, type AiFeature } from '../../tickets/ticket-policy';

export class RunAiJobDto {
  @ApiProperty({ enum: Object.keys(AI_FEATURE_COSTS) })
  @IsIn(Object.keys(AI_FEATURE_COSTS))
  feature: AiFeature;

  @ApiProperty({ minLength: 8, maxLength: 120 })
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotencyKey: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  roadmapId?: string;

  @ApiProperty({ type: Object })
  @IsObject()
  payload: Record<string, unknown>;
}
