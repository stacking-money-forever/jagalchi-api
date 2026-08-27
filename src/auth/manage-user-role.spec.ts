import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  manageUserRole,
  parseManageUserRoleCommand,
  type UserRoleAuditEvent,
} from './manage-user-role';

function createDataSource(roles: string[] = ['USER', 'CONTRIBUTOR']) {
  const user = { id: 'user-1', email: 'reviewer@example.com', roles };
  const users = {
    findOne: vi.fn().mockResolvedValue(user),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const dataSource = { getRepository: vi.fn().mockReturnValue(users) } as unknown as DataSource;
  return { dataSource, user, users };
}

describe('manage user role CLI', () => {
  it('normalizes the target email and requires a named operator', () => {
    expect(
      parseManageUserRoleCommand([
        '--operator',
        'ops-123',
        'grant',
        'reviewer',
        ' REVIEWER@Example.com ',
      ]),
    ).toEqual({
      operator: 'ops-123',
      action: 'grant',
      role: 'REVIEWER',
      email: 'reviewer@example.com',
    });
    expect(() =>
      parseManageUserRoleCommand(['grant', 'REVIEWER', 'reviewer@example.com']),
    ).toThrow('Usage:');
  });

  it('rejects ADMIN and other unsupported roles', () => {
    expect(() =>
      parseManageUserRoleCommand([
        '--operator',
        'ops-123',
        'grant',
        'ADMIN',
        'reviewer@example.com',
      ]),
    ).toThrow('Unsupported role: ADMIN');
  });

  it('also rejects unsupported roles when called programmatically', async () => {
    const subject = createDataSource();

    await expect(
      manageUserRole(subject.dataSource, {
        operator: 'ops-123',
        action: 'grant',
        role: 'ADMIN' as never,
        email: 'reviewer@example.com',
      }),
    ).rejects.toThrow('Unsupported role: ADMIN');
    expect(subject.users.save).not.toHaveBeenCalled();
  });

  it('grants a reviewer role without replacing USER or unrelated roles and emits an audit event', async () => {
    const subject = createDataSource();
    const audit = vi.fn<(event: UserRoleAuditEvent) => void>();

    const event = await manageUserRole(
      subject.dataSource,
      {
        operator: 'ops-123',
        action: 'grant',
        role: 'REVIEWER',
        email: 'reviewer@example.com',
      },
      audit,
    );

    expect(subject.users.save).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'reviewer@example.com',
      roles: ['USER', 'CONTRIBUTOR', 'REVIEWER'],
    });
    expect(event).toMatchObject({
      operator: 'ops-123',
      targetUserId: 'user-1',
      action: 'grant',
      role: 'REVIEWER',
      beforeRoles: ['USER', 'CONTRIBUTOR'],
      afterRoles: ['USER', 'CONTRIBUTOR', 'REVIEWER'],
    });
    expect(event.timestamp).toEqual(expect.any(String));
    expect(audit).toHaveBeenCalledWith(event);
  });

  it('rejects unknown users and no-op role transitions', async () => {
    const missingUser = createDataSource();
    missingUser.users.findOne.mockResolvedValue(null);

    await expect(
      manageUserRole(missingUser.dataSource, {
        operator: 'ops-123',
        action: 'grant',
        role: 'TEACHER',
        email: 'missing@example.com',
      }),
    ).rejects.toThrow('Unknown user: missing@example.com');

    const existingReviewer = createDataSource(['USER', 'REVIEWER']);
    await expect(
      manageUserRole(existingReviewer.dataSource, {
        operator: 'ops-123',
        action: 'grant',
        role: 'REVIEWER',
        email: 'reviewer@example.com',
      }),
    ).rejects.toThrow('No role change: user already has REVIEWER');
    expect(existingReviewer.users.save).not.toHaveBeenCalled();
  });

  it('revokes only the requested role', async () => {
    const subject = createDataSource(['USER', 'REVIEWER', 'CONTRIBUTOR']);

    await manageUserRole(subject.dataSource, {
      operator: 'ops-123',
      action: 'revoke',
      role: 'REVIEWER',
      email: 'reviewer@example.com',
    });

    expect(subject.users.save).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'reviewer@example.com',
      roles: ['USER', 'CONTRIBUTOR'],
    });
  });
});
