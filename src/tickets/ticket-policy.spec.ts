import { describe, expect, it } from 'vitest';
import {
  AI_FEATURE_COSTS,
  TICKET_MONTHLY_GRANT,
  TICKET_PACKS,
  TICKET_SIGNUP_GRANT,
  getTicketPackByProductId,
} from './ticket-policy';

describe('ticket policy', () => {
  it('keeps the free grant policy and exact paid packs stable', () => {
    expect(TICKET_SIGNUP_GRANT).toBe(30);
    expect(TICKET_MONTHLY_GRANT).toBe(15);
    expect(TICKET_PACKS).toEqual([
      {
        id: 'ticket-20',
        storeProductId: 'com.jagalchi.app.ticket20',
        tickets: 20,
        priceKrw: 3_900,
      },
      {
        id: 'ticket-60',
        storeProductId: 'com.jagalchi.app.ticket60',
        tickets: 60,
        priceKrw: 8_900,
      },
      {
        id: 'ticket-150',
        storeProductId: 'com.jagalchi.app.ticket150',
        tickets: 150,
        priceKrw: 17_900,
      },
    ]);
  });

  it('charges only the approved AI costs', () => {
    expect(AI_FEATURE_COSTS.coaching).toBe(1);
    expect(AI_FEATURE_COSTS.deep_search).toBe(2);
    expect(AI_FEATURE_COSTS.roadmap_generation).toBe(5);
  });

  it('maps only allowlisted store products to a server-owned ticket amount', () => {
    expect(getTicketPackByProductId('com.jagalchi.app.ticket60')).toMatchObject({
      id: 'ticket-60',
      tickets: 60,
    });
    expect(getTicketPackByProductId('com.attacker.ticket9999')).toBeNull();
  });
});
