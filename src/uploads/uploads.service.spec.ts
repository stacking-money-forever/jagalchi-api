import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://storage.example/upload-signature'),
}));

import { UploadsService } from './uploads.service';
import { UploadPurpose, UploadStatus } from './upload-asset.entity';

describe('UploadsService', () => {
  const roadmaps = { getOwned: vi.fn() };
  const assets = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({
      id: '11111111-1111-4111-8111-111111111111',
      createdAt: new Date(),
      ...value,
    })),
  };
  const config = {
    getOrThrow: vi.fn((key: string) => ({
      OBJECT_STORAGE_BUCKET: 'uploads',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example/',
    })[key]),
    get: vi.fn(() => undefined),
  };

  beforeEach(() => vi.clearAllMocks());

  it('fails closed before creating metadata when uploads are disabled', async () => {
    const disabledConfig = {
      get: vi.fn((key: string) => (key === 'UPLOADS_ENABLED' ? 'false' : undefined)),
      getOrThrow: vi.fn(),
    };
    const service = new UploadsService(
      disabledConfig as never,
      roadmaps as never,
      assets as never,
    );

    await expect(
      service.createUpload('user-1', {
        fileName: 'blocked.pdf',
        purpose: UploadPurpose.RoadmapAttachment,
        contentType: 'application/pdf',
        size: 128,
        roadmapId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    for (const operation of [
      service.complete('user-1', 'asset-1'),
      service.getDownload('user-1', 'asset-1'),
      service.remove('user-1', 'asset-1'),
    ]) {
      await expect(operation).rejects.toBeInstanceOf(ServiceUnavailableException);
    }

    expect(disabledConfig.getOrThrow).not.toHaveBeenCalled();
    expect(assets.save).not.toHaveBeenCalled();
    expect(roadmaps.getOwned).not.toHaveBeenCalled();
  });

  it('authorizes a roadmap attachment before issuing a bounded PUT URL', async () => {
    const service = new UploadsService(config as never, roadmaps as never, assets as never);
    const result = await service.createUpload('user-1', {
      fileName: '학습 자료.pdf',
      purpose: UploadPurpose.RoadmapAttachment,
      contentType: 'application/pdf',
      size: 4_096,
      roadmapId: '22222222-2222-4222-8222-222222222222',
    });

    expect(roadmaps.getOwned).toHaveBeenCalledWith(
      'user-1',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(assets.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user-1',
        expectedSize: 4_096,
        purpose: UploadPurpose.RoadmapAttachment,
        status: UploadStatus.Pending,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ method: 'PUT', expiresInSeconds: 600 }),
    );
  });
});
