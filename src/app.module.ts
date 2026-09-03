import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { CareerModule } from './career/career.module';
import { postgresExtra, postgresSsl } from './database/postgres-options';
import { GithubModule } from './github/github.module';
import { HealthModule } from './health/health.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RoadmapsModule } from './roadmaps/roadmaps.module';
import { validateEnvironment } from './shared/config/environment';
import { createRateLimitOptions } from './shared/rate-limit/rate-limit';
import { SocialModule } from './social/social.module';
import { TicketsModule } from './tickets/tickets.module';
import { UploadsModule } from './uploads/uploads.module';
import { WorkflowOperationModule } from './workflow-operations/workflow-operation.module';
import { ProjectRunsModule } from './project-runs/project-runs.module';
import { ExecutionOrchestrationModule } from './execution-orchestration/execution-orchestration.module';
import { DevSeedModule } from './database/dev-seed.module';
import { VerificationModule } from './project-runs/verification.module';

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
        ssl: postgresSsl(
          config.get<string>('DATABASE_SSL') === 'true',
          config.get<string>('DATABASE_SSL_CA'),
        ),
        extra: postgresExtra(config, false),
      }),
    }),
    AuthModule,
    ThrottlerModule.forRootAsync({
      imports: [AuthModule],
      inject: [JwtService, ConfigService],
      useFactory: createRateLimitOptions,
    }),
    AiModule,
    HealthModule,
    TicketsModule,
    RoadmapsModule,
    SocialModule,
    RealtimeModule,
    UploadsModule,
    GithubModule,
    CareerModule,
    WorkflowOperationModule,
    ProjectRunsModule,
    ExecutionOrchestrationModule,
    DevSeedModule,
    VerificationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
