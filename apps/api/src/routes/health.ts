import { Router } from 'express';
import type { Database } from '../db.js';
import type { AppConfig } from '../config.js';
import type { ProviderState } from '@marketpulse/contracts';
import type { ConfigurationReadiness } from './setup.js';

export interface HealthDependencies {
  database: Pick<Database, 'isReady'>;
  config: AppConfig;
  providerState?: () => ProviderState;
  readiness?: ConfigurationReadiness;
  servicesReady?: () => boolean;
}

export function createHealthRouter({ database, config, providerState, readiness = {}, servicesReady = () => true }: HealthDependencies): Router {
  const router = Router();

  router.get('/live', (_request, response) => response.json({ status: 'live' }));
  router.get('/ready', async (_request, response) => {
    const mongodbReady = await database.isReady();
    const googleReady = readiness.googleOAuth ?? Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
    const alpacaReady = readiness.alpaca ?? Boolean(config.alpaca.apiKey && config.alpaca.apiSecret);
    const tokensReady = readiness.tokens ?? Boolean(config.accessTokenSecret && config.refreshTokenPepper);
    const configurationReady = googleReady && alpacaReady && tokensReady;
    const state = providerState?.() ?? (alpacaReady ? 'unavailable' : 'unconfigured');
    const providerReady = state === 'connected' || state === 'market_closed' || state === 'outside_session';
    const ready = servicesReady() && mongodbReady && configurationReady && providerReady;
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      services: {
        mongodb: mongodbReady ? 'ready' : 'unavailable',
        configuration: configurationReady ? 'ready' : 'missing',
        alpaca: state,
      },
    });
  });

  return router;
}
