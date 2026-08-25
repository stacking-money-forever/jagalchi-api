import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import { TicketAccount } from '../entities/ticket-account.entity';
import { TicketLedger } from '../entities/ticket-ledger.entity';
import {
  TicketPurchase,
  TicketPurchaseStatus,
  TicketPurchaseStore,
} from '../entities/ticket-purchase.entity';
import { TicketPurchasesService } from './ticket-purchases.service';

const verified = {
  store: TicketPurchaseStore.Apple,
  providerTransactionId: 'transaction-1',
  providerTokenHash: 'a'.repeat(64),
  productId: 'com.jagalchi.app.ticket20',
  environment: 'Sandbox',
  purchasedAt: new Date('2026-01-01T00:00:00Z'),
};

function createHarness(existingOwner = 'user-1') {
  let purchase: TicketPurchase | null = null;
  const account = { userId: 'user-1', balance: 10 } as TicketAccount;
  const purchaseRepository = {
    findOne: vi.fn(async () => purchase),
    create: vi.fn((value: TicketPurchase) => value),
    save: vi.fn(async (value: TicketPurchase) => {
      purchase = Object.assign(new TicketPurchase(), value, {
        id: 'purchase-1',
        status: TicketPurchaseStatus.Fulfilled,
      });
      return purchase;
    }),
  };
  if (existingOwner !== 'user-1') {
    purchase = Object.assign(new TicketPurchase(), verified, {
      id: 'purchase-existing',
      userId: existingOwner,
      packId: 'ticket-20',
      tickets: 20,
      ledgerId: 'ledger-existing',
      status: TicketPurchaseStatus.Fulfilled,
    });
  }
  const accountRepository = {
    findOne: vi.fn(async () => account),
    save: vi.fn(async (value: TicketAccount) => value),
  };
  const ledgerRepository = {
    create: vi.fn((value: TicketLedger) => value),
    save: vi.fn(async (value: TicketLedger) =>
      Object.assign(new TicketLedger(), value, { id: 'ledger-1' }),
    ),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === TicketPurchase) return purchaseRepository;
      if (entity === TicketAccount) return accountRepository;
      return ledgerRepository;
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (callback: (manager: EntityManager) => unknown) =>
      callback(manager),
    ),
  } as unknown as DataSource;
  const apple = { verify: vi.fn(async () => verified) };
  const service = new TicketPurchasesService(
    dataSource,
    apple as never,
    { verify: vi.fn() } as never,
    { getContext: vi.fn() } as never,
  );
  return { service, account, purchaseRepository, ledgerRepository };
}

describe('TicketPurchasesService', () => {
  it('never starts a ledger transaction when provider verification fails', async () => {
    const dataSource = {
      transaction: vi.fn(),
    } as unknown as DataSource;
    const verifierError = new Error('invalid provider proof');
    const service = new TicketPurchasesService(
      dataSource,
      { verify: vi.fn(async () => Promise.reject(verifierError)) } as never,
      { verify: vi.fn() } as never,
      { getContext: vi.fn() } as never,
    );

    await expect(
      service.fulfill('user-1', {
        store: 'apple',
        signedTransactionInfo: 'x'.repeat(100),
      }),
    ).rejects.toBe(verifierError);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('credits one verified provider transaction exactly once', async () => {
    const { service, account, purchaseRepository, ledgerRepository } = createHarness();
    const proof = { store: 'apple' as const, signedTransactionInfo: 'x'.repeat(100) };

    const first = await service.fulfill('user-1', proof);
    const replay = await service.fulfill('user-1', proof);

    expect(first).toMatchObject({ status: 'fulfilled', tickets: 20, balance: 30 });
    expect(replay).toMatchObject({
      status: 'already-fulfilled',
      tickets: 20,
      balance: 30,
    });
    expect(account.balance).toBe(30);
    expect(purchaseRepository.save).toHaveBeenCalledOnce();
    expect(ledgerRepository.save).toHaveBeenCalledOnce();
  });

  it('rejects replaying another account purchase', async () => {
    const { service } = createHarness('user-2');
    await expect(
      service.fulfill('user-1', {
        store: 'apple',
        signedTransactionInfo: 'x'.repeat(100),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
