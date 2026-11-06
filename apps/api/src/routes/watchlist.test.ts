import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { WatchlistService, type WatchlistItem } from '../monitoring/watchlist-service.js';
import { createWatchlistRouter } from './watchlist.js';

const setup = (role: 'viewer' | 'admin' = 'admin', replaceSubscriptions = vi.fn(async () => undefined)) => {
  let items: WatchlistItem[] = [{ id: '1', symbol: 'AAPL', enabled: true }];
  const repository = { list: vi.fn(async () => items), mutate: vi.fn(async (mutation: { type: 'add' | 'remove'; symbol: string; audit: { actorId: string; requestId: string } }) => { const before = items.map(item => item.symbol); if (mutation.type === 'add' && before.includes(mutation.symbol)) return { status: 'duplicate' as const }; if (mutation.type === 'remove' && !before.includes(mutation.symbol)) return { status: 'not_found' as const }; if (mutation.type === 'remove' && before.length === 1) return { status: 'empty' as const }; const symbols = mutation.type === 'add' ? [...before, mutation.symbol].sort() : before.filter(symbol => symbol !== mutation.symbol); items = symbols.map((symbol, index) => ({ id: String(index), symbol, enabled: true })); return { status: 'updated' as const, before, watchlist: items }; }) };
  const provider = { lookupAsset: vi.fn(async (symbol: string) => symbol === 'BAD' ? null : ({ symbol, tradable: symbol !== 'HALT' })), replaceSubscriptions };
  const service = new WatchlistService(repository, provider);
  const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.user = { sub: 'actor', role }; res.locals.requestId = 'request-1'; next(); }); app.use('/watchlist', createWatchlistRouter(service, async () => role));
  return { app, repository, provider };
};

describe('watchlist administration', () => {
  it('returns 201 and supplies required audit identity when adding', async () => { const { app, repository, provider } = setup(); await request(app).post('/watchlist').send({ symbol: ' msft ' }).expect(201); expect(repository.mutate).toHaveBeenCalledWith({ type: 'add', symbol: 'MSFT', audit: { actorId: 'actor', requestId: 'request-1' } }); expect(provider.replaceSubscriptions).toHaveBeenCalledWith(['AAPL', 'MSFT']); await request(app).post('/watchlist').send({ symbol: 'bad' }).expect(400); });
  it('rejects duplicates and non-tradable assets', async () => { const { app } = setup(); await request(app).post('/watchlist').send({ symbol: 'aapl' }).expect(409); await request(app).post('/watchlist').send({ symbol: 'halt' }).expect(400); });
  it('supplies required audit identity when removing', async () => { const { app, repository } = setup(); await request(app).post('/watchlist').send({ symbol: 'MSFT' }).expect(201); await request(app).delete('/watchlist/MSFT').expect(200); expect(repository.mutate).toHaveBeenLastCalledWith({ type: 'remove', symbol: 'MSFT', audit: { actorId: 'actor', requestId: 'request-1' } }); });
  it('persists desired state and returns 503 when provider replacement fails', async () => { const replacement = vi.fn(async () => { throw new Error('offline'); }); const { app, repository } = setup('admin', replacement); const response = await request(app).post('/watchlist').send({ symbol: 'MSFT' }).expect(503); expect(response.body.watchlist.map((item: WatchlistItem) => item.symbol)).toEqual(['AAPL', 'MSFT']); expect(repository.mutate).toHaveBeenCalled(); });
  it('requires current admin role for mutations and prevents an empty watchlist', async () => { await request(setup('viewer').app).post('/watchlist').send({ symbol: 'MSFT' }).expect(403); await request(setup().app).delete('/watchlist/AAPL').expect(409); });
  it('does not replace provider subscriptions when the atomic persistence/audit transaction fails', async () => { const provider = { lookupAsset: vi.fn(async (symbol: string) => ({ symbol, tradable: true })), replaceSubscriptions: vi.fn(async () => undefined) }; const repository = { list: vi.fn(async () => [{ id: '1', symbol: 'AAPL', enabled: true }]), mutate: vi.fn(async () => { throw new Error('audit insert failed'); }) }; const service = new WatchlistService(repository, provider); await expect(service.add('MSFT', { actorId: 'actor', requestId: 'request-1' })).rejects.toThrow('audit insert failed'); expect(provider.replaceSubscriptions).not.toHaveBeenCalled(); });
});
