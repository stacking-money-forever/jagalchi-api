export const TICKET_SIGNUP_GRANT = 30;
export const TICKET_MONTHLY_GRANT = 15;

export const AI_FEATURE_COSTS = {
  coaching: 1,
  node_explanation: 1,
  resource_recommendation: 1,
  deep_search: 2,
  feedback: 2,
  roadmap_generation: 5,
  document_conversion: 5,
} as const;

export type AiFeature = keyof typeof AI_FEATURE_COSTS;

export const TICKET_PACKS = [
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
] as const;

export type TicketPackId = (typeof TICKET_PACKS)[number]['id'];
export type StoreProductId = (typeof TICKET_PACKS)[number]['storeProductId'];

export function getTicketPackByProductId(productId: string) {
  return TICKET_PACKS.find((pack) => pack.storeProductId === productId) ?? null;
}
