import { BadRequestException, Body, Controller, Delete, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { ApiBearerAuth, ApiBody, ApiParam, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateProjectPlanOperationDto, CreateWorkflowOperationDto } from './workflow-operation.dto';
import { WorkflowOperationService } from './workflow-operation.service';
import { ProjectRunEntitlement } from '../project-runs/project-run-entitlement.entity';
import { ProjectFeature, ProjectFeatureEntitlement } from '../project-runs/product-spine.entities';

const KINDS = {
  'job-posting-extract': 'JOB_POSTING_EXTRACT',
  'candidate-evidence-interpret': 'CANDIDATE_EVIDENCE_INTERPRET',
  'project-proposals': 'PROJECT_PROPOSALS',
} as const;

@ApiTags('workflow operations v1')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/operations')
export class WorkflowOperationController {
  constructor(
    private readonly operations: WorkflowOperationService,
    private readonly config: ConfigService,
    @InjectRepository(ProjectRunEntitlement) private readonly entitlements: Repository<ProjectRunEntitlement>,
    @InjectRepository(ProjectFeatureEntitlement) private readonly featureEntitlements?: Repository<ProjectFeatureEntitlement>,
  ) {}

  @Post('job-posting-extract') @ApiBody({ type: CreateWorkflowOperationDto })
  jobPostingExtract(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkflowOperationDto) { return this.create(user.id, 'job-posting-extract', KINDS['job-posting-extract'], dto); }

  @Post('candidate-evidence-interpret') @ApiBody({ type: CreateWorkflowOperationDto })
  candidateEvidenceInterpret(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkflowOperationDto) { return this.create(user.id, 'candidate-evidence-interpret', KINDS['candidate-evidence-interpret'], dto); }

  @Post('project-proposals') @ApiBody({ type: CreateWorkflowOperationDto })
  projectProposals(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkflowOperationDto) { return this.create(user.id, 'project-proposals', KINDS['project-proposals'], dto); }

  @Post('project-plan') @ApiBody({ type: CreateProjectPlanOperationDto })
  async projectPlan(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectPlanOperationDto) {
    await this.requireCreateEnabled(user.id);
    return this.operations.createOrReplay({ ownerId: user.id, route: '/api/v1/operations/project-plan', idempotencyKey: dto.idempotencyKey, kind: 'PROJECT_PLAN', input: { ...dto.input, targetId: dto.targetId, competencySlugs: dto.competencySlugs } });
  }

  @Get(':id') @ApiParam({ name: 'id', type: String, format: 'uuid' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.operations.get(user.id, id); }

  @Delete(':id') @ApiParam({ name: 'id', type: String, format: 'uuid' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.operations.requestCancel(id, user.id); }

  private async create(ownerId: string, path: string, kind: string, dto: CreateWorkflowOperationDto) {
    await this.requireCreateEnabled(ownerId);
    return this.operations.createOrReplay({ ownerId, route: `/api/v1/operations/${path}`, idempotencyKey: dto.idempotencyKey, kind, input: dto.input });
  }

  private async requireCreateEnabled(ownerId: string): Promise<void> {
    if (this.config.get<string>('PROJECT_RUNS_ENABLED') !== 'true') throw new ServiceUnavailableException({ code: 'PROJECT_RUNS_DISABLED', message: 'Project Runs are unavailable' });
    const entitled = this.featureEntitlements
      ? await this.featureEntitlements.exists({ where: [
        { userId: ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: IsNull() },
        { userId: ownerId, feature: ProjectFeature.ProjectRuns, enabled: true, expiresAt: MoreThan(new Date()) },
      ] })
      : await this.entitlements.exists({ where: { ownerId, enabled: true } });
    if (!entitled) throw new NotFoundException('Project Run entitlement not found');
  }
}

@ApiTags('workflow operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workflow-operations')
export class WorkflowOperationPublicController {
  constructor(private readonly operations: WorkflowOperationService) {}
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.operations.get(user.id, id); }
  @Post(':id/cancel') cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') version: string, @Headers('idempotency-key') key: string) {
    if (!/^[1-9]\d*$/.test(version ?? '') || !Number.isSafeInteger(Number(version))) throw new BadRequestException('If-Match must be an unquoted positive integer');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key ?? '')) throw new BadRequestException('Idempotency-Key must be a UUID');
    return this.operations.requestCancelVersioned(id, user.id, Number(version), key);
  }
}
