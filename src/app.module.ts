import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { HealthModule } from './health/health.module';
import { validateEnvironment } from './shared/config/environment';
import { TicketsModule } from './tickets/tickets.module';
import { RoadmapsModule } from './roadmaps/roadmaps.module';
import { SocialModule } from './social/social.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: config.get<string>('DATABASE_SYNCHRONIZE') === 'true',
        ssl:
          config.get<string>('DATABASE_SSL') === 'true'
            ? { rejectUnauthorized: true }
            : false,
      }),
    }),
    AuthModule,
    AiModule,
    HealthModule,
    TicketsModule,
    RoadmapsModule,
    SocialModule,
    RealtimeModule,
    UploadsModule,
  ],
})
export class AppModule {}
