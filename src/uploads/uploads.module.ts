import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { UploadAsset } from './upload-asset.entity';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuthModule, RoadmapsModule, TypeOrmModule.forFeature([UploadAsset])],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
