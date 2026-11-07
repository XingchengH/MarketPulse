import { z } from 'zod';

export const watchlistLimit = 25;

const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]*$/);
const assetFields = {
  symbol: symbolSchema,
  companyName: z.string().min(1),
  exchange: z.string().min(1).optional(),
  assetClass: z.literal('us_equity'),
};

export const assetSearchResultSchema = z.object({
  ...assetFields,
  tradable: z.literal(true),
  inWatchlist: z.boolean(),
});

export const watchlistEntrySchema = z.object({
  ...assetFields,
  id: z.string(),
  createdAt: z.string().datetime(),
});

export const personalWatchlistSchema = z.object({
  entries: z.array(watchlistEntrySchema).max(watchlistLimit),
  used: z.number().int().min(0).max(watchlistLimit),
  limit: z.literal(watchlistLimit),
});

export const watchlistChangedEventSchema = z.object({
  symbols: z.array(symbolSchema).max(watchlistLimit),
  used: z.number().int().min(0).max(watchlistLimit),
  limit: z.literal(watchlistLimit),
  at: z.string().datetime(),
});

export type AssetSearchResult = z.infer<typeof assetSearchResultSchema>;
export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;
export type PersonalWatchlist = z.infer<typeof personalWatchlistSchema>;
export type WatchlistChangedEvent = z.infer<typeof watchlistChangedEventSchema>;
