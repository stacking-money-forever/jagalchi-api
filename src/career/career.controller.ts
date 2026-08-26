import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  BindProofPullRequestDto,
  CreateCareerEvidenceDto,
  CreateCareerTargetDto,
  CreateProofMissionDto,
  IdempotentCommandDto,
  ProofMissionQueryDto,
  PublishProofDto,
  ReplaceProofCriteriaDto,
  ReviewCareerEvidenceDto,
  ReviewProofMissionDto,
  UnpublishProofDto,
  UpdateProofProfileDto,
} from './career.dto';
import { CareerService } from './career.service';

@ApiTags('career')
@Controller('career')
export class CareerController {
  constructor(
    private readonly career: CareerService,
    private readonly config: ConfigService,
  ) {}

  @Get('competencies')
  listCompetencies() {
    return this.career.listCompetencies();
  }

  @Get('targets')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listTargets(@CurrentUser() user: AuthUser) {
    return this.career.listTargets(user.id);
  }

  @Post('targets')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  createTarget(@CurrentUser() user: AuthUser, @Body() dto: CreateCareerTargetDto) {
    return this.career.createTarget(user.id, dto);
  }

  @Get('targets/:id/diff')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getDiff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.career.getDiff(user.id, id);
  }

  @Get('evidence')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listEvidence(@CurrentUser() user: AuthUser) {
    return this.career.listEvidence(user.id);
  }

  @Post('evidence')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  createEvidence(@CurrentUser() user: AuthUser, @Body() dto: CreateCareerEvidenceDto) {
    return this.career.createEvidence(user.id, dto);
  }

  @Get('reviews')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listReviewQueue(@CurrentUser() user: AuthUser) {
    return this.career.listReviewQueue(user);
  }

  @Patch('evidence/:id/review')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  reviewEvidence(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCareerEvidenceDto,
  ) {
    return this.career.reviewEvidence(user, id, dto);
  }

  @Get('proof-missions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listMissions(@CurrentUser() user: AuthUser, @Query() query: ProofMissionQueryDto) {
    this.requireEvidenceEnabled();
    return this.career.listMissions(user.id, query.targetId);
  }

  @Post('proof-missions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  createMission(@CurrentUser() user: AuthUser, @Body() dto: CreateProofMissionDto) {
    this.requireEvidenceEnabled();
    return this.career.createMission(user.id, dto);
  }

  @Get('proof-missions/:missionId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getMission(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
  ) {
    this.requireEvidenceEnabled();
    return this.career.getMission(user.id, missionId);
  }

  @Put('proof-missions/:missionId/criteria')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  replaceCriteria(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: ReplaceProofCriteriaDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.replaceCriteria(user.id, missionId, dto);
  }

  @Post('proof-missions/:missionId/bind')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  bindPullRequest(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: BindProofPullRequestDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.bindPullRequest(user.id, missionId, dto);
  }

  @Post('proof-missions/:missionId/refresh')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  refreshVerification(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: IdempotentCommandDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.refreshVerification(user.id, missionId, dto.idempotencyKey);
  }

  @Post('proof-missions/:missionId/submit')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  submitForReview(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: IdempotentCommandDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.submitForReview(user.id, missionId, dto.idempotencyKey);
  }

  @Post('proof-missions/:missionId/review')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  reviewMission(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: ReviewProofMissionDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.reviewMission(user, missionId, dto);
  }

  @Post('proof-missions/:missionId/archive')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  archiveMission(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: IdempotentCommandDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.archiveMission(user.id, missionId, dto.idempotencyKey);
  }

  @Get('proof-reviews')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listProofReviewQueue(@CurrentUser() user: AuthUser) {
    this.requireEvidenceEnabled();
    return this.career.listProofReviewQueue(user);
  }

  @Get('proof-profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getProofProfile(@CurrentUser() user: AuthUser) {
    this.requireEvidenceEnabled();
    return this.career.getProofProfile(user.id);
  }

  @Put('proof-profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateProofProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProofProfileDto) {
    this.requireEvidenceEnabled();
    return this.career.updateProofProfile(user.id, dto);
  }

  @Post('proof-profile/publish/:missionId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  publishProof(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: PublishProofDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.publishProof(user.id, missionId, dto);
  }

  @Post('proof-profile/renew/:missionId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  renewPublicationLease(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: IdempotentCommandDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.renewPublicationLease(user.id, missionId, dto.idempotencyKey);
  }

  @Post('proof-profile/unpublish/:missionId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  unpublishProof(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: UnpublishProofDto,
  ) {
    this.requireEvidenceEnabled();
    return this.career.unpublishProof(user.id, missionId, dto.idempotencyKey);
  }

  @Get('proof-profiles/:publicId')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  getPublicProofProfile(@Param('publicId') publicId: string) {
    this.requireEvidenceEnabled();
    if (this.config.get<string>('PUBLIC_PROOF_PROFILE_ENABLED') !== 'true') {
      throw new NotFoundException('Proof Profile not found');
    }
    return this.career.getPublicProofProfile(publicId);
  }

  private requireEvidenceEnabled(): void {
    if (this.config.get<string>('EVIDENCE_EXECUTION_ENABLED') !== 'true') {
      throw new NotFoundException('Proof Profile not found');
    }
  }
}
