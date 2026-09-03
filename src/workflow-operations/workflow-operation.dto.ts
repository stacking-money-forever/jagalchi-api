import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsObject, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkflowOperationDto {
  @ApiProperty({ type: String, minLength: 8, maxLength: 160 })
  @IsString() @MinLength(8) @MaxLength(160)
  idempotencyKey: string;

  @ApiProperty({ type: Object, additionalProperties: true })
  @IsObject()
  input: Record<string, unknown>;
}

export class CreateProjectPlanOperationDto extends CreateWorkflowOperationDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  targetId: string;

  @ApiProperty({ type: [String], maxItems: 20 })
  @IsArray() @IsString({ each: true }) @Matches(/^[a-z0-9][a-z0-9-]{0,99}$/, { each: true })
  competencySlugs: string[];
}
