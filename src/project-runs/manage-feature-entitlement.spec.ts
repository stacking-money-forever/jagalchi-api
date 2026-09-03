import { describe, expect, it, vi } from 'vitest';
import { ProjectFeature } from './product-spine.entities';
import { manageFeatureEntitlement, parseFeatureEntitlementCommand } from './manage-feature-entitlement';

describe('feature-entitlement:manage', () => {
  it('parses an explicit operator action and expiry', () => {
    expect(parseFeatureEntitlementCommand(['--operator', 'ops-1', 'enable', 'PROJECT_RUNS', 'USER@example.test', '--expires-at', '2027-01-01T00:00:00Z']))
      .toMatchObject({ operator: 'ops-1', action: 'enable', feature: ProjectFeature.ProjectRuns, email: 'user@example.test', expiresAt: new Date('2027-01-01T00:00:00Z') });
  });

  it('locks, updates, and emits a redacted audit event without email', async () => {
    const entitlement = { userId: 'user-1', feature: ProjectFeature.ProjectRuns, enabled: false, expiresAt: null, reason: 'old', updatedBy: 'old' };
    const users = { findOne: vi.fn().mockResolvedValue({ id: 'user-1' }) };
    const entitlements = { findOne: vi.fn().mockResolvedValue(entitlement), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const manager = { getRepository: vi.fn().mockReturnValueOnce(users).mockReturnValueOnce(entitlements) };
    const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
    const emit = vi.fn();
    const event = await manageFeatureEntitlement(dataSource as never, { operator: 'ops-1', action: 'enable', feature: ProjectFeature.ProjectRuns, email: 'private@example.test', expiresAt: null }, emit);
    expect(entitlements.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
    expect(event).toMatchObject({ targetUserId: 'user-1', action: 'enable', after: { enabled: true, expiresAt: null } });
    expect(JSON.stringify(event)).not.toContain('private@example.test');
    expect(emit).toHaveBeenCalledWith(event);
  });
});
