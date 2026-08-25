import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { User } from '../auth/auth.entities';
import { RoadmapsService } from '../roadmaps/roadmaps.service';
import {
  CommentListQueryDto,
  CreateCommentDto,
  NotificationListQueryDto,
  UpdateCommentDto,
  UpdateNotificationPreferencesDto,
} from './social.dto';
import {
  Comment,
  Follow,
  Notification,
  NotificationPreference,
  NotificationType,
} from './entities/social.entities';

export interface NotificationInput {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  resourceType?: string;
  resourceId?: string;
  title: string;
  body: string;
}

@Injectable()
export class SocialService {
  constructor(
    private readonly roadmaps: RoadmapsService,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(Follow) private readonly follows: Repository<Follow>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferences: Repository<NotificationPreference>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async listPublicComments(roadmapId: string, query: CommentListQueryDto) {
    await this.roadmaps.getPublic(roadmapId);
    const [comments, total] = await this.comments.findAndCount({
      where: { roadmapId },
      order: { createdAt: 'ASC' },
      skip: (query.page - 1) * query.size,
      take: query.size,
    });
    return {
      items: comments.map((comment) =>
        comment.isDeleted
          ? { ...comment, content: '', deleted: true }
          : { ...comment, deleted: false },
      ),
      page: query.page,
      size: query.size,
      total,
    };
  }

  async createComment(
    actorId: string,
    roadmapId: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const roadmap = await this.requireAccessibleRoadmap(actorId, roadmapId);
    let parent: Comment | null = null;
    if (dto.parentId) {
      parent = await this.comments.findOne({ where: { id: dto.parentId } });
      if (!parent || parent.roadmapId !== roadmapId || parent.isDeleted) {
        throw new BadRequestException('Reply parent is not available');
      }
      if (parent.parentId) {
        throw new BadRequestException('Replies can be nested only one level');
      }
    }

    const comment = await this.comments.save(
      this.comments.create({
        roadmapId,
        authorId: actorId,
        parentId: parent?.id ?? null,
        content: dto.content.trim(),
        isDeleted: false,
      }),
    );
    const recipientId = parent?.authorId ?? roadmap.ownerId;
    if (recipientId !== actorId) {
      await this.notify({
        recipientId,
        actorId,
        type: parent ? NotificationType.Reply : NotificationType.Comment,
        resourceType: 'roadmap',
        resourceId: roadmapId,
        title: parent ? '새 답글이 도착했어요' : '새 댓글이 도착했어요',
        body: comment.content.slice(0, 160),
      });
    }
    return comment;
  }

  async updateComment(
    actorId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<Comment> {
    const comment = await this.requireComment(commentId);
    if (comment.authorId !== actorId) throw new ForbiddenException('Only the author can edit');
    if (comment.isDeleted) throw new BadRequestException('Deleted comments cannot be edited');
    comment.content = dto.content.trim();
    return this.comments.save(comment);
  }

  async deleteComment(actorId: string, commentId: string): Promise<void> {
    const comment = await this.requireComment(commentId);
    if (comment.authorId !== actorId) {
      throw new ForbiddenException('Only the author can delete');
    }
    if (comment.isDeleted) return;
    comment.isDeleted = true;
    comment.content = '';
    await this.comments.save(comment);
  }

  async follow(followerId: string, followeeId: string): Promise<{ following: true }> {
    if (followerId === followeeId) throw new BadRequestException('You cannot follow yourself');
    const existing = await this.follows.findOne({ where: { followerId, followeeId } });
    if (!existing) {
      await this.follows.save(this.follows.create({ followerId, followeeId }));
      await this.notify({
        recipientId: followeeId,
        actorId: followerId,
        type: NotificationType.Follow,
        resourceType: 'profile',
        resourceId: followerId,
        title: '새 팔로워가 생겼어요',
        body: '프로필에서 새로운 팔로워를 확인해 보세요.',
      });
    }
    return { following: true };
  }

  async unfollow(
    followerId: string,
    followeeId: string,
  ): Promise<{ following: false }> {
    await this.follows.delete({ followerId, followeeId });
    return { following: false };
  }

  async listFollowers(userId: string) {
    const follows = await this.follows.find({
      where: { followeeId: userId },
      order: { createdAt: 'DESC' },
    });
    return this.followList(userId, 'FOLLOWERS', follows, 'followerId');
  }

  async listFollowing(userId: string) {
    const follows = await this.follows.find({
      where: { followerId: userId },
      order: { createdAt: 'DESC' },
    });
    return this.followList(userId, 'FOLLOWINGS', follows, 'followeeId');
  }

  private async followList(
    userId: string,
    type: 'FOLLOWERS' | 'FOLLOWINGS',
    follows: Follow[],
    idField: 'followerId' | 'followeeId',
  ) {
    const ids = follows.map((follow) => follow[idField]);
    const users = ids.length ? await this.users.find({ where: { id: In(ids) } }) : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      userId,
      type,
      totalCount: follows.length,
      users: ids.flatMap((id) => {
        const user = byId.get(id);
        return user
          ? [
              {
                id: user.id,
                name: user.name,
                profileImage: user.profileImageUrl,
                isFollowing: type === 'FOLLOWINGS',
              },
            ]
          : [];
      }),
    };
  }

  async notify(input: NotificationInput): Promise<Notification | null> {
    const preference = await this.preferences.findOne({ where: { userId: input.recipientId } });
    if (preference && !this.isNotificationEnabled(preference, input.type)) return null;
    return this.notifications.save(
      this.notifications.create({
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        type: input.type,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        title: input.title,
        body: input.body,
        readAt: null,
      }),
    );
  }

  async listNotifications(userId: string, query: NotificationListQueryDto) {
    const where = query.unreadOnly
      ? { recipientId: userId, readAt: IsNull() }
      : { recipientId: userId };
    const [items, total] = await this.notifications.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.size,
      take: query.size,
    });
    const unread = await this.notifications.count({
      where: { recipientId: userId, readAt: IsNull() },
    });
    return { items, page: query.page, size: query.size, total, unread };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.notifications.findOne({
      where: { id: notificationId, recipientId: userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications.update(
      { recipientId: userId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }

  async getPreferences(userId: string): Promise<NotificationPreference> {
    return (
      (await this.preferences.findOne({ where: { userId } })) ??
      this.preferences.create({ userId })
    );
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreference> {
    const preference = await this.getPreferences(userId);
    Object.assign(preference, dto);
    return this.preferences.save(preference);
  }

  private async requireAccessibleRoadmap(actorId: string, roadmapId: string) {
    try {
      return await this.roadmaps.getPublic(roadmapId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      return this.roadmaps.getOwned(actorId, roadmapId);
    }
  }

  private async requireComment(id: string): Promise<Comment> {
    const comment = await this.comments.findOne({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  private isNotificationEnabled(
    preference: NotificationPreference,
    type: NotificationType,
  ): boolean {
    const setting: Partial<
      Record<
        NotificationType,
        | 'comments'
        | 'replies'
        | 'follows'
        | 'forks'
        | 'likes'
        | 'aiComplete'
        | 'learningReminders'
      >
    > = {
      [NotificationType.Comment]: 'comments',
      [NotificationType.Reply]: 'replies',
      [NotificationType.Follow]: 'follows',
      [NotificationType.Fork]: 'forks',
      [NotificationType.Like]: 'likes',
      [NotificationType.AiComplete]: 'aiComplete',
      [NotificationType.LearningReminder]: 'learningReminders',
    };
    const key = setting[type];
    return key ? preference[key] === true : true;
  }
}
