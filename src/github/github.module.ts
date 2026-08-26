import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OAuthIdentity } from '../auth/auth.entities';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubClient } from './github.client';
import { GithubController } from './github.controller';
import {
  GithubInstallation,
  GithubInstallationClaimAttempt,
  GithubInstallationRepository,
  GithubWebhookDelivery,
} from './github.entities';
import { GithubService } from './github.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      OAuthIdentity,
      GithubInstallationClaimAttempt,
      GithubInstallation,
      GithubInstallationRepository,
      GithubWebhookDelivery,
    ]),
  ],
  controllers: [GithubController, GithubWebhookController],
  providers: [GithubClient, GithubService],
  exports: [GithubService],
})
export class GithubModule {}
