import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';

export function createSetupRouter(
  config: AppConfig,
  database: Pick<Database, 'isReady'>,
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
      alpaca: config.alpaca.apiKey && config.alpaca.apiSecret ? 'ready' : 'missing',
      tokens: config.accessTokenSecret && config.refreshTokenPepper ? 'ready' : 'missing',
    } as const;

    response.json({
      configured: Object.values(services).every((status) => status === 'ready'),
      services,
    });
  });

  return router;
}
