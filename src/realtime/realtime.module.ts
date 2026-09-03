import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { RealtimeController, RealtimeTicketController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { RoadmapEvent, RoadmapSequence } from './roadmap-event.entity';
import { RealtimeService } from './realtime.service';
import { RealtimeConnectionTicket } from './realtime-ticket.entity';
import { RealtimeTicketService } from './realtime-ticket.service';

@Module({
  imports: [
    AuthModule,
    RoadmapsModule,
    TypeOrmModule.forFeature([RoadmapEvent, RoadmapSequence, RealtimeConnectionTicket]),
  ],
  controllers: [RealtimeController, RealtimeTicketController],
  providers: [RealtimeService, RealtimeTicketService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
