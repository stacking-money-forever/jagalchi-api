import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { PurchaseAccountBindingService } from './purchase-account-binding.service';

describe('PurchaseAccountBindingService', () => {
  it('derives deterministic provider-safe account bindings without exposing user id', () => {
    const service = new PurchaseAccountBindingService({
      get: () => 'dedicated-secret-with-more-than-32-characters',
    } as never);

    const first = service.getContext('10cd52c9-3ea5-4cd6-b49a-fb29fd510001');
    const replay = service.getContext('10cd52c9-3ea5-4cd6-b49a-fb29fd510001');
    const other = service.getContext('10cd52c9-3ea5-4cd6-b49a-fb29fd510002');

    expect(first).toEqual(replay);
    expect(first).not.toEqual(other);
    expect(first.appleAppAccountToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.googleObfuscatedAccountId).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain('10cd52c9');
  });

  it('fails closed when the dedicated secret is unavailable', () => {
    const service = new PurchaseAccountBindingService({ get: () => undefined } as never);
    expect(() => service.getContext('user-1')).toThrow(ServiceUnavailableException);
  });
});
