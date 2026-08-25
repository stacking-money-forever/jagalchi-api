import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from './auth-user';

interface AccessTokenPayload {
  sub?: unknown;
  email?: unknown;
  roles?: unknown;
  type?: unknown;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
      issuer: 'jagalchi-api',
      audience: 'jagalchi-client',
    });
  }

  validate(payload: AccessTokenPayload): AuthUser {
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      (payload.type !== undefined && payload.type !== 'access')
    ) {
      throw new UnauthorizedException('Invalid access token');
    }

    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      roles: Array.isArray(payload.roles)
        ? payload.roles.filter((role): role is string => typeof role === 'string')
        : [],
    };
  }
}
