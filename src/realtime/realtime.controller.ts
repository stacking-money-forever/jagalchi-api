import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RealtimeService } from './realtime.service';
import { RealtimeTicketService } from './realtime-ticket.service';

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

class RealtimeTicketResponseDto {
  @ApiProperty({ type: String, minLength: 43, maxLength: 43 }) ticket: string;
  @ApiProperty({ type: String, enum: ['roadmaps'] }) audience: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: string;
}

@ApiTags('realtime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('realtime/tickets')
export class RealtimeTicketController {
  constructor(private readonly tickets: RealtimeTicketService) {}

  @Post()
  @ApiOkResponse({ type: RealtimeTicketResponseDto })
  issue(@CurrentUser() user: AuthUser) {
    return this.tickets.issue(user.id, 'roadmaps');
  }
}
