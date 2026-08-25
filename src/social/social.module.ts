import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import {
  Comment,
  Follow,
  Notification,
  NotificationPreference,
} from './entities/social.entities';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  imports: [
    AuthModule,
    RoadmapsModule,
    TypeOrmModule.forFeature([
      Comment,
      Follow,
      Notification,
      NotificationPreference,
    ]),
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService, TypeOrmModule],
})
export class SocialModule {}
