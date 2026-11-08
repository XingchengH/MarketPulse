import { z } from 'zod';
import { providerStateSchema } from './market.js';
import { watchlistChangedEventSchema } from './watchlist.js';

const symbolSnapshotSchema = z.object({ symbol: z.string().min(1) }).passthrough();
export const overviewSnapshotEventSchema = z.object({
  provider: z.string().min(1),
  providerState: providerStateSchema,
  symbols: z.array(z.string().min(1)).max(500),
});
export const symbolsSnapshotEventSchema = z.array(symbolSnapshotSchema).max(500);
export const providerStateEventSchema = z.object({ state: providerStateSchema, at: z.string().datetime() });
export const changedEventSchema = z.object({ at: z.string().datetime() });

export interface RealtimeServerEvents {
  'overview:snapshot': (value: z.infer<typeof overviewSnapshotEventSchema>) => void;
  'symbols:snapshot': (value: z.infer<typeof symbolsSnapshotEventSchema>) => void;
  'provider:state': (value: z.infer<typeof providerStateEventSchema>) => void;
  'alerts:changed': (value: z.infer<typeof changedEventSchema>) => void;
  'rules:changed': (value: z.infer<typeof changedEventSchema>) => void;
  'watchlist:changed': (value: z.infer<typeof watchlistChangedEventSchema>) => void;
}

export type OverviewSnapshotEvent = z.infer<typeof overviewSnapshotEventSchema>;
export type SymbolsSnapshotEvent = z.infer<typeof symbolsSnapshotEventSchema>;
