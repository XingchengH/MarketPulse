import { z } from 'zod';

export const marketEventTypeSchema = z.enum(['trade', 'quote']);
export const providerStateSchema = z.enum([
  'unconfigured',
  'connecting',
  'connected',
  'reconnecting',
  'market_closed',
  'rate_limited',
  'unavailable',
]);

const normalizedEventSchema = z.object({
  provider: z.string().min(1),
  feed: z.string().min(1),
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]*$/, 'Symbol must be uppercase'),
  providerTimestamp: z.string().datetime({ offset: false }),
  receivedAt: z.string().datetime({ offset: false }),
});

const tradeEventSchema = normalizedEventSchema.extend({
  type: z.literal('trade'),
  price: z.number().finite().positive(),
  size: z.number().finite().positive(),
});

const quoteEventSchema = normalizedEventSchema.extend({
  type: z.literal('quote'),
  bid: z.number().finite().positive(),
  ask: z.number().finite().positive(),
  bidSize: z.number().finite().positive().optional(),
  askSize: z.number().finite().positive().optional(),
});

export const marketEventSchema = z.discriminatedUnion('type', [
  tradeEventSchema,
  quoteEventSchema,
]);

export type MarketEventType = z.infer<typeof marketEventTypeSchema>;
export type ProviderState = z.infer<typeof providerStateSchema>;
export type MarketEvent = z.infer<typeof marketEventSchema>;
