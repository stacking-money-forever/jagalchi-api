import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TicketAccount } from './entities/ticket-account.entity';
import {
  TicketLedger,
  TicketLedgerKind,
  TicketLedgerStatus,
} from './entities/ticket-ledger.entity';
import {
  AI_FEATURE_COSTS,
  type AiFeature,
  TICKET_MONTHLY_GRANT,
  TICKET_PACKS,
  TICKET_SIGNUP_GRANT,
} from './ticket-policy';

export interface TicketBalanceResult {
  balance: number;
  nextMonthlyGrantAt: Date;
  expiresAt: null;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TicketAccount)
    private readonly accounts: Repository<TicketAccount>,
    @InjectRepository(TicketLedger)
    private readonly ledger: Repository<TicketLedger>,
  ) {}

  async openAccount(userId: string): Promise<TicketBalanceResult> {
    await this.dataSource.transaction(async (manager) => {
      const accounts = manager.getRepository(TicketAccount);
      const existing = await accounts.findOne({ where: { userId } });
      if (existing) return;

      const now = new Date();
      await accounts.save(
        accounts.create({
          userId,
          balance: TICKET_SIGNUP_GRANT,
          lastMonthlyGrantAt: now,
        }),
      );
      await manager.getRepository(TicketLedger).save(
        manager.getRepository(TicketLedger).create({
          userId,
          amount: TICKET_SIGNUP_GRANT,
          kind: TicketLedgerKind.SignupGrant,
          status: TicketLedgerStatus.Committed,
          feature: null,
          idempotencyKey: `signup:${userId}`,
          description: '신규 가입 무료 티켓',
        }),
      );
    });
    return this.getBalance(userId);
  }

  async getBalance(userId: string): Promise<TicketBalanceResult> {
    await this.applyMonthlyGrantIfDue(userId);
    const account = await this.accounts.findOne({ where: { userId } });
    if (!account) throw new NotFoundException('Ticket account not found');

    return {
      balance: account.balance,
      nextMonthlyGrantAt: this.nextMonth(account.lastMonthlyGrantAt),
      expiresAt: null,
    };
  }

  async listLedger(userId: string): Promise<TicketLedger[]> {
    return this.ledger.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  getPacks(): typeof TICKET_PACKS {
    return TICKET_PACKS;
  }

  async reserveAiUsage(
    userId: string,
    feature: AiFeature,
    idempotencyKey: string,
  ): Promise<TicketLedger> {
    return this.dataSource.transaction(async (manager) => {
      const ledger = manager.getRepository(TicketLedger);
      const existing = await ledger.findOne({ where: { userId, idempotencyKey } });
      if (existing) {
        if (existing.feature !== feature) {
          throw new ConflictException('Idempotency key was used for another feature');
        }
        return existing;
      }

      const account = await manager.getRepository(TicketAccount).findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) throw new NotFoundException('Ticket account not found');

      const cost = AI_FEATURE_COSTS[feature];
      if (account.balance < cost) {
        throw new UnprocessableEntityException({
          code: 'INSUFFICIENT_TICKETS',
          required: cost,
          balance: account.balance,
        });
      }

      account.balance -= cost;
      await manager.getRepository(TicketAccount).save(account);

      return ledger.save(
        ledger.create({
          userId,
          amount: -cost,
          kind: TicketLedgerKind.AiUsage,
          status: TicketLedgerStatus.Reserved,
          feature,
          idempotencyKey,
          description: `AI ${feature} 사용 예약`,
        }),
      );
    });
  }

  async commitAiUsage(reservationId: string): Promise<TicketLedger> {
    return this.changeReservationStatus(reservationId, TicketLedgerStatus.Committed);
  }

  async refundAiUsage(reservationId: string): Promise<TicketLedger> {
    return this.dataSource.transaction(async (manager) => {
      const ledger = await manager.getRepository(TicketLedger).findOne({
        where: { id: reservationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ledger) throw new NotFoundException('Ticket reservation not found');
      if (ledger.status === TicketLedgerStatus.Refunded) return ledger;
      if (ledger.status !== TicketLedgerStatus.Reserved) {
        throw new ConflictException('Only reserved usage can be refunded');
      }

      const account = await manager.getRepository(TicketAccount).findOne({
        where: { userId: ledger.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) throw new NotFoundException('Ticket account not found');

      account.balance += Math.abs(ledger.amount);
      ledger.status = TicketLedgerStatus.Refunded;
      await manager.getRepository(TicketAccount).save(account);
      return manager.getRepository(TicketLedger).save(ledger);
    });
  }

  private async changeReservationStatus(
    reservationId: string,
    status: TicketLedgerStatus,
  ): Promise<TicketLedger> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TicketLedger);
      const ledger = await repository.findOne({
        where: { id: reservationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ledger) throw new NotFoundException('Ticket reservation not found');
      if (ledger.status === status) return ledger;
      if (ledger.status !== TicketLedgerStatus.Reserved) {
        throw new ConflictException('Ticket reservation is already finalized');
      }
      ledger.status = status;
      return repository.save(ledger);
    });
  }

  private async applyMonthlyGrantIfDue(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const accounts = manager.getRepository(TicketAccount);
      const account = await accounts.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account || !this.isEarlierMonth(account.lastMonthlyGrantAt, new Date())) return;

      const now = new Date();
      account.balance += TICKET_MONTHLY_GRANT;
      account.lastMonthlyGrantAt = now;
      await accounts.save(account);
      await manager.getRepository(TicketLedger).save(
        manager.getRepository(TicketLedger).create({
          userId,
          amount: TICKET_MONTHLY_GRANT,
          kind: TicketLedgerKind.MonthlyGrant,
          status: TicketLedgerStatus.Committed,
          feature: null,
          idempotencyKey: `monthly:${userId}:${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`,
          description: '월간 무료 티켓',
        }),
      );
    });
  }

  private isEarlierMonth(value: Date, now: Date): boolean {
    return (
      value.getUTCFullYear() < now.getUTCFullYear() ||
      (value.getUTCFullYear() === now.getUTCFullYear() &&
        value.getUTCMonth() < now.getUTCMonth())
    );
  }

  private nextMonth(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  }
}
