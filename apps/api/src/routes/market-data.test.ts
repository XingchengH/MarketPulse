import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const config = { nodeEnv: 'test' as const, port: 4000, webOrigin: 'http://localhost:5173', mongodbUri: 'mongodb://x', google: { clientId: '', clientSecret: '', redirectUri: '' }, alpaca: { apiKey: '', apiSecret: '' }, accessTokenSecret: 'a', refreshTokenPepper: 'b' };
const tokens = { issueAccessToken: async () => '', issueRefreshToken: async () => ({ token: '', expiresAt: new Date() }), verifyAccessToken: async () => ({ sub: 'u', role: 'viewer' as const }), verifyRefreshToken: async () => ({ sub: 'u', role: 'viewer' as const }) };
const data = { overview: async () => ({ providerState: 'unconfigured' }), symbols: async () => [], symbol: async () => null, metrics: async () => [] };
const auth = { provider: {} as never, repository: {} as never, tokens };

describe('market data routes', () => {
  it('requires authentication', async () => {
    expect((await request(createApp({ config, database: { isReady: async () => true }, marketData: data, auth })).get('/api/overview')).status).toBe(401);
  });
  it('serves authenticated overview and returns configuration state', async () => {
    const response = await request(createApp({ config, database: { isReady: async () => true }, marketData: data, auth })).get('/api/overview').set('Cookie', 'access_token=valid');
    expect(response.status).toBe(200); expect(response.body).toEqual({ providerState: 'unconfigured' });
  });
  it('validates symbols and metric windows', async () => {
    const app = createApp({ config, database: { isReady: async () => true }, marketData: data, auth });
    expect((await request(app).get('/api/symbols/aapl').set('Cookie', 'access_token=x')).status).toBe(400);
    expect((await request(app).get('/api/metrics?symbol=AAPL&interval=5m').set('Cookie', 'access_token=x')).status).toBe(400);
    expect((await request(app).get('/api/metrics?symbol=AAPL&interval=1m&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z').set('Cookie', 'access_token=x')).status).toBe(400);
  });
});
