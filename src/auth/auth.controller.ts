import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Redirect,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  LoginDto,
  OAuthCallbackQueryDto,
  OAuthExchangeDto,
  OAuthStartQueryDto,
  RegisterDto,
  ResetPasswordDto,
  SendEmailVerificationDto,
  VerifyEmailDto,
  UpdateProfileDto,
  UserSearchQueryDto,
} from './auth.dto';
import { OAuthProvider } from './auth.entities';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth-user';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

interface CookieResponse {
  cookie(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'lax';
      path: string;
      maxAge: number;
    },
  ): void;
  clearCookie(name: string, options: { path: string }): void;
}

const REFRESH_COOKIE = 'jagalchi_refresh';
const REFRESH_COOKIE_PATH = '/api/users/auth';
const REFRESH_COOKIE_MAX_AGE = 30 * 86_400_000;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return undefined;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: CookieResponse) {
    const result = await this.auth.register(dto);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, ...result.user };
  }

  @Get()
  getProfile(@Query('name') name: string | undefined) {
    if (!name?.trim()) throw new BadRequestException('Profile name is required');
    return this.auth.getProfileByName(name.trim());
  }

  @Get('search')
  searchUsers(@Query() query: UserSearchQueryDto) {
    return this.auth.searchUsers(query.query);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async deleteAccount(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.deleteAccount(user.id);
  }

  @Post('verification')
  @HttpCode(204)
  async sendVerification(@Body() dto: SendEmailVerificationDto): Promise<void> {
    await this.auth.sendEmailVerification(dto);
  }

  @Patch('verification')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  private setRefreshCookie(response: CookieResponse, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  }
}

@ApiTags('auth')
@Controller('users/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: CookieResponse) {
    const result = await this.auth.login(dto);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('password-reset')
  @HttpCode(204)
  async sendPasswordReset(@Body() dto: SendEmailVerificationDto): Promise<void> {
    await this.auth.sendPasswordReset(dto);
  }

  @Patch('password-reset/verify')
  verifyPasswordReset(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyPasswordReset(dto);
  }

  @Patch('password-reset')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto);
  }

  @Patch('refresh')
  async refresh(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.refresh(readCookie(cookie, REFRESH_COOKIE) ?? '');
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    await this.auth.revoke(readCookie(cookie, REFRESH_COOKIE));
    response.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @Get('login/:provider')
  @Redirect()
  async startOAuth(
    @Param('provider', new ParseEnumPipe(OAuthProvider)) provider: OAuthProvider,
    @Query() query: OAuthStartQueryDto,
  ) {
    return {
      url: await this.auth.startOAuth(provider, query.returnUrl),
      statusCode: 302,
    };
  }

  @Get('callback/:provider')
  @Redirect()
  async oauthCallback(
    @Param('provider', new ParseEnumPipe(OAuthProvider)) provider: OAuthProvider,
    @Query() query: OAuthCallbackQueryDto,
  ) {
    return {
      url: await this.auth.completeOAuth(provider, query.code, query.state),
      statusCode: 302,
    };
  }

  @Post('callback/apple')
  @Redirect()
  async appleCallback(@Body() body: OAuthCallbackQueryDto) {
    return {
      url: await this.auth.completeOAuth(OAuthProvider.Apple, body.code, body.state),
      statusCode: 302,
    };
  }

  @Post('oauth/exchange')
  @HttpCode(200)
  async exchangeOAuth(
    @Body() dto: OAuthExchangeDto,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.exchangeOAuthGrant(dto.code);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  private setRefreshCookie(response: CookieResponse, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  }
}
