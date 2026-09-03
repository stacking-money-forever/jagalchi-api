import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  NodeProgress,
  Roadmap,
  RoadmapDirectory,
  RoadmapReaction,
} from './entities/roadmap.entities';
import {
  DirectoriesController,
  RoadmapsController,
} from './roadmaps.controller';
import { RoadmapsService } from './roadmaps.service';
import { ProjectRun } from '../project-runs/project-run.entity';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Roadmap,
      RoadmapDirectory,
      NodeProgress,
      RoadmapReaction,
      ProjectRun,
    ]),
  ],
  controllers: [RoadmapsController, DirectoriesController],
  providers: [RoadmapsService],
  exports: [RoadmapsService, TypeOrmModule],
})
export class RoadmapsModule {}
