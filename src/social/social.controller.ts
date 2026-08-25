import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CommentListQueryDto,
  CreateCommentDto,
  NotificationListQueryDto,
  UpdateCommentDto,
  UpdateNotificationPreferencesDto,
} from './social.dto';
import { SocialService } from './social.service';

@ApiTags('social')
@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('roadmaps/public/:roadmapId/comments')
  listComments(
    @Param('roadmapId', ParseUUIDPipe) roadmapId: string,
    @Query() query: CommentListQueryDto,
  ) {
    return this.social.listPublicComments(roadmapId, query);
  }

  @Post('roadmaps/:roadmapId/comments')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  createComment(
    @CurrentUser() user: AuthUser,
    @Param('roadmapId', ParseUUIDPipe) roadmapId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.social.createComment(user.id, roadmapId, dto);
  }

  @Patch('comments/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.social.updateComment(user.id, id, dto);
  }

  @Delete('comments/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async deleteComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.social.deleteComment(user.id, id);
  }

  @Put('users/:id/follow')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  follow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.social.follow(user.id, id);
  }

  @Delete('users/:id/follow')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  unfollow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.social.unfollow(user.id, id);
  }

  @Get('users/:id/followers')
  listFollowers(@Param('id', ParseUUIDPipe) id: string) {
    return this.social.listFollowers(id);
  }

  @Get('users/:id/following')
  listFollowing(@Param('id', ParseUUIDPipe) id: string) {
    return this.social.listFollowing(id);
  }

  @Get('notifications')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listNotifications(
    @CurrentUser() user: AuthUser,
    @Query() query: NotificationListQueryDto,
  ) {
    return this.social.listNotifications(user.id, query);
  }

  @Patch('notifications/:id/read')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.social.markRead(user.id, id);
  }

  @Patch('notifications/read-all')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async markAllRead(@CurrentUser() user: AuthUser): Promise<void> {
    await this.social.markAllRead(user.id);
  }

  @Get('notifications/preferences')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getPreferences(@CurrentUser() user: AuthUser) {
    return this.social.getPreferences(user.id);
  }

  @Put('notifications/preferences')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.social.updatePreferences(user.id, dto);
  }
}
