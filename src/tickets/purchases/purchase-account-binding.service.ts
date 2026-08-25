import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

@Injectable()
export class PurchaseAccountBindingService {
  constructor(private readonly config: ConfigService) {}

  getContext(userId: string) {
    const digest = this.digest(userId);
    const uuidBytes = Buffer.from(digest.subarray(0, 16));
    uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x40;
    uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80;
    const hex = uuidBytes.toString('hex');
    return {
      appleAppAccountToken: [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join('-'),
      googleObfuscatedAccountId: digest.toString('hex'),
    };
  }

  private digest(userId: string): Buffer {
    const secret = this.config.get<string>('IAP_ACCOUNT_BINDING_SECRET');
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException('In-app purchase account binding is not configured');
    }
    return createHmac('sha256', secret).update(userId).digest();
  }
}
