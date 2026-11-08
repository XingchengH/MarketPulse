import { Router, type Response } from 'express';
import type { PersonalWatchlistAsset, PersonalWatchlistMutationResult, PersonalWatchlistService } from '../monitoring/personal-watchlist-service.js';

export type PersonalWatchlistApi = Pick<PersonalWatchlistService, 'list' | 'add' | 'remove' | 'symbols' | 'has'>;
export type PersonalWatchlistScope = Pick<PersonalWatchlistService, 'symbols' | 'has'>;
export interface AssetLookup {
  lookupAsset(symbol: string): Promise<(PersonalWatchlistAsset & { tradable: boolean }) | null>;
}

// During runtime migration, an absent personal repository must never expose the
// legacy global watchlist. All reads remain scoped to an empty personal list.
export const emptyWatchlistScope: PersonalWatchlistScope = {
  symbols: async () => [],
  has: async () => false,
};

const responseFor = (response: Response, result: PersonalWatchlistMutationResult, successStatus = 200) => {
  if (result.status === 'updated') return response.status(successStatus).json({ watchlist: result.watchlist });
  const errors = {
    duplicate: [409, 'DUPLICATE_SYMBOL', 'Symbol is already on the watchlist'],
    not_found: [404, 'SYMBOL_NOT_FOUND', 'Symbol is not on the watchlist'],
    limit_reached: [409, 'WATCHLIST_LIMIT_REACHED', 'Watchlist limit of 25 symbols reached'],
  } as const;
  const [status, code, message] = errors[result.status];
  return response.status(status).json({ error: { code, message } });
};

export function createWatchlistRouter(service: Pick<PersonalWatchlistApi, 'list' | 'add' | 'remove'>, assets: AssetLookup): Router {
  const router = Router();
  router.get('/', async (_request, response) => response.json({ watchlist: await service.list(response.locals.user.sub) }));
  router.post('/', async (request, response) => {
    if (typeof request.body?.symbol !== 'string' || !request.body.symbol.trim()) return response.status(400).json({ error: { code: 'INVALID_SYMBOL', message: 'Symbol is required' } });
    const symbol = request.body.symbol.trim().toUpperCase();
    let asset: Awaited<ReturnType<AssetLookup['lookupAsset']>>;
    try { asset = await assets.lookupAsset(symbol); }
    catch { return response.status(503).json({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'Asset lookup is temporarily unavailable' } }); }
    if (!asset || !asset.tradable || asset.symbol !== symbol || asset.assetClass !== 'us_equity') return response.status(400).json({ error: { code: 'SYMBOL_NOT_TRADABLE', message: 'Symbol does not exist or is not tradable' } });
    const actorId: string = response.locals.user.sub;
    const metadata: PersonalWatchlistAsset = { symbol: asset.symbol, companyName: asset.companyName, ...(asset.exchange ? { exchange: asset.exchange } : {}), assetClass: asset.assetClass };
    return responseFor(response, await service.add(actorId, metadata, { actorId, requestId: response.locals.requestId }), 201);
  });
  router.delete('/:symbol', async (request, response) => {
    const actorId: string = response.locals.user.sub;
    const symbol = String(request.params.symbol).trim().toUpperCase();
    return responseFor(response, await service.remove(actorId, symbol, { actorId, requestId: response.locals.requestId }));
  });
  return router;
}
