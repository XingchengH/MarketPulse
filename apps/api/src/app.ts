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
import { AlertService } from './monitoring/alert-service.js';
import { createWatchlistRouter, emptyWatchlistScope, type AssetLookup, type PersonalWatchlistApi } from './routes/watchlist.js';
import type { WatchlistService } from './monitoring/watchlist-service.js';
import type { AssetDirectory } from './market-data/asset-directory.js';
import { createAssetsRouter } from './routes/assets.js';
import type { ProviderState } from '@marketpulse/contracts';
import type { ConfigurationReadiness } from './routes/setup.js';

export interface AppDependencies {
  config: AppConfig;
  database: Pick<Database, 'isReady'>;
  logger?: ErrorLogger;
  providerState?: () => ProviderState;
  configurationReadiness?: ConfigurationReadiness;
  auth?: {
    provider: GoogleIdentityProvider;
    repository: AuthRepository & AdminUserRepository;
    tokens?: TokenService;
  };
  marketData?: MarketDataApi;
  assetDirectory?: Pick<AssetDirectory, 'search'>;
  assetLookup?: AssetLookup;
  // Legacy watchlists are accepted only while server wiring migrates. They are
  // never used as a source of personal membership or mounted as private APIs.
  monitoring?: { rules?: RuleService; alerts?: AlertService; watchlist?: PersonalWatchlistApi | WatchlistService };
  staticDir?: string;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: dependencies.config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/health', createHealthRouter({ database: dependencies.database, config: dependencies.config, providerState: dependencies.providerState, readiness: dependencies.configurationReadiness }));
  app.use('/api/setup', createSetupRouter(dependencies.config, dependencies.database, dependencies.providerState, dependencies.configurationReadiness));
  app.use('/api', async (_request, response, next) => {
    if (await dependencies.database.isReady()) return next();
    return response.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is not ready', requestId: response.locals.requestId } });
  });
  if (dependencies.auth) {
    const tokens = dependencies.auth.tokens ?? createTokenService(dependencies.config.accessTokenSecret, dependencies.config.refreshTokenPepper);
    app.use('/api/auth', createAuthRouter({
      provider: dependencies.auth.provider,
      repository: dependencies.auth.repository,
      tokens,
      nodeEnv: dependencies.config.nodeEnv,
      webOrigin: dependencies.config.webOrigin,
    }));
    const resolveRole = async (id: string) => (await dependencies.auth!.repository.findUserById(id))?.role ?? null;
    const configuredWatchlist = dependencies.monitoring?.watchlist;
    const personalWatchlist = configuredWatchlist && 'symbols' in configuredWatchlist ? configuredWatchlist : undefined;
    const scope = personalWatchlist ?? emptyWatchlistScope;
    app.use('/api/admin/users', requireUser(tokens), createAdminUsersRouter(dependencies.auth.repository));
    if (dependencies.assetDirectory) app.use('/api/assets', requireUser(tokens), createAssetsRouter(dependencies.assetDirectory, scope));
    if (dependencies.marketData) app.use('/api', requireUser(tokens), createMarketDataRouter(dependencies.marketData, scope));
    if (dependencies.monitoring) {
      if (personalWatchlist) app.use('/api/watchlist', requireUser(tokens), createWatchlistRouter(personalWatchlist, dependencies.assetLookup ?? { lookupAsset: async () => { throw new Error('Asset lookup is not configured'); } }));
      app.use('/api/rules', requireUser(tokens), createRulesRouter(dependencies.monitoring.rules ?? new RuleService(), resolveRole));
      app.use('/api/alerts', requireUser(tokens), createAlertsRouter(resolveRole, dependencies.monitoring.alerts, scope));
      app.use('/api/audit', requireUser(tokens), createAuditRouter(resolveRole));
    }
  }
  if (dependencies.staticDir) {
    app.use(express.static(dependencies.staticDir));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api') || request.path.startsWith('/health') || !request.accepts('html')) return next();
      return response.sendFile('index.html', { root: dependencies.staticDir });
    });
  }
  app.use(notFound);
  app.use(createErrorHandler(dependencies.logger ?? console));
  return app;
}
