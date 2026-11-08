import { Router } from 'express';
import { z } from 'zod';
import type { AssetDirectory } from '../market-data/asset-directory.js';
import type { PersonalWatchlistScope } from './watchlist.js';

const querySchema = z.string().trim().min(2).max(80);

export function createAssetsRouter(directory: Pick<AssetDirectory, 'search'>, watchlist: Pick<PersonalWatchlistScope, 'symbols'>): Router {
  const router = Router();
  router.get('/search', async (request, response) => {
    const parsed = querySchema.safeParse(request.query.q);
    if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'q must be a string between 2 and 80 characters' } });
    let assets: Awaited<ReturnType<AssetDirectory['search']>>;
    try { assets = await directory.search(parsed.data); }
    catch { return response.status(503).json({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'Asset search is temporarily unavailable' } }); }
    const symbols = new Set(await watchlist.symbols(response.locals.user.sub));
    return response.json({ results: assets.slice(0, 10).map(asset => ({ ...asset, inWatchlist: symbols.has(asset.symbol) })) });
  });
  return router;
}
