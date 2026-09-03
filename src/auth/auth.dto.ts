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
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ type: String, format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ type: String, minLength: 2, maxLength: 60 })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty({ type: String, minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;

  @ApiProperty({ type: String, minLength: 32, maxLength: 2048 })
  @IsString()
  @MinLength(32)
  @MaxLength(2_048)
  registrationProof: string;
}

export class LoginDto {
  @ApiProperty({ type: String, format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ type: String, maxLength: 128 })
  @IsString()
  @MaxLength(128)
  password: string;
}

export class NativeRefreshDto {
  @ApiProperty({ type: String, minLength: 32, maxLength: 256 })
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  refreshToken: string;
}

export class NativeLogoutDto extends NativeRefreshDto {}

export class NativeAuthUserDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'email' }) email: string;
  @ApiProperty({ type: String }) name: string;
  @ApiProperty({ type: [String] }) roles: string[];
}

export class NativeAuthResponse {
  @ApiProperty({ type: String }) accessToken: string;
  @ApiProperty({ type: String }) refreshToken: string;
  @ApiProperty({ type: () => NativeAuthUserDto }) user: NativeAuthUserDto;
}

export class WebAuthResponse {
  @ApiProperty({ type: String }) accessToken: string;
  @ApiProperty({ type: () => NativeAuthUserDto }) user: NativeAuthUserDto;
}

export class WebRegistrationResponse extends NativeAuthUserDto {
  @ApiProperty({ type: String }) accessToken: string;
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

  // Google includes the OpenID Connect issuer on successful callbacks.
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(200)
  iss?: string;

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
  @ApiProperty({ type: String, minLength: 32, maxLength: 256 })
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
