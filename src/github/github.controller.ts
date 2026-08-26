import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { OAuthIdentity, OAuthProvider } from '../auth/auth.entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  GithubInstallation,
  GithubInstallationRepository,
  GithubInstallationStatus,
} from './github.entities';
import { GithubService } from './github.service';

export class GithubInstallationClaimDto {
  @ValidateIf((_input: GithubInstallationClaimDto, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  returnTo?: string;

  @ValidateIf((_input: GithubInstallationClaimDto, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/)
  installationId?: string;
}

class GithubPullQueryDto {
  @IsOptional()
  @Matches(/^(open|closed|all)$/)
  state?: 'open' | 'closed' | 'all';
}

const DECIMAL_ID = /^[1-9]\d*$/;

@ApiTags('github')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('github')
export class GithubController {
  constructor(
    private readonly github: GithubService,
    private readonly config: ConfigService,
    @InjectRepository(OAuthIdentity)
    private readonly identities: Repository<OAuthIdentity>,
    @InjectRepository(GithubInstallation)
    private readonly installations: Repository<GithubInstallation>,
    @InjectRepository(GithubInstallationRepository)
    private readonly repositories: Repository<GithubInstallationRepository>,
  ) {}

  @Get('setup')
  async getSetup(@CurrentUser() user: AuthUser) {
    this.requireEnabled();
    const [identity, installation] = await Promise.all([
      this.identities.findOne({ where: { userId: user.id, provider: OAuthProvider.Github } }),
      this.installations.findOne({
        where: { ownerUserId: user.id },
        order: { updatedAt: 'DESC' },
      }),
    ]);
    const repositories = installation?.status === GithubInstallationStatus.Active
      ? await this.listAuthorizedRepositories(installation.id)
      : [];
    return {
      hasVerifiedIdentity: Boolean(identity),
      installation: installation
        ? {
            id: installation.id,
            status: installation.status,
            accountId: installation.githubAccountId,
          }
        : null,
      repositories,
    };
  }

  @Post('installation-claims')
  async installationClaim(
    @CurrentUser() user: AuthUser,
    @Body() dto: GithubInstallationClaimDto,
  ) {
    this.requireEnabled();
    const { state, installationId } = dto;
    const hasState = state !== undefined;
    const hasInstallationId = installationId !== undefined;
    const hasReturnTo = dto.returnTo !== undefined;
    const isSetupCommand = !hasState && !hasInstallationId;
    const isCallbackCommand =
      typeof state === 'string'
      && typeof installationId === 'string'
      && !hasReturnTo;
    if (!isSetupCommand && !isCallbackCommand) {
      throw new BadRequestException('Invalid installation claim command');
    }
    if (isCallbackCommand) {
      const claim = await this.github.claimInstallation(user.id, state, installationId);
      return {
        installationId: claim.installationId,
        repositoryCount: claim.repositoryCount,
        returnPath: claim.returnPath,
      };
    }
    const identity = await this.identities.findOne({
      where: { userId: user.id, provider: OAuthProvider.Github },
    });
    if (!identity) throw new NotFoundException('Verified GitHub identity required');
    const setup = await this.github.createSetupState(user.id, dto.returnTo ?? '/career');
    const setupUrl = new URL(this.config.getOrThrow<string>('GITHUB_APP_SETUP_URL'));
    setupUrl.searchParams.set('state', setup.state);
    return { setupUrl: setupUrl.toString(), stateExpiresAt: setup.expiresAt };
  }

  @Get('repositories')
  async listRepositories(@CurrentUser() user: AuthUser) {
    this.requireEnabled();
    const installation = await this.requireActiveInstallation(user.id);
    return this.listAuthorizedRepositories(installation.id);
  }

  @Get('repositories/:repositoryId/pulls')
  async listPullRequests(
    @CurrentUser() user: AuthUser,
    @Param('repositoryId') repositoryId: string,
    @Query() query: GithubPullQueryDto,
  ) {
    this.requireEnabled();
    if (!DECIMAL_ID.test(repositoryId)) throw new NotFoundException('GitHub repository not found');
    const installation = await this.requireActiveInstallation(user.id);
    return this.github.listPullRequests(
      user.id,
      installation.id,
      repositoryId,
      query.state ?? 'open',
    );
  }

  private async listAuthorizedRepositories(installationId: string) {
    const repositories = await this.repositories.find({
      where: { installationId, active: true },
      order: { fullName: 'ASC' },
    });
    return repositories.map((repository) => ({
      repositoryId: repository.githubRepositoryId,
      name: repository.fullName.split('/').at(-1) ?? repository.fullName,
      fullName: repository.fullName,
      private: repository.private,
    }));
  }

  private async requireActiveInstallation(ownerUserId: string): Promise<GithubInstallation> {
    const installation = await this.installations.findOne({
      where: { ownerUserId, status: GithubInstallationStatus.Active },
      order: { updatedAt: 'DESC' },
    });
    if (!installation) throw new NotFoundException('Active GitHub installation not found');
    return installation;
  }

  private requireEnabled(): void {
    if (this.config.get<string>('EVIDENCE_EXECUTION_ENABLED') !== 'true') {
      throw new NotFoundException('GitHub evidence execution is unavailable');
    }
  }
}
