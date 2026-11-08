import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createGracefulShutdown } from './http/shutdown.js';
import { createGoogleIdentityProvider } from './auth/google-provider.js';
import { MongooseAuthRepository } from './auth/mongoose-repository.js';
import { AlpacaProvider } from './market-data/alpaca-provider.js';
import { MarketDataAggregator } from './market-data/aggregator.js';
import { MetricBucket, upsertMinuteBucket } from './models/metric-bucket.js';
import { User } from './models/user.js';
import { UserWatchlistEntry } from './models/user-watchlist-entry.js';
import { AuthInvariant } from './models/auth-invariant.js';
import { AuditEvent } from './models/audit-event.js';
import { RefreshToken } from './models/refresh-token.js';
import { MinuteMetricWriter } from './market-data/minute-writer.js';
import { MonitoringEvaluator } from './monitoring/evaluator.js';
import { AlertService } from './monitoring/alert-service.js';
import { MonitoringRuntime } from './monitoring/runtime.js';
import { RuleService } from './monitoring/rule-service.js';
import { createTokenService } from './auth/tokens.js';
import { createRealtimeServer } from './realtime/socket-server.js';
import { RealtimePublisher } from './realtime/publisher.js';
import { PersonalWatchlistService } from './monitoring/personal-watchlist-service.js';
import { SubscriptionCoordinator } from './monitoring/subscription-coordinator.js';
import { SubscriptionRefreshRetry } from './monitoring/subscription-refresh-retry.js';
import { AssetDirectory } from './market-data/asset-directory.js';
import { BootstrapAttempt } from './bootstrap-attempt.js';
import { bootstrapPersonalWatchlists, createWatchlistInitializationReader } from './bootstrap-personal-watchlists.js';

const config = loadConfig();
const staticDir = config.nodeEnv === 'production' ? fileURLToPath(new URL('../../web/dist', import.meta.url)) : undefined;
const database = connectDatabase(config.mongodbUri);
const marketProvider = new AlpacaProvider({ apiKey: config.alpaca.apiKey, apiSecret: config.alpaca.apiSecret });
let servicesReady = false;
let application = createApp({ config, database, providerState: () => marketProvider.state(), servicesReady: () => servicesReady, staticDir });
const server = createServer((request, response) => application(request, response));
let shutdown: ((signal: string) => Promise<void>) | undefined;
let initializing = false;
let stopped = false;

server.listen(config.port, () => console.log(`API listening on port ${config.port}`));

async function initialize(): Promise<void> {
  if (initializing || stopped) return;
  initializing = true;
  const attempt = new BootstrapAttempt();
  try {
    await database.connect();
    const provider = createGoogleIdentityProvider(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
    const tokens = createTokenService(config.accessTokenSecret, config.refreshTokenPepper);
    const aggregator = new MarketDataAggregator({ marketClock: { get: () => marketProvider.getMarketClock() } });
    let publisher: RealtimePublisher | undefined;
    let realtime: ReturnType<typeof createRealtimeServer> | undefined;
    const alertService = new AlertService(() => publisher?.alertsChanged());
    const ruleService = new RuleService(() => publisher?.rulesChanged());
    let subscriptionsStarted = false;
    const refreshSubscriptions = () => subscriptionRefresh.refresh();
    const watchlistService = new PersonalWatchlistService(async userId => {
      if (subscriptionsStarted) await refreshSubscriptions();
      if (!realtime) return;
      try {
        await realtime.refreshUserRooms(userId);
        publisher?.watchlistChanged(userId, await watchlistService.symbols(userId));
      } catch {
        // The transaction has committed. Fail closed until a fresh connection
        // can reload membership, and keep the successful mutation authoritative.
        realtime.in(`user:${userId}`).disconnectSockets(true);
        console.error({ component: 'realtime' }, 'Personal watchlist room refresh failed');
      }
    });
    const subscriptions = new SubscriptionCoordinator(watchlistService, marketProvider);
    const providerState = () => subscriptions.isHealthy() ? marketProvider.state() : 'unavailable' as const;
    const subscriptionRefresh = new SubscriptionRefreshRetry(subscriptions, {
      onSuccess: () => publisher?.providerState(providerState()),
      onFailure: () => {
        // The mutation is committed; keep readiness degraded until the
        // lifecycle-owned retry has successfully applied the database union.
        publisher?.providerState('unavailable');
        console.error({ component: 'subscriptions' }, 'Market subscription refresh failed; retry scheduled');
      },
    });
    attempt.defer(() => subscriptionRefresh.close());
    const assetDirectory = new AssetDirectory(marketProvider);
    const repository = new MongooseAuthRepository(async userId => {
      await watchlistService.initializeUser(userId);
      if (!subscriptions.isHealthy()) await refreshSubscriptions();
    });
    const monitoring = new MonitoringRuntime(
      { snapshot: symbol => aggregator.snapshotWithMarketState(symbol), symbols: () => subscriptions.symbols() },
      new MonitoringEvaluator(alertService), undefined,
      { onError: error => console.error({ component: 'monitoring', error }, 'Monitoring evaluation failure') },
    );
    const minuteWriter = new MinuteMetricWriter(upsertMinuteBucket, { onFailure: error => {
      aggregator.recordProviderError(subscriptions.symbols());
      console.error({ component: 'minute-metric-writer', message: error.message }, 'Market metric persistence failure');
    } });
    await bootstrapPersonalWatchlists({
      ensureIndexes: async () => { await Promise.all([User, UserWatchlistEntry, AuthInvariant, AuditEvent, RefreshToken].map(model => model.createIndexes())); },
      usersMissingInitialization: createWatchlistInitializationReader(),
      initializeUser: userId => watchlistService.initializeUser(userId),
      onMigrationComplete: summary => console.log({ component: 'watchlist-migration', ...summary }, 'Personal watchlist migration completed'),
      coordinator: subscriptions, provider: marketProvider, attempt,
    });
    subscriptionsStarted = true;
    const marketData = {
      overview: async () => ({ provider: marketProvider.name, providerState: providerState(), symbols: subscriptions.symbols() }),
      symbols: async () => Promise.all(subscriptions.symbols().map(symbol => aggregator.snapshotWithMarketState(symbol))),
      symbol: async (symbol: string) => subscriptions.symbols().includes(symbol) ? aggregator.snapshotWithMarketState(symbol) : null,
      metrics: async ({ symbol, from, to }: { symbol: string; from: Date; to: Date }) => MetricBucket.find({ symbol, bucketStart: { $gte: from, $lte: to } }).sort({ bucketStart: 1 }).lean(),
    };
    const unsubscribeEvents = marketProvider.onEvent(event => {
      aggregator.ingest(event);
      publisher?.requestSnapshots({ provider: marketProvider.name, providerState: providerState(), symbols: subscriptions.symbols(), snapshot: symbol => aggregator.snapshotWithMarketState(symbol) });
      minuteWriter.ingest(event);
      void monitoring.observe(event.symbol).catch(error => console.error({ component: 'monitoring', error }, 'Monitoring evaluation failure'));
    });
    attempt.defer(() => { unsubscribeEvents(); });
    const unsubscribeOperational = marketProvider.onOperationalEvent(event => {
      if (event.type === 'state') publisher?.providerState(providerState());
      if (event.type === 'error') { aggregator.recordProviderError(subscriptions.symbols()); minuteWriter.record('providerErrors', subscriptions.symbols()); }
      if (event.type === 'reconnect') { aggregator.recordReconnect(subscriptions.symbols()); minuteWriter.record('reconnects', subscriptions.symbols()); }
      void monitoring.tick();
    });
    attempt.defer(() => { unsubscribeOperational(); });
    minuteWriter.start();
    attempt.defer(() => minuteWriter.stop());
    monitoring.start();
    attempt.defer(() => monitoring.stop());
    const fullApplication = createApp({ config, database, providerState, servicesReady: () => servicesReady, auth: { provider, repository, tokens }, marketData, assetDirectory, assetLookup: assetDirectory, monitoring: { rules: ruleService, alerts: alertService, watchlist: watchlistService }, staticDir });
    // Socket.IO is attached only after every fallible bootstrap step above has succeeded.
    realtime = createRealtimeServer(server, { tokens, findCurrentUser: id => repository.findUserById(id), symbolsForUser: id => watchlistService.symbols(id), webOrigin: config.webOrigin });
    publisher = new RealtimePublisher(realtime);
    shutdown = createGracefulShutdown({ server, socket: { close: () => new Promise<void>(resolve => realtime!.close(() => resolve())) }, provider: marketProvider, monitoring: { stop: () => { subscriptionRefresh.close(); monitoring.stop(); publisher?.close(); } }, metrics: { flush: () => minuteWriter.stop() }, database });
    application = fullApplication;
    servicesReady = true;
    attempt.commit();
    try { publisher.providerState(providerState()); }
    catch { console.error({ component: 'realtime' }, 'Initial provider state publication failed'); }
    console.log('Database connected; application services started');
  } catch {
    servicesReady = false;
    await attempt.rollback();
    // Database/provider errors may embed connection URIs or user data.
    console.error({ component: 'bootstrap' }, 'Application initialization failed; retrying');
    if (!stopped) setTimeout(() => { initializing = false; void initialize(); }, 2_000).unref();
    return;
  }
  initializing = false;
}

void initialize();

const stop = (signal: string) => {
  stopped = true;
  servicesReady = false;
  if (shutdown) void shutdown(signal);
  else server.close(() => void database.disconnect());
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
