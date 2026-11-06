import { Router } from 'express';
import type { CurrentRoleResolver } from '../auth/middleware.js';
import { requireRole } from '../auth/middleware.js';
import type { WatchlistResult, WatchlistService } from '../monitoring/watchlist-service.js';

const responseFor = (response: import('express').Response, result: WatchlistResult) => {
  if (result.status === 'updated') return response.json({ watchlist: result.watchlist });
  if (result.status === 'provider_unavailable') return response.status(503).json({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'Watchlist saved; provider subscription update failed' }, watchlist: result.watchlist });
  const errors = {
    duplicate: [409, 'DUPLICATE_SYMBOL', 'Symbol is already on the watchlist'],
    not_found: [404, 'SYMBOL_NOT_FOUND', 'Symbol is not on the watchlist'],
    not_tradable: [400, 'SYMBOL_NOT_TRADABLE', 'Symbol does not exist or is not tradable'],
    empty: [409, 'EMPTY_WATCHLIST', 'The watchlist must contain at least one symbol'],
  } as const;
  const [status, code, message] = errors[result.status];
  return response.status(status).json({ error: { code, message } });
};

export function createWatchlistRouter(service: WatchlistService, resolveRole: CurrentRoleResolver): Router {
  const router = Router();
  router.get('/', async (_request, response) => response.json({ watchlist: await service.list() }));
  router.post('/', requireRole('admin', resolveRole), async (request, response) => {
    if (typeof request.body?.symbol !== 'string' || !request.body.symbol.trim()) return response.status(400).json({ error: { code: 'INVALID_SYMBOL', message: 'Symbol is required' } });
    return responseFor(response, await service.add(request.body.symbol));
  });
  router.delete('/:symbol', requireRole('admin', resolveRole), async (request, response) => responseFor(response, await service.remove(String(request.params.symbol))));
  return router;
}
