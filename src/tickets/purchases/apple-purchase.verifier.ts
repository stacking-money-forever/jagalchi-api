import {
  Environment,
  InAppOwnershipType,
  SignedDataVerifier,
  Type,
} from '@apple/app-store-server-library';
import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TicketPurchaseStore } from '../entities/ticket-purchase.entity';
import { getTicketPackByProductId } from '../ticket-policy';
import { PurchaseAccountBindingService } from './purchase-account-binding.service';
import type {
  PurchaseVerifier,
  VerifiedTicketPurchase,
} from './purchase-verifier.types';

@Injectable()
export class ApplePurchaseVerifier implements PurchaseVerifier {
  constructor(
    private readonly config: ConfigService,
    private readonly bindings: PurchaseAccountBindingService,
  ) {}

  async verify(
    signedTransactionInfo: string,
    expectedUserId: string,
  ): Promise<VerifiedTicketPurchase> {
    const rootPaths = (this.config.get<string>('APPLE_IAP_ROOT_CA_PATHS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const inlineRoots = (
      this.config.get<string>('APPLE_IAP_ROOT_CA_BASE64') ?? ''
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Buffer.from(value, 'base64'))
      .filter((value) => value.length > 0);
    const appAppleId = Number(this.config.get<string>('APPLE_APP_ID'));
    if ((!rootPaths.length && !inlineRoots.length) || !Number.isSafeInteger(appAppleId)) {
      throw new ServiceUnavailableException('Apple purchase verification is not configured');
    }
    const roots = [
      ...inlineRoots,
      ...(await Promise.all(rootPaths.map((path) => readFile(path)))),
    ];
    const bundleId = this.config.get<string>('APPLE_IAP_BUNDLE_ID') ?? 'com.jagalchi.app';
    const verifiers = [
      new SignedDataVerifier(
        roots,
        true,
        Environment.PRODUCTION,
        bundleId,
        appAppleId,
      ),
      new SignedDataVerifier(roots, true, Environment.SANDBOX, bundleId),
    ];
    let transaction: Awaited<
      ReturnType<SignedDataVerifier['verifyAndDecodeTransaction']>
    > | null = null;
    for (const verifier of verifiers) {
      try {
        transaction = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
        break;
      } catch {
        // App Review and sandbox transactions are verified only by the sandbox verifier.
      }
    }
    const expectedBinding = this.bindings.getContext(expectedUserId).appleAppAccountToken;
    if (
      !transaction?.transactionId ||
      !transaction.productId ||
      !getTicketPackByProductId(transaction.productId) ||
      transaction.type !== Type.CONSUMABLE ||
      transaction.quantity !== 1 ||
      transaction.inAppOwnershipType !== InAppOwnershipType.PURCHASED ||
      transaction.revocationDate !== undefined ||
      transaction.appAccountToken?.toLowerCase() !== expectedBinding.toLowerCase() ||
      typeof transaction.purchaseDate !== 'number'
    ) {
      throw new UnprocessableEntityException('Apple purchase could not be verified');
    }
    return {
      store: TicketPurchaseStore.Apple,
      providerTransactionId: transaction.transactionId,
      providerTokenHash: createHash('sha256')
        .update(signedTransactionInfo)
        .digest('hex'),
      productId: transaction.productId,
      environment: String(transaction.environment ?? 'Unknown'),
      purchasedAt: new Date(transaction.purchaseDate),
    };
  }
}
