import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { RoadmapEvent, RoadmapSequence } from './roadmap-event.entity';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [
    AuthModule,
    RoadmapsModule,
    TypeOrmModule.forFeature([RoadmapEvent, RoadmapSequence]),
  ],
  controllers: [RealtimeController],
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
