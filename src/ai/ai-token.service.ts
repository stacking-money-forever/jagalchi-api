import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AiTokenService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  issue(userId: string, roadmapId?: string): string {
    return this.jwt.sign(
      {
        permissions: ['EDIT'],
        ...(roadmapId ? { roadmapId } : {}),
      },
      {
        subject: userId,
        issuer: 'jagalchi-api',
        audience: 'jagalchi-ai',
        algorithm: 'HS256',
        expiresIn: '5m',
        secret: this.config.getOrThrow<string>('AI_AUTH_JWT_SECRET'),
      },
    );
  }

  issueInternal(userId: string, permission: 'EXTRACT' | 'INTERPRET' | 'PROPOSE' | 'COMPILE'): string {
    return this.jwt.sign(
      { permissions: [permission] },
      {
        subject: userId, issuer: 'jagalchi-api', audience: 'jagalchi-ai', algorithm: 'HS256',
        expiresIn: '2m', secret: this.config.getOrThrow<string>('AI_AUTH_JWT_SECRET'),
      },
    );
  }
}
