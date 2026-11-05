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
    expect(readiness.body).toEqual({ status: 'not_ready', services: { mongodb: 'unavailable' } });
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
