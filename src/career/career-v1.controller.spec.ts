import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CareerV1Controller } from './career-v1.controller';

describe('CareerV1Controller', () => {
  it('forwards owner-scoped target imports with a UUID idempotency key', async () => {
    const service = { targetImport: vi.fn().mockResolvedValue({ operation: { id: 'operation-1' } }) };
    const controller = new CareerV1Controller(service as never);
    await controller.targetImport({ id: 'owner-1', roles: [] }, '00000000-0000-4000-8000-000000000099', { input: { kind: 'FETCHED_URL', url: 'https://fixture.invalid/jobs/software-engineer' } });
    expect(service.targetImport).toHaveBeenCalledWith('owner-1', '00000000-0000-4000-8000-000000000099', expect.any(Object));
    expect(() => controller.targetImport({ id: 'owner-1', roles: [] }, 'bad', {})).toThrow(BadRequestException);
  });
});
