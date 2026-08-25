import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RealtimeService } from './realtime.service';

@ApiTags('roadmap events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('roadmaps/:roadmapId/events')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get()
  readSince(
    @CurrentUser() user: AuthUser,
    @Param('roadmapId', ParseUUIDPipe) roadmapId: string,
    @Query('after', new ParseIntPipe({ optional: true })) after = 0,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 200,
  ) {
    return this.realtime.readSince(user.id, roadmapId, Math.max(after, 0), limit);
  }
}
