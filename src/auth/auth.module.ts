import { forwardRef, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketsModule } from '../tickets/tickets.module';
import { AuthController, UsersController } from './auth.controller';
import {
  OAuthAttempt,
  OAuthIdentity,
  OAuthLoginGrant,
  EmailVerificationChallenge,
  RefreshSession,
  User,
} from './auth.entities';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          issuer: 'jagalchi-api',
          audience: 'jagalchi-client',
        },
      }),
    }),
    TypeOrmModule.forFeature([
      User,
      OAuthIdentity,
      RefreshSession,
      OAuthAttempt,
      OAuthLoginGrant,
      EmailVerificationChallenge,
    ]),
    forwardRef(() => TicketsModule),
  ],
  controllers: [UsersController, AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule, TypeOrmModule],
})
export class AuthModule {}
