import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CommentListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size = 30;
}

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  content: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  content: string;
}

export class NotificationListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size = 30;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly = false;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  comments?: boolean;

  @IsOptional()
  @IsBoolean()
  replies?: boolean;

  @IsOptional()
  @IsBoolean()
  follows?: boolean;

  @IsOptional()
  @IsBoolean()
  forks?: boolean;

  @IsOptional()
  @IsBoolean()
  likes?: boolean;

  @IsOptional()
  @IsBoolean()
  aiComplete?: boolean;

  @IsOptional()
  @IsBoolean()
  learningReminders?: boolean;
}
