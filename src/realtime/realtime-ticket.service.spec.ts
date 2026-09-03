import { describe, expect, it, vi } from 'vitest';
import { RealtimeTicketService } from './realtime-ticket.service';

describe('RealtimeTicketService', () => {
  it('issues an opaque 60-second audience-bound ticket', async () => {
    const repository = { create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const service = new RealtimeTicketService({} as never, repository as never);
    const before = Date.now();
    const result = await service.issue('user-1', 'roadmaps');
    expect(result.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.audience).toBe('roadmaps');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', audience: 'roadmaps', tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), consumedAt: null,
    }));
  });

  it('atomically marks a valid ticket consumed and returns its user', async () => {
    const ticket = { userId: 'user-1', consumedAt: null };
    const repository = { findOne: vi.fn().mockResolvedValue(ticket), save: vi.fn(async (value) => value) };
    const dataSource = { transaction: vi.fn((callback) => callback({ getRepository: () => repository })) };
    const service = new RealtimeTicketService(dataSource as never, {} as never);
    await expect(service.consume('opaque-ticket', 'roadmaps')).resolves.toBe('user-1');
    expect(ticket.consumedAt).toBeInstanceOf(Date);
    expect(repository.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
  });
});
