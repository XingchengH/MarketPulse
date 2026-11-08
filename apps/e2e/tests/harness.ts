import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { BrowserContext } from '@playwright/test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../../api/src/app.js';
import { createTokenService } from '../../api/src/auth/tokens.js';
import { MongooseAuthRepository } from '../../api/src/auth/mongoose-repository.js';
import { MarketDataAggregator } from '../../api/src/market-data/aggregator.js';
import { MonitoringEvaluator } from '../../api/src/monitoring/evaluator.js';
import { AlertService } from '../../api/src/monitoring/alert-service.js';
import { MonitoringRuntime } from '../../api/src/monitoring/runtime.js';
import { RuleService } from '../../api/src/monitoring/rule-service.js';
import { PersonalWatchlistService } from '../../api/src/monitoring/personal-watchlist-service.js';
import { SubscriptionCoordinator } from '../../api/src/monitoring/subscription-coordinator.js';
import { AssetDirectory } from '../../api/src/market-data/asset-directory.js';
import { createRealtimeServer } from '../../api/src/realtime/socket-server.js';
import { RealtimePublisher } from '../../api/src/realtime/publisher.js';
import { MetricBucket } from '../../api/src/models/metric-bucket.js';
import { User } from '../../api/src/models/user.js';
import { Rule } from '../../api/src/models/rule.js';
import { RuleVersion } from '../../api/src/models/rule-version.js';
import { Alert } from '../../api/src/models/alert.js';
import { AuditEvent } from '../../api/src/models/audit-event.js';
import { UserWatchlistEntry } from '../../api/src/models/user-watchlist-entry.js';
import { AuthInvariant } from '../../api/src/models/auth-invariant.js';
import { RefreshToken } from '../../api/src/models/refresh-token.js';
import { FakeGoogleIdentityProvider } from '../../api/src/test-helpers/fake-google.js';
import { FakeMarketDataProvider } from '../../api/src/test-helpers/fake-provider.js';
import type { ProviderAsset } from '../../api/src/market-data/provider.js';

const apiPort = Number(process.env.E2E_API_PORT);
const webOrigin = `http://localhost:${process.env.E2E_WEB_PORT}`;
const identities = {
  admin: { subject: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin' },
  userA: { subject: 'e2e-user-a', email: 'alpha@example.test', name: 'User Alpha' },
  userB: { subject: 'e2e-user-b', email: 'beta@example.test', name: 'User Beta' },
} as const;
type Identity = keyof typeof identities;

class E2eMarketDataProvider extends FakeMarketDataProvider {
  readonly subscriptionHistory: string[][] = [];
  override async connect(symbols: string[]) { this.subscriptionHistory.push([...symbols]); await super.connect(symbols); }
  override async replaceSubscriptions(symbols: string[]) { this.subscriptionHistory.push([...symbols]); }
  override async listAssets(): Promise<ProviderAsset[]> {
    return [...await super.listAssets(),
      { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', exchange: 'NASDAQ', assetClass: 'us_equity', status: 'active', tradable: true },
      { symbol: 'GOOG', name: 'Alphabet Inc.', exchange: 'NASDAQ', assetClass: 'us_equity', status: 'active', tradable: true },
    ];
  }
}

export async function startE2eHarness() {
  if (process.env.NODE_ENV !== 'test') throw new Error('E2E dependency injection is restricted to NODE_ENV=test');
  if (!Number.isInteger(apiPort) || !process.env.E2E_WEB_PORT) throw new Error('Playwright did not allocate E2E ports');
  const cleanup: Array<() => Promise<void>> = [];
  const stopAll = async () => { for (const stop of cleanup.splice(0).reverse()) { try { await stop(); } catch { /* preserve the original startup/test failure */ } } };
  try {
  let systemBinary: string | undefined;
  try { systemBinary = execFileSync('which', ['mongod'], { encoding: 'utf8' }).trim() || undefined; } catch { /* download fallback */ }
  const replicaSet = await MongoMemoryReplSet.create({ binary: systemBinary ? { systemBinary } : undefined, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  cleanup.push(() => replicaSet.stop().then(() => undefined));
  await mongoose.connect(replicaSet.getUri(), { dbName: 'marketpulse-e2e' });
  cleanup.push(() => mongoose.disconnect());
  await Promise.all([User.syncIndexes(), UserWatchlistEntry.syncIndexes(), AuthInvariant.syncIndexes(), RefreshToken.syncIndexes(), Rule.syncIndexes(), RuleVersion.syncIndexes(), Alert.syncIndexes(), AuditEvent.syncIndexes(), MetricBucket.syncIndexes()]);

  const admin = await User.create({ googleSubject: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin', role: 'admin' });
  await Rule.create({ name: 'E2E latency', scope: { kind: 'all' }, metric: 'observedLatencyMs', operator: 'gt', threshold: 25, durationSeconds: 0, severity: 'warning', enabled: true, version: 1, creatorId: String(admin._id) });

  const provider = new E2eMarketDataProvider();
  const callbackUrl = `http://localhost:${apiPort}/api/auth/google/callback`;
  const defaultGoogle = new FakeGoogleIdentityProvider(identities.admin, callbackUrl);
  const google = {
    authorizationUrl: defaultGoogle.authorizationUrl.bind(defaultGoogle),
    async exchange(code: string) {
      if (code === 'fake-google-code') return defaultGoogle.exchange(code);
      const identity = Object.keys(identities).find(key => code === `e2e-${key}`) as Identity | undefined;
      if (!identity) throw new Error('Invalid E2E identity code');
      return identities[identity];
    },
  };
  let subscriptionsStarted = false;
  let realtime: ReturnType<typeof createRealtimeServer> | undefined;
  let publisher: RealtimePublisher | undefined;
  const watchlistService = new PersonalWatchlistService(async userId => {
    if (subscriptionsStarted) await subscriptions.refresh();
    if (realtime) {
      await realtime.refreshUserRooms(userId);
      publisher?.watchlistChanged(userId, await watchlistService.symbols(userId));
    }
  });
  const subscriptions = new SubscriptionCoordinator(watchlistService, provider);
  const assetDirectory = new AssetDirectory(provider);
  await watchlistService.initializeUser(String(admin._id));
  const repository = new MongooseAuthRepository(userId => watchlistService.initializeUser(userId));
  const tokens = createTokenService('e2e-access-secret-at-least-32-characters', 'e2e-refresh-pepper-at-least-32-characters');
  const aggregator = new MarketDataAggregator({ marketClock: { get: () => provider.getMarketClock() } });
  const alertService = new AlertService(() => publisher?.alertsChanged());
  const monitoring = new MonitoringRuntime({ snapshot: symbol => aggregator.snapshotWithMarketState(symbol), symbols: () => subscriptions.symbols() }, new MonitoringEvaluator(alertService), undefined, { cadenceMs: 1, onError: error => { throw error; } });
  const ruleService = new RuleService(() => publisher?.rulesChanged());
  provider.onEvent(event => {
    aggregator.ingest(event);
    void aggregator.snapshotWithMarketState(event.symbol).then(snapshot => publisher?.symbols([snapshot]));
    void monitoring.observe(event.symbol);
  });
  await subscriptions.initialize(symbols => provider.connect(symbols));
  subscriptionsStarted = true;
  cleanup.push(() => provider.disconnect());

  const database = { isReady: async () => (await mongoose.connection.db?.admin().ping())?.ok === 1 };
  const config = { nodeEnv: 'test' as const, port: apiPort, webOrigin, mongodbUri: replicaSet.getUri(), google: { clientId: 'fake-client', clientSecret: 'fake-secret', redirectUri: callbackUrl }, alpaca: { apiKey: 'fake-key', apiSecret: 'fake-secret' }, accessTokenSecret: 'e2e-access-secret-at-least-32-characters', refreshTokenPepper: 'e2e-refresh-pepper-at-least-32-characters' };
  const marketData = {
    overview: async () => ({ provider: provider.name, providerState: provider.state(), symbols: subscriptions.symbols() }),
    symbols: async () => Promise.all(subscriptions.symbols().map(symbol => aggregator.snapshotWithMarketState(symbol))),
    symbol: async (symbol: string) => subscriptions.symbols().includes(symbol) ? aggregator.snapshotWithMarketState(symbol) : null,
    metrics: async () => [],
  };
  const app = createApp({ config, database, providerState: () => provider.state(), auth: { provider: google, repository, tokens }, marketData, assetDirectory, assetLookup: assetDirectory, monitoring: { rules: ruleService, alerts: alertService, watchlist: watchlistService } });
  const httpServer: Server = createServer(app);
  realtime = createRealtimeServer(httpServer, { tokens, findCurrentUser: id => repository.findUserById(id), symbolsForUser: id => watchlistService.symbols(id), webOrigin });
  const socketServer = realtime;
  const socketErrors: string[] = [];
  realtime.engine.on('connection_error', error => socketErrors.push(`${error.code}:${error.message}:${JSON.stringify(error.context)}`));
  publisher = new RealtimePublisher(realtime, { intervalMs: 10 });
  cleanup.push(async () => { monitoring.stop(); publisher?.close(); await new Promise<void>(resolve => socketServer.close(() => resolve())); if (httpServer.listening) await new Promise<void>(resolve => httpServer.close(() => resolve())); });
  await new Promise<void>((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(apiPort, '127.0.0.1', resolve); });

  const selectedIdentities = new WeakMap<BrowserContext, Identity>();
  return {
    provider,
    subscriptionHistory: provider.subscriptionHistory,
    async selectIdentity(context: BrowserContext, identity: Identity) {
      if (!selectedIdentities.has(context)) {
        // Change only the fake provider's redirect code. The real OAuth start
        // sets its cookie and the callback validates state; no selector endpoint exists.
        await context.route(/\/api\/auth\/google(?:\?|$)/, async route => {
          const response = await route.fetch({ maxRedirects: 0 });
          const url = new URL(response.headers().location!);
          url.searchParams.set('code', `e2e-${selectedIdentities.get(context)!}`);
          await route.fulfill({ response, headers: { ...response.headers(), location: url.toString() } });
        });
      }
      selectedIdentities.set(context, identity);
    },
    async waitForSocket(identity?: Identity, symbols: string[] = [], excludedSymbols: string[] = []) {
      const user = identity ? await User.findOne({ googleSubject: identities[identity].subject }).lean() : undefined;
      if (identity && !user) throw new Error(`E2E identity ${identity} has not signed in`);
      const ready = () => [...socketServer.sockets.sockets.values()].some(socket =>
        (!user || socket.data.user.id === String(user._id)) && socket.conn.transport.name === 'websocket'
        && symbols.every(symbol => socket.rooms.has(`symbol:${symbol}`))
        && excludedSymbols.every(symbol => !socket.rooms.has(`symbol:${symbol}`)));
      const deadline = Date.now() + 5_000;
      while (!ready() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if (!ready()) throw new Error(`Authenticated Socket.IO client did not join its symbol rooms over WebSocket: ${socketErrors.join(', ') || 'no matching client'}`);
    },
    stop: stopAll,
  };
  } catch (error) { await stopAll(); throw error; }
}
