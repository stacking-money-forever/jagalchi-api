import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiAcceptedWorkflowOperation } from '../http/workflow-openapi';
import { CareerV1Service } from './career-v1.service';
import { ConfirmCareerDiffDto, ConfirmProfileSnapshotDto, CreateCareerDiffDto, CreateProjectRunOperationDto, EligibleGithubRepositoryDto, ProfileSnapshotOperationDto, ProjectProposalOperationDto, TargetImportDto } from './career-v1.dto';

const requireKey = (value: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '')) throw new BadRequestException('Idempotency-Key must be a UUID');
  return value;
};

@ApiTags('career v1') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('career')
export class CareerV1Controller {
  constructor(private readonly service: CareerV1Service) {}
  @Post('target-imports') @ApiAcceptedWorkflowOperation() targetImport(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() body: TargetImportDto) { return this.service.targetImport(user.id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Post('profile-snapshot-operations/github') @ApiAcceptedWorkflowOperation() profileOperation(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() body: ProfileSnapshotOperationDto) { return this.service.profileOperation(user.id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Get('eligible-github-repositories') @ApiOkResponse({ type: [EligibleGithubRepositoryDto] }) listEligibleGithubRepositories(@CurrentUser() user: AuthUser) { return this.service.listEligibleGithubRepositories(user.id); }
  @Get('target-versions/:id') targetVersion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getTargetVersion(user.id, id); }
  @Get('profile-snapshots/:id') profile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getProfile(user.id, id); }
  @Post('profile-snapshots/:id/confirm') @ApiCreatedResponse({ description: 'Confirmed profile snapshot' }) confirmProfile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: ConfirmProfileSnapshotDto) { return this.service.confirmProfile(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Post('targets/:id/diff-snapshots') @ApiCreatedResponse({ description: 'Draft career diff snapshot' }) createDiff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: CreateCareerDiffDto) { return this.service.createDiff(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Get('diff-snapshots/:id') diff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getDiff(user.id, id); }
  @Post('diff-snapshots/:id/confirm') @ApiCreatedResponse({ description: 'Confirmed career diff snapshot' }) confirmDiff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: ConfirmCareerDiffDto) { return this.service.confirmDiff(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Post('targets/:id/project-proposal-operations') @ApiAcceptedWorkflowOperation() proposals(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() body: ProjectProposalOperationDto) { return this.service.proposalOperation(user.id, id, requireKey(key), body as unknown as Record<string, unknown>); }
  @Get('project-proposal-sets/:id') proposalSet(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getProposalSet(user.id, id); }
}

@ApiTags('project run operations') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('project-run-operations')
export class ProjectRunOperationsController {
  constructor(private readonly service: CareerV1Service) {}
  @Post() @ApiAcceptedWorkflowOperation() create(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() body: CreateProjectRunOperationDto) { return this.service.projectRunOperation(user.id, requireKey(key), body as unknown as Record<string, unknown>); }
}
