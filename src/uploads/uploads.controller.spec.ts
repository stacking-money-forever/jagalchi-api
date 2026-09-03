import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadsController } from './uploads.controller';

describe('UploadsController content route', () => {
  it('keeps the route authenticated and owner scoped without returning a durable URL field', async () => {
    const uploads = { getContentUrl: vi.fn().mockResolvedValue('https://storage.example/fresh-signature') };
    const controller = new UploadsController(uploads as never);

    await expect(controller.getContent(
      { id: 'owner-1', roles: [] },
      '11111111-1111-4111-8111-111111111111',
    )).resolves.toEqual({ url: 'https://storage.example/fresh-signature', statusCode: 302 });
    expect(uploads.getContentUrl).toHaveBeenCalledWith(
      'owner-1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, UploadsController)).toContain(JwtAuthGuard);
  });
});
