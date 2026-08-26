import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubModule } from '../github/github.module';
import { CareerController } from './career.controller';
import {
  CareerEvidence,
  CareerTarget,
  CommandIdempotencyKey,
  ProofCriterion,
  ProofMission,
  ProofProfile,
  ProofReview,
  ProofVerificationRun,
  PublishedProof,
} from './career.entities';
import { CareerService } from './career.service';

@Module({
  imports: [
    GithubModule,
    TypeOrmModule.forFeature([
      CareerTarget,
      CareerEvidence,
      ProofMission,
      ProofCriterion,
      ProofVerificationRun,
      ProofReview,
      ProofProfile,
      PublishedProof,
      CommandIdempotencyKey,
    ]),
  ],
  controllers: [CareerController],
  providers: [CareerService],
  exports: [CareerService],
})
export class CareerModule {}
