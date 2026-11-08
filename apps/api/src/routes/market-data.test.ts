import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

const setup = (withScope = true) => {
  const data = {
    overview: vi.fn(async () => ({ provider: 'alpaca', providerState: 'unconfigured', symbols: ['AAPL', 'MSFT'] })),
    symbols: vi.fn(async () => [{ symbol: 'AAPL', spread: 1 }, { symbol: 'MSFT', spread: 2 }]),
    symbol: vi.fn(async (symbol: string) => ({ symbol, spread: 1 })),
    metrics: vi.fn(async (_query: { symbol: string; interval: '1m'; from: Date; to: Date }) => [{ symbol: 'AAPL', bucketStart: '2026-11-05T17:00:00.000Z', messageCount: 2 }]),
  };
  const watchlist = {
    symbols: vi.fn(async (userId: string) => userId === 'alice' ? ['AAPL'] : userId === 'bob' ? ['MSFT'] : []),
    has: vi.fn(async (userId: string, symbol: string) => (userId === 'alice' ? ['AAPL'] : ['MSFT']).includes(symbol)),
    list: vi.fn(), add: vi.fn(), remove: vi.fn(),
  };
  const app = createApp({
    config: { nodeEnv: 'test', port: 4000, webOrigin: 'http://localhost:5173', mongodbUri: 'mongodb://x', google: { clientId: '', clientSecret: '', redirectUri: '' }, alpaca: { apiKey: '', apiSecret: '' }, accessTokenSecret: 'a', refreshTokenPepper: 'b' },
    database: { isReady: async () => true }, marketData: data,
    auth: { provider: {} as never, repository: {} as never, tokens: {
      issueAccessToken: async () => '', issueRefreshToken: async () => ({ token: '', expiresAt: new Date() }),
      verifyAccessToken: async (sub: string) => ({ sub, role: 'viewer' as const }), verifyRefreshToken: async () => ({ sub: 'alice', role: 'viewer' as const }),
    } },
    ...(withScope ? { monitoring: { watchlist } } : {}),
  });
  return { app, data, watchlist };
};

describe('personal market data routes', () => {
  it('requires authentication', async () => {
    const { app, data } = setup();
    await request(app).get('/api/overview').expect(401);
    expect(data.overview).not.toHaveBeenCalled();
  });

  it('filters collections by current user and preserves provider state', async () => {
    const { app, watchlist } = setup();
    for (const [userId, symbol, spread] of [['alice', 'AAPL', 1], ['bob', 'MSFT', 2]] as const) {
      expect((await request(app).get('/api/overview?userId=someone-else').set('Cookie', `access_token=${userId}`).expect(200)).body).toEqual({ provider: 'alpaca', providerState: 'unconfigured', symbols: [symbol] });
      expect((await request(app).get('/api/symbols').set('Cookie', `access_token=${userId}`).expect(200)).body).toEqual({ symbols: [{ symbol, spread }] });
      expect(watchlist.symbols).toHaveBeenCalledWith(userId);
    }
  });

  it('denies unowned detail and metrics before accessing market data', async () => {
    const { app, data, watchlist } = setup();
    for (const [userId, symbol] of [['alice', 'MSFT'], ['bob', 'AAPL']]) {
      for (const url of [`/api/symbols/${symbol}`, `/api/metrics?symbol=${symbol}&interval=1m`]) expect((await request(app).get(url).set('Cookie', `access_token=${userId}`).expect(404)).body.error.code).toBe('SYMBOL_NOT_FOUND');
      expect(watchlist.has).toHaveBeenCalledWith(userId, symbol);
    }
    expect(data.symbol).not.toHaveBeenCalled();
    expect(data.metrics).not.toHaveBeenCalled();
  });

  it('serves owned detail and validated minute metrics', async () => {
    const { app, data } = setup();
    expect((await request(app).get('/api/symbols/AAPL').set('Cookie', 'access_token=alice').expect(200)).body).toEqual({ symbol: 'AAPL', spread: 1 });
    expect((await request(app).get('/api/metrics?symbol=AAPL&interval=1m&from=2026-11-05T16:00:00Z&to=2026-11-05T18:00:00Z').set('Cookie', 'access_token=alice').expect(200)).body.metrics).toHaveLength(1);
    expect(data.metrics).toHaveBeenCalledWith({ symbol: 'AAPL', interval: '1m', from: new Date('2026-11-05T16:00:00Z'), to: new Date('2026-11-05T18:00:00Z') });
  });

  it('keeps invalid symbols and metric windows as 400', async () => {
    const { app, data, watchlist } = setup();
    for (const url of ['/api/symbols/aapl', '/api/metrics?symbol=AAPL&interval=5m', '/api/metrics?symbol=AAPL&interval=1m&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z', '/api/metrics?symbol=AAPL&interval=1m&from=2026-11-05T18:00:00Z&to=2026-11-05T16:00:00Z']) expect((await request(app).get(url).set('Cookie', 'access_token=alice').expect(400)).body.error.code).toBe('INVALID_QUERY');
    expect(watchlist.has).not.toHaveBeenCalled();
    expect(data.metrics).not.toHaveBeenCalled();
  });

  it('fails closed when personal scope is not configured', async () => {
    const { app, data } = setup(false);
    expect((await request(app).get('/api/symbols').set('Cookie', 'access_token=alice').expect(200)).body).toEqual({ symbols: [] });
    expect((await request(app).get('/api/overview').set('Cookie', 'access_token=alice').expect(200)).body.symbols).toEqual([]);
    await request(app).get('/api/symbols/AAPL').set('Cookie', 'access_token=alice').expect(404);
    expect(data.symbol).not.toHaveBeenCalled();
  });
});
