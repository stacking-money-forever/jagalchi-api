import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TicketAccount } from './entities/ticket-account.entity';
import { TicketLedger } from './entities/ticket-ledger.entity';
import { TicketPurchase } from './entities/ticket-purchase.entity';
import { ApplePurchaseVerifier } from './purchases/apple-purchase.verifier';
import { GooglePlayPurchaseVerifier } from './purchases/google-play-purchase.verifier';
import { PurchaseAccountBindingService } from './purchases/purchase-account-binding.service';
import { TicketPurchasesService } from './purchases/ticket-purchases.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    TypeOrmModule.forFeature([TicketAccount, TicketLedger, TicketPurchase]),
  ],
  controllers: [TicketsController],
  providers: [
    TicketsService,
    TicketPurchasesService,
    PurchaseAccountBindingService,
    ApplePurchaseVerifier,
    GooglePlayPurchaseVerifier,
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
