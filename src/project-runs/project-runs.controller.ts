import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRunsService, type TaskCommand } from './project-runs.service';
import { ProjectRunState } from './project-run.entity';

class ProjectRunPlanDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }) id: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) schemaVersion: number;
}
class ProjectRunVerificationFailureDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128 }) code: string;
  @ApiProperty({ type: String, maxLength: 1000, nullable: true }) note: string | null;
}
class ProjectRunTaskDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }) id: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 300 }) title: string;
  @ApiProperty({ type: String, enum: ['LOCKED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DEFERRED', 'VERIFYING', 'DONE'] }) state: string;
  @ApiProperty({ type: Boolean }) required: boolean;
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', nullable: true }) milestoneId: string | null;
  @ApiProperty({ type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' } }) prerequisiteIds: string[];
  @ApiProperty({ type: String, maxLength: 2000 }) purpose: string;
  @ApiProperty({ type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1000 } }) acceptanceCriteria: string[];
  @ApiProperty({ type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1000 } }) evidenceRequirements: string[];
  @ApiProperty({ required: false, nullable: true, type: ProjectRunVerificationFailureDto }) verificationFailure?: ProjectRunVerificationFailureDto | null;
}
class ProjectRunMapNodeDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }) id: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 300 }) title: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', nullable: true }) milestoneId: string | null;
  @ApiProperty({ type: String, enum: ['LOCKED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DEFERRED', 'VERIFYING', 'DONE'] }) state: string;
}
class ProjectRunMapEdgeDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }) id: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }) source: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }) target: string;
  @ApiProperty({ type: String, enum: ['PREREQUISITE', 'SEQUENCE'] }) kind: string;
}
class ProjectRunMapDto {
  @ApiProperty({ type: [ProjectRunMapNodeDto], maxItems: 40 }) nodes: ProjectRunMapNodeDto[];
  @ApiProperty({ type: [ProjectRunMapEdgeDto], maxItems: 120 }) edges: ProjectRunMapEdgeDto[];
}
class ProjectRunProofPublicationDto {
  @ApiProperty({ type: String, enum: ['ACTIVE', 'UNPUBLISHED', 'INVALIDATED'] }) state: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', nullable: true }) publicId: string | null;
}
class ProjectRunProofVerificationDto {
  @ApiProperty({ type: String, enum: ['PENDING', 'PASS', 'FAIL', 'STALE'] }) state: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) verifiedAt: string | null;
}
class ProjectRunProofEvaluationDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128 }) ruleId: string;
  @ApiProperty({ enum: ['MERGED_PR', 'BASE_BRANCH', 'CHANGED_PATH', 'NAMED_CHECK'] }) type: string;
  @ApiProperty({ type: Boolean }) passed: boolean;
  @ApiProperty({ type: String, minLength: 1, maxLength: 128 }) code: string;
}
class ProjectRunProofFactsDto {
  @ApiProperty({ format: 'uuid' }) snapshotId: string;
  @ApiProperty({ enum: ['MACHINE_VERIFIED', 'INDEPENDENTLY_REVIEWED'] }) verificationLevel: string;
  @ApiProperty({ enum: ['fixture', 'github'] }) provider: string;
  @ApiProperty({ pattern: '^[1-9]\\d{0,19}$' }) repositoryId: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) pullNumber: number;
  @ApiProperty({ pattern: '^[0-9a-f]{40}$' }) headSha: string;
  @ApiProperty({ format: 'date-time' }) observedAt: string;
  @ApiProperty({ type: [ProjectRunProofEvaluationDto], maxItems: 20 }) evaluations: ProjectRunProofEvaluationDto[];
}
class ProjectRunProofDto {
  @ApiProperty({ type: String, maxLength: 2000 }) summary: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validUntil: string | null;
  @ApiProperty({ type: ProjectRunProofPublicationDto }) publication: ProjectRunProofPublicationDto;
  @ApiProperty({ type: ProjectRunProofVerificationDto }) verification: ProjectRunProofVerificationDto;
  @ApiProperty({ required: false, type: ProjectRunProofFactsDto }) facts?: ProjectRunProofFactsDto;
}
export class ProjectRunProjectionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, enum: ['READY', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'ARCHIVED'] }) state: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version: number;
  @ApiProperty({ required: false, type: Object }) target?: { company: string; role: string };
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', nullable: true }) currentTaskId: string | null;
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', nullable: true }) recommendedTaskId: string | null;
  @ApiProperty({ type: ProjectRunPlanDto }) plan: ProjectRunPlanDto;
  @ApiProperty({ type: ProjectRunMapDto }) map: ProjectRunMapDto;
  @ApiProperty({ type: [ProjectRunTaskDto], maxItems: 40 }) tasks: ProjectRunTaskDto[];
  @ApiProperty({ type: ProjectRunProofDto, nullable: true }) proof: ProjectRunProofDto | null;
}

@ApiTags('project runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('project-runs')
export class ProjectRunsController {
  constructor(private readonly runs: ProjectRunsService) {}

  @Get()
  listProjectRuns(
    @CurrentUser() user: AuthUser,
    @Query('state') state?: ProjectRunState,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (state && !Object.values(ProjectRunState).includes(state)) throw new BadRequestException('state is invalid');
    if (limit && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50)) throw new BadRequestException('limit is invalid');
    return this.runs.list(user.id, state, limit ? Number(limit) : 20, cursor);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: ProjectRunProjectionDto })
  getProjectRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.get(user.id, id);
  }

  @Post(':id/tasks/:taskId/start') start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId') taskId: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) { return this.command(user.id, id, taskId, 'start', version, key); }
  @Post(':id/tasks/:taskId/defer') defer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId') taskId: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) { return this.command(user.id, id, taskId, 'defer', version, key); }
  @Post(':id/tasks/:taskId/block') block(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId') taskId: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string, @Body() body: Record<string, unknown>) { return this.command(user.id, id, taskId, 'block', version, key, body); }
  @Post(':id/tasks/:taskId/resume') resume(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId') taskId: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) { return this.command(user.id, id, taskId, 'resume', version, key); }
  @Post(':id/tasks/:taskId/verify') @HttpCode(202) verify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId') taskId: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) { return this.command(user.id, id, taskId, 'verify', version, key); }

  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) {
    const parsed = this.headers(version, key);
    return this.runs.archive(user.id, id, parsed.version, parsed.key);
  }

  @Post(':id/reverify') @HttpCode(202)
  reverify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) { const parsed = this.headers(version, key); return this.runs.reverify(user.id, id, parsed.version, parsed.key); }

  @Post(':id/publish')
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) { const parsed = this.headers(version, key); const result = await this.runs.publish(user.id, id, parsed.version, parsed.key); response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK); return result.projection; }

  @Post(':id/unpublish')
  unpublish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) { const parsed = this.headers(version, key); return this.runs.unpublish(user.id, id, parsed.version, parsed.key); }

  private command(ownerId: string, runId: string, taskKey: string, command: TaskCommand, version: string, key: string, body?: Record<string, unknown>) {
    const parsed = this.headers(version, key);
    return this.runs.taskCommand({ ownerId, runId, taskKey, command, expectedVersion: parsed.version, idempotencyKey: parsed.key, body });
  }
  private headers(version: string, key: string) {
    if (!/^[1-9]\d*$/.test(version ?? '')) throw new BadRequestException('If-Match must be an unquoted positive integer');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key ?? '')) throw new BadRequestException('Idempotency-Key must be a UUID');
    const parsed = Number(version);
    if (!Number.isSafeInteger(parsed)) throw new BadRequestException('If-Match is outside the supported integer range');
    return { version: parsed, key };
  }
}
