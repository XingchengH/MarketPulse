import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

const setup = () => {
  const asset = { symbol: 'AAPL', companyName: 'Apple', exchange: 'NASDAQ', assetClass: 'us_equity' as const, tradable: true };
  const directory = { search: vi.fn(async (_q: string) => [asset]) };
  const watchlist = { symbols: vi.fn(async (userId: string) => userId === 'alice' ? ['AAPL'] : []), has: vi.fn(), list: vi.fn(async (_userId: string) => ({ entries: [], used: 0, limit: 25 as const })), add: vi.fn(), remove: vi.fn() };
  const app = createApp({
    config: { nodeEnv: 'test', port: 4000, webOrigin: 'http://localhost:5173', mongodbUri: 'mongodb://x', google: { clientId: '', clientSecret: '', redirectUri: '' }, alpaca: { apiKey: '', apiSecret: '' }, accessTokenSecret: 'a', refreshTokenPepper: 'b' },
    database: { isReady: async () => true },
    auth: { provider: {} as never, repository: {} as never, tokens: {
      issueAccessToken: async () => '', issueRefreshToken: async () => ({ token: '', expiresAt: new Date() }),
      verifyAccessToken: async (sub: string) => ({ sub, role: 'viewer' as const }), verifyRefreshToken: async () => ({ sub: 'alice', role: 'viewer' as const }),
    } },
    assetDirectory: directory, monitoring: { watchlist },
  });
  return { app, directory, watchlist, asset };
};

describe('asset search', () => {
  it('requires authentication at the app boundary', async () => {
    const { app, directory } = setup();
    await request(app).get('/api/assets/search?q=AA').expect(401);
    expect(directory.search).not.toHaveBeenCalled();
  });

  it('also authenticates all personal watchlist methods at the app boundary', async () => {
    const { app, watchlist } = setup();
    await request(app).get('/api/watchlist').expect(401);
    await request(app).post('/api/watchlist').send({ symbol: 'MSFT' }).expect(401);
    await request(app).delete('/api/watchlist/AAPL').expect(401);
    expect(watchlist.list).not.toHaveBeenCalled();
    expect(watchlist.add).not.toHaveBeenCalled();
    expect(watchlist.remove).not.toHaveBeenCalled();
    await request(app).get('/api/watchlist?userId=bob').set('Cookie', 'access_token=alice').expect(200);
    expect(watchlist.list).toHaveBeenCalledWith('alice');
  });

  it('trims query and derives membership solely from the authenticated user', async () => {
    const { app, directory, watchlist, asset } = setup();
    expect((await request(app).get('/api/assets/search?q=%20Apple%20&userId=bob').set('Cookie', 'access_token=alice').expect(200)).body).toEqual({ results: [{ ...asset, inWatchlist: true }] });
    expect(directory.search).toHaveBeenCalledWith('Apple');
    expect(watchlist.symbols).toHaveBeenCalledWith('alice');
    expect((await request(app).get('/api/assets/search?q=AA&userId=alice').set('Cookie', 'access_token=bob').expect(200)).body.results[0].inWatchlist).toBe(false);
  });

  it('limits results to ten', async () => {
    const { app, directory, asset } = setup();
    directory.search.mockResolvedValueOnce(Array.from({ length: 12 }, (_, index) => ({ ...asset, symbol: `AA${index}` })));
    expect((await request(app).get('/api/assets/search?q=AA').set('Cookie', 'access_token=alice').expect(200)).body.results).toHaveLength(10);
  });

  it('validates string queries with trimmed length 2 through 80', async () => {
    const { app, directory } = setup();
    for (const query of ['', '?q=A', '?q=%20%20', `?q=${'A'.repeat(81)}`, '?q=AA&q=BB']) expect((await request(app).get(`/api/assets/search${query}`).set('Cookie', 'access_token=alice').expect(400)).body.error.code).toBe('INVALID_QUERY');
    expect(directory.search).not.toHaveBeenCalled();
    await request(app).get(`/api/assets/search?q=${'A'.repeat(80)}`).set('Cookie', 'access_token=alice').expect(200);
  });

  it('sanitizes provider and cache failures', async () => {
    const { app, directory } = setup();
    directory.search.mockRejectedValueOnce(new Error('secret upstream response'));
    expect((await request(app).get('/api/assets/search?q=AA').set('Cookie', 'access_token=alice').expect(503)).body).toEqual({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'Asset search is temporarily unavailable' } });
  });
});
