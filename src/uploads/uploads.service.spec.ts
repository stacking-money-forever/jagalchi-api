import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('http://127.0.0.1:9000/uploads/private/file.pdf?signature=fresh'),
}));

import { UploadsService } from './uploads.service';
import { UploadPurpose, UploadStatus } from './upload-asset.entity';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

describe('UploadsService', () => {
  const roadmaps = { getOwned: vi.fn() };
  const assets = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({
      id: '11111111-1111-4111-8111-111111111111',
      createdAt: new Date(),
      ...value,
    })),
    findOne: vi.fn(),
  };
  const config = {
    getOrThrow: vi.fn((key: string) => ({
      OBJECT_STORAGE_BUCKET: 'uploads',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
      OBJECT_STORAGE_PRESIGN_ENDPOINT: 'http://127.0.0.1:9000',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example/',
    })[key]),
    get: vi.fn((key: string) => ({
      NODE_ENV: 'development',
      OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
      OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    })[key]),
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
      service.getContentUrl('user-1', 'asset-1'),
      service.remove('user-1', 'asset-1'),
    ]) {
      await expect(operation).rejects.toBeInstanceOf(ServiceUnavailableException);
    }

    expect(disabledConfig.getOrThrow).not.toHaveBeenCalled();
    expect(assets.save).not.toHaveBeenCalled();
    expect(roadmaps.getOwned).not.toHaveBeenCalled();
  });

  it('uses a distinct loopback client for browser signatures and keeps the internal client for storage operations', async () => {
    const service = new UploadsService(config as never, roadmaps as never, assets as never);
    const clients = service as unknown as {
      client: { config: { endpoint: () => Promise<{ hostname: string }> } };
      presignClient: { config: { endpoint: () => Promise<{ hostname: string }> } };
    };
    await expect(clients.client.config.endpoint()).resolves.toMatchObject({ hostname: 'minio' });
    await expect(clients.presignClient.config.endpoint()).resolves.toMatchObject({ hostname: '127.0.0.1' });

    vi.mocked(getSignedUrl).mockResolvedValueOnce('http://127.0.0.1:9000/uploads/private/file.pdf?signature=fresh');
    const result = await service.createUpload('user-1', {
      fileName: 'file.pdf', purpose: UploadPurpose.RoadmapAttachment,
      contentType: 'application/pdf', size: 10,
      roadmapId: '22222222-2222-4222-8222-222222222222',
    });
    expect(new URL(result.uploadUrl).hostname).toBe('127.0.0.1');
    expect(new URL(result.uploadUrl).hostname).not.toBe((await clients.client.config.endpoint()).hostname);
    expect(vi.mocked(getSignedUrl).mock.calls[0]?.[0]).toBe(clients.presignClient);
    expect(vi.mocked(getSignedUrl).mock.calls[0]?.[0]).not.toBe(clients.client);
  });

  it('rejects a non-loopback HTTP browser presign endpoint', () => {
    const unsafe = {
      ...config,
      getOrThrow: vi.fn((key: string) => key === 'OBJECT_STORAGE_PRESIGN_ENDPOINT'
        ? 'http://minio:9000' : config.getOrThrow(key)),
    };
    expect(() => new UploadsService(unsafe as never, roadmaps as never, assets as never))
      .toThrow('OBJECT_STORAGE_PRESIGN_ENDPOINT must use HTTPS or development loopback HTTP');
  });

  it('resolves a fresh content URL only for the completed owner asset', async () => {
    assets.findOne.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111', ownerId: 'owner-1',
      objectKey: 'private/owner-1/file.pdf', status: UploadStatus.Ready,
      expectedSize: 10, contentType: 'application/pdf', fileName: 'file.pdf',
      purpose: UploadPurpose.RoadmapAttachment, roadmapId: null, createdAt: new Date(),
    });
    const service = new UploadsService(config as never, roadmaps as never, assets as never);

    await expect(service.getContentUrl('owner-1', '11111111-1111-4111-8111-111111111111'))
      .resolves.toBe('http://127.0.0.1:9000/uploads/private/file.pdf?signature=fresh');
    expect(assets.findOne).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
    });
  });

  it('rejects content access by a different owner', async () => {
    assets.findOne.mockResolvedValue({ id: 'asset-1', ownerId: 'owner-2', status: UploadStatus.Ready });
    const service = new UploadsService(config as never, roadmaps as never, assets as never);
    await expect(service.getContentUrl('owner-1', 'asset-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects content access before upload completion', async () => {
    assets.findOne.mockResolvedValue({ id: 'asset-1', ownerId: 'owner-1', status: UploadStatus.Pending });
    const service = new UploadsService(config as never, roadmaps as never, assets as never);
    await expect(service.getContentUrl('owner-1', 'asset-1')).rejects.toBeInstanceOf(BadRequestException);
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
