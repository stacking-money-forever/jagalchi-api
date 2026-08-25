import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FulfillTicketPurchaseDto } from '../dto/fulfill-ticket-purchase.dto';
import { TicketAccount } from '../entities/ticket-account.entity';
import {
  TicketLedger,
  TicketLedgerKind,
  TicketLedgerStatus,
} from '../entities/ticket-ledger.entity';
import {
  TicketPurchase,
  TicketPurchaseStatus,
} from '../entities/ticket-purchase.entity';
import { getTicketPackByProductId } from '../ticket-policy';
import { ApplePurchaseVerifier } from './apple-purchase.verifier';
import { GooglePlayPurchaseVerifier } from './google-play-purchase.verifier';
import { PurchaseAccountBindingService } from './purchase-account-binding.service';
import type { VerifiedTicketPurchase } from './purchase-verifier.types';

export interface TicketPurchaseResult {
  status: 'fulfilled' | 'already-fulfilled';
  purchaseId: string;
  productId: string;
  tickets: number;
  balance: number;
}

@Injectable()
export class TicketPurchasesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly apple: ApplePurchaseVerifier,
    private readonly google: GooglePlayPurchaseVerifier,
    private readonly bindings: PurchaseAccountBindingService,
  ) {}

  getContext(userId: string) {
    return this.bindings.getContext(userId);
  }

  async fulfill(
    userId: string,
    dto: FulfillTicketPurchaseDto,
  ): Promise<TicketPurchaseResult> {
    const verified = await this.verify(userId, dto);
    const pack = getTicketPackByProductId(verified.productId);
    if (!pack) throw new UnprocessableEntityException('Store product is not approved');

    try {
      return await this.dataSource.transaction(async (manager) => {
        const purchases = manager.getRepository(TicketPurchase);
        const existing = await purchases.findOne({
          where: {
            store: verified.store,
            providerTransactionId: verified.providerTransactionId,
          },
        });
        if (existing) return this.existingResult(userId, existing, manager);

        const accounts = manager.getRepository(TicketAccount);
        const account = await accounts.findOne({
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Ticket account not found');
        account.balance += pack.tickets;
        await accounts.save(account);

        const ledger = await manager.getRepository(TicketLedger).save(
          manager.getRepository(TicketLedger).create({
            userId,
            amount: pack.tickets,
            kind: TicketLedgerKind.Purchase,
            status: TicketLedgerStatus.Committed,
            feature: null,
            idempotencyKey: `purchase:${verified.store}:${verified.providerTransactionId}`,
            description: `${pack.id} 스토어 구매`,
          }),
        );
        const purchase = await purchases.save(
          purchases.create({
            userId,
            store: verified.store,
            providerTransactionId: verified.providerTransactionId,
            providerTokenHash: verified.providerTokenHash,
            productId: verified.productId,
            packId: pack.id,
            tickets: pack.tickets,
            environment: verified.environment,
            status: TicketPurchaseStatus.Fulfilled,
            ledgerId: ledger.id,
            purchasedAt: verified.purchasedAt,
          }),
        );
        return {
          status: 'fulfilled' as const,
          purchaseId: purchase.id,
          productId: purchase.productId,
          tickets: purchase.tickets,
          balance: account.balance,
        };
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const existing = await this.dataSource.getRepository(TicketPurchase).findOne({
        where: {
          store: verified.store,
          providerTransactionId: verified.providerTransactionId,
        },
      });
      if (!existing || existing.userId !== userId) {
        throw new ConflictException('Purchase belongs to another account');
      }
      const account = await this.dataSource.getRepository(TicketAccount).findOne({
        where: { userId },
      });
      if (!account) throw new NotFoundException('Ticket account not found');
      return {
        status: 'already-fulfilled',
        purchaseId: existing.id,
        productId: existing.productId,
        tickets: existing.tickets,
        balance: account.balance,
      };
    }
  }

  private verify(
    userId: string,
    dto: FulfillTicketPurchaseDto,
  ): Promise<VerifiedTicketPurchase> {
    if (dto.store === 'apple' && dto.signedTransactionInfo) {
      return this.apple.verify(dto.signedTransactionInfo, userId);
    }
    if (dto.store === 'google' && dto.purchaseToken) {
      return this.google.verify(dto.purchaseToken, userId);
    }
    throw new UnprocessableEntityException('Purchase proof is incomplete');
  }

  private async existingResult(
    userId: string,
    purchase: TicketPurchase,
    manager: EntityManager,
  ): Promise<TicketPurchaseResult> {
    if (purchase.userId !== userId) {
      throw new ConflictException('Purchase belongs to another account');
    }
    const account = await manager.getRepository(TicketAccount).findOne({
      where: { userId },
    });
    if (!account) throw new NotFoundException('Ticket account not found');
    return {
      status: 'already-fulfilled',
      purchaseId: purchase.id,
      productId: purchase.productId,
      tickets: purchase.tickets,
      balance: account.balance,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }
}
