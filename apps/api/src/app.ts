import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';
import { errorHandler, notFound } from './http/errors.js';
import { requestContext } from './http/request-context.js';
import { createHealthRouter } from './routes/health.js';
import { createSetupRouter } from './routes/setup.js';

export interface AppDependencies {
  config: AppConfig;
  database: Pick<Database, 'isReady'>;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: dependencies.config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/health', createHealthRouter(dependencies.database));
  app.use('/api/setup', createSetupRouter(dependencies.config, dependencies.database));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
