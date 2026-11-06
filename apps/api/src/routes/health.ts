import { Router } from 'express';
import type { Database } from '../db.js';
import type { AppConfig } from '../config.js';
import type { ProviderState } from '@marketpulse/contracts';

export interface HealthDependencies {
  database: Pick<Database, 'isReady'>;
  config: AppConfig;
  providerState?: () => ProviderState;
}

export function createHealthRouter({ database, config, providerState }: HealthDependencies): Router {
  const router = Router();

  router.get('/live', (_request, response) => response.json({ status: 'live' }));
  router.get('/ready', async (_request, response) => {
    const mongodbReady = await database.isReady();
    const productionConfigReady = config.nodeEnv !== 'production' || Boolean(
      config.google.clientId && config.google.clientSecret && config.google.redirectUri
      && config.alpaca.apiKey && config.alpaca.apiSecret
      && config.accessTokenSecret.length >= 32 && config.refreshTokenPepper.length >= 32,
    );
    const state = providerState?.() ?? (config.alpaca.apiKey && config.alpaca.apiSecret ? 'unavailable' : 'unconfigured');
    const providerReady = state === 'connected' || state === 'market_closed' || state === 'outside_session';
    const ready = mongodbReady && productionConfigReady && providerReady;
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      services: {
        mongodb: mongodbReady ? 'ready' : 'unavailable',
        configuration: productionConfigReady ? 'ready' : 'missing',
        alpaca: state,
      },
    });
  });

  return router;
}
