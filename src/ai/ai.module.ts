import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AiController } from './ai.controller';
import { AiJobsService } from './ai-jobs.service';
import { AiTokenService } from './ai-token.service';

@Module({
  imports: [AuthModule, JwtModule.register({}), TicketsModule],
  controllers: [AiController],
  providers: [AiJobsService, AiTokenService],
})
export class AiModule {}
