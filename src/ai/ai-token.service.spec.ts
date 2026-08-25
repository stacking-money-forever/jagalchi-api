import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { AiTokenService } from './ai-token.service';

describe('AiTokenService', () => {
  it('issues short-lived tokens scoped to the internal Django service', () => {
    const secret = 'test-ai-service-secret-with-32-characters';
    const jwt = new JwtService();
    const config = {
      getOrThrow: (key: string) => {
        if (key !== 'AI_AUTH_JWT_SECRET') throw new Error(`Unexpected key: ${key}`);
        return secret;
      },
    };
    const service = new AiTokenService(config as never, jwt);

    const token = service.issue('user-1', 'roadmap-1');
    const payload = jwt.verify<Record<string, unknown>>(token, {
      secret,
      algorithms: ['HS256'],
      issuer: 'jagalchi-api',
      audience: 'jagalchi-ai',
    });

    expect(payload.sub).toBe('user-1');
    expect(payload.roadmapId).toBe('roadmap-1');
    expect(payload.permissions).toEqual(['EDIT']);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
  });
});
