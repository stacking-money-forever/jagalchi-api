import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CareerV1Service } from './career-v1.service';
import { ConfirmCareerDiffDto, ConfirmProfileSnapshotDto, CreateCareerDiffDto, CreateProjectRunOperationDto, ProfileSnapshotOperationDto, ProjectProposalOperationDto, TargetImportDto } from './career-v1.dto';

const requireKey = (value: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '')) throw new BadRequestException('Idempotency-Key must be a UUID');
  return value;
};

@ApiTags('career v1') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('career')
export class CareerV1Controller {
  constructor(private readonly service: CareerV1Service) {}
  @Post('target-imports') @HttpCode(202) targetImport(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() body: TargetImportDto) { return this.service.targetImport(user.id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Post('profile-snapshot-operations/github') @HttpCode(202) profileOperation(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() body: ProfileSnapshotOperationDto) { return this.service.profileOperation(user.id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Get('target-versions/:id') targetVersion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getTargetVersion(user.id, id); }
  @Get('profile-snapshots/:id') profile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getProfile(user.id, id); }
  @Post('profile-snapshots/:id/confirm') confirmProfile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: ConfirmProfileSnapshotDto) { return this.service.confirmProfile(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Post('targets/:id/diff-snapshots') createDiff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: CreateCareerDiffDto) { return this.service.createDiff(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Get('diff-snapshots/:id') diff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getDiff(user.id, id); }
  @Post('diff-snapshots/:id/confirm') confirmDiff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: ConfirmCareerDiffDto) { return this.service.confirmDiff(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Post('targets/:id/project-proposal-operations') @HttpCode(202) proposals(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: ProjectProposalOperationDto) { return this.service.proposalOperation(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Get('project-proposal-sets/:id') proposalSet(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getProposalSet(user.id, id); }
}

@ApiTags('project run operations') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('project-run-operations')
export class ProjectRunOperationsController {
  constructor(private readonly service: CareerV1Service) {}
  @Post() @HttpCode(202) create(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() body: CreateProjectRunOperationDto) { return this.service.projectRunOperation(user.id, requireKey(key), body as unknown as Record<string, unknown>); }
}
