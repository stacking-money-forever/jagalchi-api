import type { TicketPurchaseStore } from '../entities/ticket-purchase.entity';

export interface VerifiedTicketPurchase {
  store: TicketPurchaseStore;
  providerTransactionId: string;
  providerTokenHash: string;
  productId: string;
  environment: string;
  purchasedAt: Date;
}

export interface PurchaseVerifier {
  verify(proof: string, expectedUserId: string): Promise<VerifiedTicketPurchase>;
}
