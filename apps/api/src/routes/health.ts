import { Router } from 'express';
import type { Database } from '../db.js';

export function createHealthRouter(database: Pick<Database, 'isReady'>): Router {
  const router = Router();

  router.get('/live', (_request, response) => response.json({ status: 'live' }));
  router.get('/ready', async (_request, response) => {
    const ready = await database.isReady();
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      services: { mongodb: ready ? 'ready' : 'unavailable' },
    });
  });

  return router;
}
