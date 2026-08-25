import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SocialService } from './social.service';

describe('SocialService', () => {
  const createSubject = () => {
    const comments = {
      findOne: vi.fn(),
      save: vi.fn(async (value) => value),
    };
    const follows = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
      delete: vi.fn(),
    };
    const notifications = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
    };
    const preferences = { findOne: vi.fn().mockResolvedValue(null) };
    const service = new SocialService(
      {} as never,
      comments as never,
      follows as never,
      notifications as never,
      preferences as never,
      {} as never,
    );
    return { comments, follows, notifications, service };
  };

  it('rejects self-following before writing anything', async () => {
    const subject = createSubject();
    await expect(subject.service.follow('user-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(subject.follows.save).not.toHaveBeenCalled();
  });

  it('creates a follow and durable notification once', async () => {
    const subject = createSubject();
    await expect(subject.service.follow('user-1', 'user-2')).resolves.toEqual({
      following: true,
    });
    expect(subject.follows.save).toHaveBeenCalledOnce();
    expect(subject.notifications.save).toHaveBeenCalledOnce();

    subject.follows.findOne.mockResolvedValue({ id: 'follow-1' });
    await subject.service.follow('user-1', 'user-2');
    expect(subject.follows.save).toHaveBeenCalledOnce();
    expect(subject.notifications.save).toHaveBeenCalledOnce();
  });

  it('preserves a deleted comment row so replies retain their thread', async () => {
    const subject = createSubject();
    subject.comments.findOne.mockResolvedValue({
      id: 'comment-1',
      authorId: 'author-1',
      content: '원문',
      isDeleted: false,
    });
    await subject.service.deleteComment('author-1', 'comment-1');
    expect(subject.comments.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: '', isDeleted: true }),
    );

    await expect(
      subject.service.deleteComment('different-user', 'comment-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
