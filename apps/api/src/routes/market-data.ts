import { Router } from 'express';
import { z } from 'zod';

const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]*$/);
const metricsQuerySchema = z.object({ symbol: symbolSchema, interval: z.literal('1m'), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() });

export interface MarketDataApi {
  overview(): Promise<unknown>;
  symbols(): Promise<unknown>;
  symbol(symbol: string): Promise<unknown | null>;
  metrics(query: { symbol: string; interval: '1m'; from: Date; to: Date }): Promise<unknown>;
}

const invalid = (response: Parameters<Parameters<Router['get']>[1]>[1], message: string) => response.status(400).json({ error: { code: 'INVALID_QUERY', message } });

export function createMarketDataRouter(api: MarketDataApi): Router {
  const router = Router();
  router.get('/overview', async (_request, response) => response.json(await api.overview()));
  router.get('/symbols', async (_request, response) => response.json({ symbols: await api.symbols() }));
  router.get('/symbols/:symbol', async (request, response) => {
    const parsed = symbolSchema.safeParse(request.params.symbol);
    if (!parsed.success) return invalid(response, 'Invalid symbol');
    const value = await api.symbol(parsed.data);
    return value === null ? response.status(404).json({ error: { code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found' } }) : response.json(value);
  });
  router.get('/metrics', async (request, response) => {
    const parsed = metricsQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(response, 'symbol, from, to, and interval=1m are required and must be valid');
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.valueOf() - 60 * 60 * 1_000);
    if (to <= from || to.valueOf() - from.valueOf() > 7 * 24 * 60 * 60 * 1_000) return invalid(response, 'Metrics window must be positive and no longer than 7 days');
    return response.json({ metrics: await api.metrics({ symbol: parsed.data.symbol, interval: '1m', from, to }) });
  });
  return router;
}
