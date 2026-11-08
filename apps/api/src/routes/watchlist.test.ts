import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { personalWatchlistSchema, type PersonalWatchlist } from '@marketpulse/contracts';
import type { PersonalWatchlistAsset, PersonalWatchlistMutationContext, PersonalWatchlistMutationResult } from '../monitoring/personal-watchlist-service.js';
import { createWatchlistRouter } from './watchlist.js';

const setup = () => {
  const lists: Record<string, PersonalWatchlist> = {
    alice: { entries: [{ id: 'a', symbol: 'AAPL', companyName: 'Apple', assetClass: 'us_equity', createdAt: '2026-11-01T00:00:00.000Z' }], used: 1, limit: 25 },
    bob: { entries: [], used: 0, limit: 25 },
  };
  const service = {
    list: vi.fn(async (userId: string) => lists[userId]),
    add: vi.fn(async (userId: string, asset: PersonalWatchlistAsset, _audit: PersonalWatchlistMutationContext): Promise<PersonalWatchlistMutationResult> => {
      const list = lists[userId];
      if (list.entries.some(entry => entry.symbol === asset.symbol)) return { status: 'duplicate' };
      if (list.used >= 25) return { status: 'limit_reached' };
      list.entries.push({ ...asset, id: 'new', createdAt: '2026-11-07T00:00:00.000Z' });
      list.used++;
      return { status: 'updated', watchlist: list, unionChanged: true };
    }),
    remove: vi.fn(async (userId: string, symbol: string, _audit: PersonalWatchlistMutationContext): Promise<PersonalWatchlistMutationResult> => {
      const list = lists[userId];
      if (!list.entries.some(entry => entry.symbol === symbol)) return { status: 'not_found' };
      list.entries = list.entries.filter(entry => entry.symbol !== symbol);
      list.used--;
      return { status: 'updated', watchlist: list, unionChanged: true };
    }),
  };
  const assets = { lookupAsset: vi.fn(async (symbol: string) => symbol === 'BAD' ? null : ({ symbol, companyName: `${symbol} Inc`, exchange: 'NASDAQ', assetClass: 'us_equity' as const, tradable: symbol !== 'HALT' })) };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.locals.user = { sub: req.header('x-user') ?? 'alice', role: 'viewer' }; res.locals.requestId = 'request-1'; next(); });
  app.use('/watchlist', createWatchlistRouter(service, assets));
  return { app, service, assets, lists };
};

describe('personal watchlist routes', () => {
  it('allows viewers to list and mutate with audit identity from locals', async () => {
    const { app, service } = setup();
    const added = await request(app).post('/watchlist').send({ symbol: ' msft ', userId: 'bob', actorId: 'bob' }).expect(201);
    expect(added.body.watchlist).toMatchObject({ used: 2, limit: 25 });
    expect(personalWatchlistSchema.safeParse(added.body.watchlist).success).toBe(true);
    expect(service.add).toHaveBeenCalledWith('alice', { symbol: 'MSFT', companyName: 'MSFT Inc', exchange: 'NASDAQ', assetClass: 'us_equity' }, { actorId: 'alice', requestId: 'request-1' });
    await request(app).delete('/watchlist/msft').expect(200);
    expect(service.remove).toHaveBeenCalledWith('alice', 'MSFT', { actorId: 'alice', requestId: 'request-1' });
    await request(app).get('/watchlist?userId=bob').expect(200);
    expect(service.list).toHaveBeenCalledWith('alice');
  });

  it('isolates two users and allows the final symbol to be removed', async () => {
    const { app } = setup();
    expect((await request(app).get('/watchlist').set('x-user', 'bob').expect(200)).body.watchlist).toEqual({ entries: [], used: 0, limit: 25 });
    await request(app).delete('/watchlist/AAPL').set('x-user', 'bob').expect(404);
    await request(app).post('/watchlist').set('x-user', 'bob').send({ symbol: 'AAPL' }).expect(201);
    expect((await request(app).delete('/watchlist/AAPL').expect(200)).body.watchlist).toEqual({ entries: [], used: 0, limit: 25 });
    expect((await request(app).get('/watchlist').set('x-user', 'bob')).body.watchlist.used).toBe(1);
  });

  it('returns distinct duplicate, missing and capacity errors', async () => {
    const { app, lists } = setup();
    expect((await request(app).post('/watchlist').send({ symbol: 'AAPL' }).expect(409)).body.error.code).toBe('DUPLICATE_SYMBOL');
    expect((await request(app).delete('/watchlist/MSFT').expect(404)).body.error.code).toBe('SYMBOL_NOT_FOUND');
    lists.alice.used = 25;
    expect((await request(app).post('/watchlist').send({ symbol: 'MSFT' }).expect(409)).body).toEqual({ error: { code: 'WATCHLIST_LIMIT_REACHED', message: 'Watchlist limit of 25 symbols reached' } });
  });

  it('rejects blank symbols before lookup and missing/nontradable assets before mutation', async () => {
    const { app, assets, service } = setup();
    for (const symbol of ['', '  ', 42, undefined]) expect((await request(app).post('/watchlist').send({ symbol }).expect(400)).body.error.code).toBe('INVALID_SYMBOL');
    expect(assets.lookupAsset).not.toHaveBeenCalled();
    for (const symbol of ['bad', 'halt']) expect((await request(app).post('/watchlist').send({ symbol }).expect(400)).body.error.code).toBe('SYMBOL_NOT_TRADABLE');
    expect(service.add).not.toHaveBeenCalled();
  });

  it('requires exact symbol lookup and supports one-letter tickers', async () => {
    const { app, assets, service } = setup();
    assets.lookupAsset.mockResolvedValueOnce({ symbol: 'AAPL', companyName: 'Apple', exchange: 'NASDAQ', assetClass: 'us_equity', tradable: true });
    expect((await request(app).post('/watchlist').send({ symbol: 'AA' }).expect(400)).body.error.code).toBe('SYMBOL_NOT_TRADABLE');
    expect(service.add).not.toHaveBeenCalled();
    await request(app).post('/watchlist').send({ symbol: 'f' }).expect(201);
    expect(assets.lookupAsset).toHaveBeenLastCalledWith('F');
  });

  it('sanitizes provider failure and performs no mutation', async () => {
    const { app, assets, service } = setup();
    assets.lookupAsset.mockRejectedValueOnce(new Error('secret provider credentials'));
    expect((await request(app).post('/watchlist').send({ symbol: 'MSFT' }).expect(503)).body).toEqual({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'Asset lookup is temporarily unavailable' } });
    expect(service.add).not.toHaveBeenCalled();
  });
});
