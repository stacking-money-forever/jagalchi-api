import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { RoadmapsService } from '../roadmaps/roadmaps.service';
import { CreateUploadDto } from './uploads.dto';
import { UploadAsset, UploadPurpose, UploadStatus } from './upload-asset.entity';

@Injectable()
export class UploadsService {
  private readonly bucket: string | null;
  private readonly client: S3Client | null;
  private readonly presignClient: S3Client | null;
  private readonly presignOrigin: string | null;
  private readonly publicBaseUrl: URL | null;

  constructor(
    config: ConfigService,
    private readonly roadmaps: RoadmapsService,
    @InjectRepository(UploadAsset)
    private readonly assets: Repository<UploadAsset>,
  ) {
    if (config.get<string>('UPLOADS_ENABLED') === 'false') {
      this.bucket = null;
      this.client = null;
      this.presignClient = null;
      this.presignOrigin = null;
      this.publicBaseUrl = null;
      return;
    }
    this.bucket = config.getOrThrow<string>('OBJECT_STORAGE_BUCKET');
    this.publicBaseUrl = new URL(
      config.getOrThrow<string>('OBJECT_STORAGE_PUBLIC_BASE_URL'),
    );
    this.assertBrowserUrl(this.publicBaseUrl, 'OBJECT_STORAGE_PUBLIC_BASE_URL', config.get<string>('NODE_ENV') === 'production', false);
    const region = config.getOrThrow<string>('OBJECT_STORAGE_REGION');
    const forcePathStyle = config.get<string>('OBJECT_STORAGE_FORCE_PATH_STYLE') === 'true';
    const credentials = {
      accessKeyId: config.getOrThrow<string>('OBJECT_STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: config.getOrThrow<string>('OBJECT_STORAGE_SECRET_ACCESS_KEY'),
    };
    this.client = new S3Client({
      region,
      endpoint: config.get<string>('OBJECT_STORAGE_ENDPOINT') || undefined,
      forcePathStyle,
      credentials,
    });
    const presignEndpoint = new URL(config.getOrThrow<string>('OBJECT_STORAGE_PRESIGN_ENDPOINT'));
    this.assertBrowserUrl(presignEndpoint, 'OBJECT_STORAGE_PRESIGN_ENDPOINT', config.get<string>('NODE_ENV') === 'production', true);
    this.presignOrigin = presignEndpoint.origin;
    this.presignClient = new S3Client({
      region,
      endpoint: presignEndpoint.toString(),
      forcePathStyle,
      credentials,
    });
  }

  async createUpload(ownerId: string, dto: CreateUploadDto) {
    const { bucket, presignClient } = this.requireStorage();
    if (dto.purpose === UploadPurpose.ProfileImage) {
      if (dto.roadmapId || !dto.contentType.startsWith('image/')) {
        throw new BadRequestException('Profile uploads must be an image');
      }
    } else {
      if (!dto.roadmapId) {
        throw new BadRequestException('Roadmap attachment requires a roadmap');
      }
      await this.roadmaps.getOwned(ownerId, dto.roadmapId);
    }
    const safeName = this.safeFileName(dto.fileName);
    const prefix =
      dto.purpose === UploadPurpose.ProfileImage
        ? `public/profiles/${ownerId}`
        : `private/roadmaps/${dto.roadmapId}`;
    const objectKey = `${prefix}/${randomUUID()}/${safeName}`;
    const asset = await this.assets.save(
      this.assets.create({
        ownerId,
        roadmapId: dto.roadmapId ?? null,
        purpose: dto.purpose,
        objectKey,
        fileName: safeName,
        contentType: dto.contentType,
        expectedSize: dto.size,
        status: UploadStatus.Pending,
      }),
    );
    const uploadUrl = await getSignedUrl(
      presignClient,
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: dto.contentType,
        ContentLength: dto.size,
      }),
      { expiresIn: 10 * 60 },
    );
    this.assertGeneratedSignedUrl(uploadUrl);
    return {
      id: asset.id,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'content-type': dto.contentType },
      expiresInSeconds: 10 * 60,
    };
  }

  async complete(ownerId: string, assetId: string) {
    const { bucket, client } = this.requireStorage();
    const asset = await this.getOwned(ownerId, assetId);
    const object = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: asset.objectKey }),
    );
    if (
      object.ContentLength !== asset.expectedSize ||
      object.ContentType !== asset.contentType
    ) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey }),
      );
      await this.assets.delete({ id: asset.id });
      throw new BadRequestException('Uploaded object does not match the approved file');
    }
    asset.status = UploadStatus.Ready;
    await this.assets.save(asset);
    return this.toResponse(asset);
  }

  async getDownload(ownerId: string, assetId: string) {
    const { bucket, presignClient } = this.requireStorage();
    const asset = await this.getOwned(ownerId, assetId);
    if (asset.status !== UploadStatus.Ready) {
      throw new BadRequestException('Upload is not complete');
    }
    const downloadUrl = await getSignedUrl(
      presignClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: asset.objectKey,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      }),
      { expiresIn: 5 * 60 },
    );
    this.assertGeneratedSignedUrl(downloadUrl);
    return { ...this.toResponse(asset), downloadUrl, expiresInSeconds: 5 * 60 };
  }

  async getContentUrl(ownerId: string, assetId: string): Promise<string> {
    const download = await this.getDownload(ownerId, assetId);
    return download.downloadUrl;
  }

  async remove(ownerId: string, assetId: string): Promise<void> {
    const { bucket, client } = this.requireStorage();
    const asset = await this.getOwned(ownerId, assetId);
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey }),
    );
    await this.assets.delete({ id: asset.id });
  }

  private requireStorage(): { bucket: string; client: S3Client; presignClient: S3Client; publicBaseUrl: URL } {
    if (!this.bucket || !this.client || !this.presignClient || !this.publicBaseUrl) {
      throw new ServiceUnavailableException({
        code: 'UPLOADS_DISABLED',
        message: 'Uploads are unavailable',
      });
    }
    return {
      bucket: this.bucket,
      client: this.client,
      presignClient: this.presignClient,
      publicBaseUrl: this.publicBaseUrl,
    };
  }

  private assertBrowserUrl(url: URL, key: string, production: boolean, exactOrigin: boolean): void {
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production && loopback)) {
      throw new Error(`${key} must use HTTPS or development loopback HTTP`);
    }
    if (url.username || url.password || url.search || url.hash || (exactOrigin && url.pathname !== '/')) {
      throw new Error(`${key} must be a safe browser URL`);
    }
  }

  private assertGeneratedSignedUrl(value: string): void {
    const url = new URL(value);
    if (!this.presignOrigin || url.origin !== this.presignOrigin) {
      throw new Error('Generated storage signature uses an unexpected browser origin');
    }
  }

  private async getOwned(ownerId: string, assetId: string): Promise<UploadAsset> {
    const asset = await this.assets.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Upload was not found');
    if (asset.ownerId !== ownerId) throw new ForbiddenException('Upload is not owned by user');
    return asset;
  }

  private safeFileName(fileName: string): string {
    const normalized = fileName.trim().normalize('NFKC');
    if (!normalized || /[\\/\0]/.test(normalized)) {
      throw new BadRequestException('File name is not valid');
    }
    return normalized.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180);
  }

  private toResponse(asset: UploadAsset) {
    const { publicBaseUrl } = this.requireStorage();
    const publicUrl =
      asset.status === UploadStatus.Ready &&
      asset.purpose === UploadPurpose.ProfileImage
        ? new URL(
            asset.objectKey
              .split('/')
              .map((part) => encodeURIComponent(part))
              .join('/'),
            publicBaseUrl,
          ).toString()
        : null;
    return {
      id: asset.id,
      fileName: asset.fileName,
      contentType: asset.contentType,
      size: asset.expectedSize,
      status: asset.status,
      roadmapId: asset.roadmapId,
      publicUrl,
      createdAt: asset.createdAt,
    };
  }
}
