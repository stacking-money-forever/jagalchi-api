import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiJobsService } from './ai-jobs.service';
import { RunAiJobDto } from './dto/run-ai-job.dto';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly jobs: AiJobsService) {}

  @Post('jobs')
  run(@CurrentUser() user: AuthUser, @Body() dto: RunAiJobDto) {
    return this.jobs.run(
      user.id,
      dto.feature,
      dto.idempotencyKey,
      dto.payload,
      dto.roadmapId,
    );
  }
}
