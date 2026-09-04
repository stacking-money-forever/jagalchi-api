import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Matches, Min } from 'class-validator';

export class BindProjectRunPullRequestDto {
  @ApiProperty({ type: String, pattern: '^[1-9]\\d{0,19}$' })
  @Matches(/^[1-9]\d{0,19}$/)
  githubRepositoryId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  pullNumber!: number;
}
