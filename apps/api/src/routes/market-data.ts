import { Router } from 'express';
import { z } from 'zod';
import { emptyWatchlistScope, type PersonalWatchlistScope } from './watchlist.js';

const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]*$/);
const metricsQuerySchema = z.object({ symbol: symbolSchema, interval: z.literal('1m'), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() });

export interface MarketDataApi {
  overview(): Promise<{ provider?: string; providerState?: string; symbols?: string[] }>;
  symbols(): Promise<Array<{ symbol: string }>>;
  symbol(symbol: string): Promise<unknown | null>;
  metrics(query: { symbol: string; interval: '1m'; from: Date; to: Date }): Promise<unknown>;
}

const invalid = (response: Parameters<Parameters<Router['get']>[1]>[1], message: string) => response.status(400).json({ error: { code: 'INVALID_QUERY', message } });

export function createMarketDataRouter(api: MarketDataApi, watchlist: PersonalWatchlistScope = emptyWatchlistScope): Router {
  const router = Router();
  const missing = (response: import('express').Response) => response.status(404).json({ error: { code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found' } });
  router.get('/overview', async (_request, response) => {
    const symbols = new Set(await watchlist.symbols(response.locals.user.sub));
    const overview = await api.overview();
    return response.json({ ...overview, symbols: (overview.symbols ?? []).filter(symbol => symbols.has(symbol)) });
  });
  router.get('/symbols', async (_request, response) => {
    const symbols = new Set(await watchlist.symbols(response.locals.user.sub));
    return response.json({ symbols: (await api.symbols()).filter(item => symbols.has(item.symbol)) });
  });
  router.get('/symbols/:symbol', async (request, response) => {
    const parsed = symbolSchema.safeParse(request.params.symbol);
    if (!parsed.success) return invalid(response, 'Invalid symbol');
    if (!await watchlist.has(response.locals.user.sub, parsed.data)) return missing(response);
    const value = await api.symbol(parsed.data);
    return value === null ? missing(response) : response.json(value);
  });
  router.get('/metrics', async (request, response) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(response, 'symbol, from, to, and interval=1m are required and must be valid');
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.valueOf() - 60 * 60 * 1_000);
    if (to <= from || to.valueOf() - from.valueOf() > 7 * 24 * 60 * 60 * 1_000) return invalid(response, 'Metrics window must be positive and no longer than 7 days');
    if (!await watchlist.has(response.locals.user.sub, parsed.data.symbol)) return missing(response);
    return response.json({ metrics: await api.metrics({ symbol: parsed.data.symbol, interval: '1m', from, to }) });
  });
  return router;
}
