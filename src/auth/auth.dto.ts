import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  IsObject,
} from 'class-validator';
import { OAuthProvider } from './auth.entities';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;

  @IsString()
  @MinLength(32)
  @MaxLength(2_048)
  registrationProof: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class OAuthStartQueryDto {
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http', 'jagalchi'] })
  @MaxLength(500)
  returnUrl?: string;
}

export class OAuthCallbackQueryDto {
  @IsString()
  @MaxLength(2_048)
  code: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  state: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  authuser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_096)
  user?: string;
}

export class OAuthExchangeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,256}$/)
  code: string;
}

export class OAuthProviderParamDto {
  @IsEnum(OAuthProvider)
  provider: OAuthProvider;
}

export class SendEmailVerificationDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class VerifyEmailDto extends SendEmailVerificationDto {
  @IsString()
  @Matches(/^[0-9]{6}$/)
  code: string;
}

export class ResetPasswordDto extends SendEmailVerificationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword: string;

  @IsString()
  @MinLength(32)
  @MaxLength(2_048)
  resetProof: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  bio?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  profileImageUrl?: string | null;

  @IsOptional()
  @IsObject()
  externalLinks?: Record<string, string>;
}

export class UserSearchQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  query: string;
}
