import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';
import type { ProviderState } from '@marketpulse/contracts';

export function createSetupRouter(
  config: AppConfig,
  database: Pick<Database, 'isReady'>,
  providerState?: () => ProviderState,
): Router {
  const router = Router();

  router.get('/status', async (_request, response) => {
    const mongodbReady = await database.isReady();
    const services = {
      mongodb: mongodbReady ? 'ready' : 'unavailable',
      googleOAuth:
        config.google.clientId && config.google.clientSecret && config.google.redirectUri
          ? 'ready'
          : 'missing',
      alpaca: config.alpaca.apiKey && config.alpaca.apiSecret ? (providerState?.() ?? 'unavailable') : 'missing',
      tokens: config.accessTokenSecret && config.refreshTokenPepper ? 'ready' : 'missing',
    } as const;

    response.json({
      configured: services.mongodb === 'ready'
        && services.googleOAuth === 'ready'
        && services.tokens === 'ready'
        && (services.alpaca === 'connected' || services.alpaca === 'market_closed' || services.alpaca === 'outside_session'),
      services,
    });
  });

  return router;
}
