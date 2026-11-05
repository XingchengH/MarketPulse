import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';
import { createErrorHandler, type ErrorLogger, notFound } from './http/errors.js';
import { requestContext } from './http/request-context.js';
import { createHealthRouter } from './routes/health.js';
import { createSetupRouter } from './routes/setup.js';
import { createAuthRouter, type AuthRepository } from './routes/auth.js';
import { createAdminUsersRouter, type AdminUserRepository } from './routes/admin-users.js';
import type { GoogleIdentityProvider } from './auth/google-provider.js';
import { createTokenService, type TokenService } from './auth/tokens.js';
import { requireUser } from './auth/middleware.js';
import { createMarketDataRouter, type MarketDataApi } from './routes/market-data.js';
import { createRulesRouter } from './routes/rules.js';
import { createAlertsRouter } from './routes/alerts.js';
import { createAuditRouter } from './routes/audit.js';
import { RuleService } from './monitoring/rule-service.js';

export interface AppDependencies {
  config: AppConfig;
  database: Pick<Database, 'isReady'>;
  logger?: ErrorLogger;
  auth?: {
    provider: GoogleIdentityProvider;
    repository: AuthRepository & AdminUserRepository;
    tokens?: TokenService;
  };
  marketData?: MarketDataApi;
  monitoring?: { rules?: RuleService };
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: dependencies.config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/health', createHealthRouter(dependencies.database));
  app.use('/api/setup', createSetupRouter(dependencies.config, dependencies.database));
  if (dependencies.auth) {
    const tokens = dependencies.auth.tokens ?? createTokenService(dependencies.config.accessTokenSecret, dependencies.config.refreshTokenPepper);
    app.use('/api/auth', createAuthRouter({
      provider: dependencies.auth.provider,
      repository: dependencies.auth.repository,
      tokens,
      nodeEnv: dependencies.config.nodeEnv,
      webOrigin: dependencies.config.webOrigin,
    }));
    app.use('/api/admin/users', requireUser(tokens), createAdminUsersRouter(dependencies.auth.repository));
    if (dependencies.marketData) app.use('/api', requireUser(tokens), createMarketDataRouter(dependencies.marketData));
    if (dependencies.monitoring) {
      const resolveRole = async (id: string) => (await dependencies.auth!.repository.findUserById(id))?.role ?? null;
      app.use('/api/rules', requireUser(tokens), createRulesRouter(dependencies.monitoring.rules ?? new RuleService(), resolveRole));
      app.use('/api/alerts', requireUser(tokens), createAlertsRouter(resolveRole));
      app.use('/api/audit', requireUser(tokens), createAuditRouter(resolveRole));
    }
  }
  app.use(notFound);
  app.use(createErrorHandler(dependencies.logger ?? console));
  return app;
}
