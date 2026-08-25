import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { TicketPurchaseStore } from '../entities/ticket-purchase.entity';
import { getTicketPackByProductId } from '../ticket-policy';
import { PurchaseAccountBindingService } from './purchase-account-binding.service';
import type {
  PurchaseVerifier,
  VerifiedTicketPurchase,
} from './purchase-verifier.types';

interface ProductLineItem {
  productId?: unknown;
  productOfferDetails?: {
    quantity?: unknown;
    refundableQuantity?: unknown;
    consumptionState?: unknown;
  };
}

interface GoogleProductPurchase {
  purchaseStateContext?: { purchaseState?: unknown };
  productLineItem?: ProductLineItem[];
  obfuscatedExternalAccountId?: unknown;
  purchaseCompletionTime?: unknown;
  testPurchaseContext?: unknown;
}

@Injectable()
export class GooglePlayPurchaseVerifier implements PurchaseVerifier {
  constructor(
    private readonly config: ConfigService,
    private readonly bindings: PurchaseAccountBindingService,
  ) {}

  async verify(
    purchaseToken: string,
    expectedUserId: string,
  ): Promise<VerifiedTicketPurchase> {
    const rawCredentials = this.config.get<string>('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
    if (!rawCredentials) {
      throw new ServiceUnavailableException('Google Play verification is not configured');
    }
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(rawCredentials) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException('Google Play credentials are invalid');
    }
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const client = await auth.getClient();
    const headers = await client.getRequestHeaders();
    const packageName =
      this.config.get<string>('GOOGLE_PLAY_PACKAGE_NAME') ?? 'com.jagalchi.app';
    const url = new URL(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/productsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    );
    const response = await fetch(url, {
      headers: { authorization: headers.get('authorization') ?? '' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new UnprocessableEntityException('Google Play purchase could not be verified');
    }
    const purchase = (await response.json()) as GoogleProductPurchase;
    const lines = Array.isArray(purchase.productLineItem)
      ? purchase.productLineItem
      : [];
    const line = lines[0];
    const productId = typeof line?.productId === 'string' ? line.productId : null;
    const quantityValue = line?.productOfferDetails?.quantity;
    const quantity =
      quantityValue === undefined ? 1 : Number.parseInt(String(quantityValue), 10);
    const refundableQuantity = Number.parseInt(
      String(line?.productOfferDetails?.refundableQuantity ?? '0'),
      10,
    );
    const expectedBinding =
      this.bindings.getContext(expectedUserId).googleObfuscatedAccountId;
    if (
      purchase.purchaseStateContext?.purchaseState !== 'PURCHASED' ||
      lines.length !== 1 ||
      !productId ||
      !getTicketPackByProductId(productId) ||
      quantity !== 1 ||
      refundableQuantity !== 1 ||
      line?.productOfferDetails?.consumptionState !==
        'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' ||
      purchase.obfuscatedExternalAccountId !== expectedBinding
    ) {
      throw new UnprocessableEntityException('Google Play purchase could not be verified');
    }
    const purchasedAt =
      typeof purchase.purchaseCompletionTime === 'string'
        ? new Date(purchase.purchaseCompletionTime)
        : new Date();
    if (Number.isNaN(purchasedAt.getTime())) {
      throw new UnprocessableEntityException('Google Play purchase date is invalid');
    }
    const tokenHash = createHash('sha256').update(purchaseToken).digest('hex');
    return {
      store: TicketPurchaseStore.Google,
      providerTransactionId: tokenHash,
      providerTokenHash: tokenHash,
      productId,
      environment: purchase.testPurchaseContext ? 'Sandbox' : 'Production',
      purchasedAt,
    };
  }
}
