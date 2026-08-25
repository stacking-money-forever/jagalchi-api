import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReserveAiTicketsDto } from './dto/reserve-ai-tickets.dto';
import { TicketsService } from './tickets.service';
import { FulfillTicketPurchaseDto } from './dto/fulfill-ticket-purchase.dto';
import { TicketPurchasesService } from './purchases/ticket-purchases.service';

@ApiTags('tickets')
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly purchases: TicketPurchasesService,
  ) {}

  @Post('account')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  openAccount(@CurrentUser() user: AuthUser) {
    return this.tickets.openAccount(user.id);
  }

  @Get('balance')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getBalance(@CurrentUser() user: AuthUser) {
    return this.tickets.getBalance(user.id);
  }

  @Get('ledger')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getLedger(@CurrentUser() user: AuthUser) {
    return this.tickets.listLedger(user.id);
  }

  @Get('packs')
  getPacks() {
    return this.tickets.getPacks();
  }

  @Get('purchases/context')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getPurchaseContext(@CurrentUser() user: AuthUser) {
    return this.purchases.getContext(user.id);
  }

  @Post('purchases/fulfill')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  fulfillPurchase(
    @CurrentUser() user: AuthUser,
    @Body() dto: FulfillTicketPurchaseDto,
  ) {
    return this.purchases.fulfill(user.id, dto);
  }

  @Post('ai/reservations')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  reserveAiTickets(@CurrentUser() user: AuthUser, @Body() dto: ReserveAiTicketsDto) {
    return this.tickets.reserveAiUsage(user.id, dto.feature, dto.idempotencyKey);
  }
}
