import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AI_FEATURE_COSTS, type AiFeature } from '../ticket-policy';

export class ReserveAiTicketsDto {
  @ApiProperty({ enum: Object.keys(AI_FEATURE_COSTS) })
  @IsIn(Object.keys(AI_FEATURE_COSTS))
  feature: AiFeature;

  @ApiProperty({ minLength: 8, maxLength: 120 })
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotencyKey: string;
}
