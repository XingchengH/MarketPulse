import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';
import type { ProviderState } from '@marketpulse/contracts';

export interface ConfigurationReadiness {
  googleOAuth?: boolean;
  alpaca?: boolean;
  tokens?: boolean;
}

export function createSetupRouter(
  config: AppConfig,
  database: Pick<Database, 'isReady'>,
  providerState?: () => ProviderState,
  readiness: ConfigurationReadiness = {},
): Router {
  const router = Router();

  router.get('/status', async (_request, response) => {
    const mongodbReady = await database.isReady();
    const services = {
      mongodb: mongodbReady ? 'ready' : 'unavailable',
      googleOAuth:
        (readiness.googleOAuth ?? Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri))
          ? 'ready'
          : 'missing',
      alpaca: (readiness.alpaca ?? Boolean(config.alpaca.apiKey && config.alpaca.apiSecret)) ? (providerState?.() ?? 'unavailable') : 'missing',
      tokens: (readiness.tokens ?? Boolean(config.accessTokenSecret && config.refreshTokenPepper)) ? 'ready' : 'missing',
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
