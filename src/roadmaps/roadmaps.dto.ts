import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  RoadmapReactionType,
  RoadmapVisibility,
  type RoadmapGraph,
} from './entities/roadmap.entities';

export class CreateRoadmapDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  tags?: string[];

  @IsEnum(RoadmapVisibility)
  visibility: RoadmapVisibility;

  @IsOptional()
  @IsObject()
  graph?: RoadmapGraph;

  @IsOptional()
  @IsUUID()
  directoryId?: string;
}

export class UpdateRoadmapDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(RoadmapVisibility)
  visibility?: RoadmapVisibility;

  @IsOptional()
  @IsObject()
  graph?: RoadmapGraph;

  @IsOptional()
  @IsUUID()
  directoryId?: string | null;
}

export class RoadmapListQueryDto {
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  size = 20;
}

export class CreateDirectoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class MoveDirectoryDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class RenameDirectoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}

export class CompleteNodeDto {
  @IsBoolean()
  isCompleted: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  note?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  link?: string;
}

export class ReactionDto {
  @ApiProperty({ enum: RoadmapReactionType })
  @IsEnum(RoadmapReactionType)
  type: RoadmapReactionType;
}
