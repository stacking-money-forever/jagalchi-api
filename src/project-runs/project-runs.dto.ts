import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class BindProjectRunPullRequestDto {
  @ApiProperty({ type: String, pattern: '^[1-9]\\d{0,19}$' })
  @Matches(/^[1-9]\d{0,19}$/)
  githubRepositoryId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  pullNumber!: number;
}

export class ProjectRunAiHelpRequestDto {
  @ApiProperty({ required: false, type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  question?: string;
}

export class ProjectRunAiHelpProvenanceDto {
  @ApiProperty({ type: String, maxLength: 80 }) provider!: string;
  @ApiProperty({ type: String, maxLength: 160 }) model!: string;
  @ApiProperty({ type: String, maxLength: 80 }) promptVersion!: string;
  @ApiProperty({ type: String, pattern: '^[0-9a-f]{64}$' }) inputHash!: string;
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
}

export class ProjectRunAiHelpResponseDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 4000 }) guidance!: string;
  @ApiProperty({ type: ProjectRunAiHelpProvenanceDto }) provenance!: ProjectRunAiHelpProvenanceDto;
}
