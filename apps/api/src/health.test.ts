import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

const unconfigured = {
  config: {
    nodeEnv: 'test' as const,
    port: 4000,
    webOrigin: 'http://localhost:5173',
    mongodbUri: 'mongodb://localhost:27017/marketpulse',
    google: { clientId: '', clientSecret: '', redirectUri: '' },
    alpaca: { apiKey: '', apiSecret: '' },
    accessTokenSecret: 'top-secret-access-value',
    refreshTokenPepper: 'top-secret-refresh-value',
  },
  database: { isReady: () => true },
};

describe('service health', () => {
  it('reports setup state without exposing secrets', async () => {
    const response = await request(createApp(unconfigured)).get('/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      configured: false,
      services: {
        mongodb: 'ready',
        googleOAuth: 'missing',
        alpaca: 'missing',
        tokens: 'ready',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('top-secret');
  });

  it('keeps liveness up while readiness reports an unavailable database', async () => {
    const app = createApp({ ...unconfigured, database: { isReady: () => false } });

    expect((await request(app).get('/health/live')).body).toEqual({ status: 'live' });
    const readiness = await request(app).get('/health/ready');
    expect(readiness.status).toBe(503);
    expect(readiness.body).toEqual({ status: 'not_ready', services: { mongodb: 'unavailable', configuration: 'missing', alpaca: 'unconfigured' } });
    expect((await request(app).get('/api/overview')).status).toBe(503);
  });

  it('keeps diagnostics reachable through database startup failure and becomes ready after recovery', async () => {
    let databaseReady = false;
    const config = { ...unconfigured.config, google: { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/callback' }, alpaca: { apiKey: 'key', apiSecret: 'secret' } };
    const app = createApp({ config, database: { isReady: () => databaseReady }, providerState: () => 'connected' });
    expect((await request(app).get('/health/live')).status).toBe(200);
    expect((await request(app).get('/api/setup/status')).body.services.mongodb).toBe('unavailable');
    expect((await request(app).get('/api/overview')).status).toBe(503);
    databaseReady = true;
    expect((await request(app).get('/health/ready')).status).toBe(200);
    expect((await request(app).get('/api/setup/status')).body.services.mongodb).toBe('ready');
  });

  it('is not ready with a connected provider when required Google configuration is missing', async () => {
    const config = { ...unconfigured.config, alpaca: { apiKey: 'key', apiSecret: 'secret' } };
    const app = createApp({ config, database: { isReady: () => true }, providerState: () => 'connected' });
    const readiness = await request(app).get('/health/ready');
    expect(readiness.status).toBe(503);
    expect(readiness.body.services.configuration).toBe('missing');
    expect((await request(app).get('/api/setup/status')).body.configured).toBe(false);
  });

  it('allows explicit test-adapter configuration readiness without NODE_ENV exceptions', async () => {
    const app = createApp({
      ...unconfigured,
      providerState: () => 'connected',
      configurationReadiness: { googleOAuth: true, alpaca: true, tokens: true },
    });
    expect((await request(app).get('/health/ready')).status).toBe(200);
    const setup = await request(app).get('/api/setup/status');
    expect(setup.body.configured).toBe(true);
    expect(setup.body.services).toMatchObject({ googleOAuth: 'ready', alpaca: 'connected', tokens: 'ready' });
  });

  it.each([
    ['connecting', 503], ['reconnecting', 503], ['auth_rejected', 503], ['rate_limited', 503], ['unavailable', 503],
    ['connected', 200], ['market_closed', 200], ['outside_session', 200],
  ] as const)('maps provider state %s to readiness %i', async (state, expected) => {
    const config = {
      ...unconfigured.config,
      nodeEnv: 'production' as const,
      google: { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/callback' },
      alpaca: { apiKey: 'key', apiSecret: 'secret' },
      accessTokenSecret: 'a'.repeat(32), refreshTokenPepper: 'b'.repeat(32),
    };
    const response = await request(createApp({ config, database: { isReady: () => true }, providerState: () => state })).get('/health/ready');
    expect(response.status).toBe(expected);
    expect(response.body.services.alpaca).toBe(state);
  });

  it('rejects readiness when required production configuration is absent', async () => {
    const response = await request(createApp({ ...unconfigured, config: { ...unconfigured.config, nodeEnv: 'production' } })).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.services.configuration).toBe('missing');
  });

  it('returns request-correlated JSON errors', async () => {
    const response = await request(createApp(unconfigured)).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: expect.any(String),
      },
    });
    expect(response.headers['x-request-id']).toBe(response.body.error.requestId);
  });

  it('logs unexpected errors with the request ID and keeps their details out of the response', async () => {
    const logger = { error: vi.fn() };
    const response = await request(createApp({ ...unconfigured, logger }))
      .post('/api/setup/status')
      .set('content-type', 'application/json')
      .send('{"secret":"sensitive-value"');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive-value');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: response.body.error.requestId, error: expect.any(Error) }),
      'Unexpected request error',
    );
  });
});
