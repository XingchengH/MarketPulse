import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
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
import { WatchlistService, mongooseWatchlistRepository } from '../../api/src/monitoring/watchlist-service.js';
import { createRealtimeServer } from '../../api/src/realtime/socket-server.js';
import { RealtimePublisher } from '../../api/src/realtime/publisher.js';
import { MetricBucket } from '../../api/src/models/metric-bucket.js';
import { User } from '../../api/src/models/user.js';
import { Rule } from '../../api/src/models/rule.js';
import { RuleVersion } from '../../api/src/models/rule-version.js';
import { Alert } from '../../api/src/models/alert.js';
import { AuditEvent } from '../../api/src/models/audit-event.js';
import { Watchlist } from '../../api/src/models/watchlist.js';
import { FakeGoogleIdentityProvider } from '../../api/src/test-helpers/fake-google.js';
import { FakeMarketDataProvider } from '../../api/src/test-helpers/fake-provider.js';

const apiPort = Number(process.env.E2E_API_PORT);
const webOrigin = `http://localhost:${process.env.E2E_WEB_PORT}`;

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
  await Promise.all([User.syncIndexes(), Rule.syncIndexes(), RuleVersion.syncIndexes(), Alert.syncIndexes(), AuditEvent.syncIndexes(), Watchlist.syncIndexes(), MetricBucket.syncIndexes()]);

  const admin = await User.create({ googleSubject: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin', role: 'admin' });
  await Watchlist.create({ symbol: 'AAPL', enabled: true });
  await Rule.create({ name: 'E2E latency', scope: { kind: 'all' }, metric: 'observedLatencyMs', operator: 'gt', threshold: 25, durationSeconds: 0, severity: 'warning', enabled: true, version: 1, creatorId: String(admin._id) });

  const provider = new FakeMarketDataProvider();
  const callbackUrl = `http://localhost:${apiPort}/api/auth/google/callback`;
  const google = new FakeGoogleIdentityProvider({ subject: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin' }, callbackUrl);
  const repository = new MongooseAuthRepository();
  const tokens = createTokenService('e2e-access-secret-at-least-32-characters', 'e2e-refresh-pepper-at-least-32-characters');
  const aggregator = new MarketDataAggregator({ marketClock: { get: () => provider.getMarketClock() } });
  let publisher: RealtimePublisher | undefined;
  const alertService = new AlertService(() => publisher?.alertsChanged());
  const monitoring = new MonitoringRuntime({ snapshot: symbol => aggregator.snapshotWithMarketState(symbol), symbols: () => ['AAPL'] }, new MonitoringEvaluator(alertService), undefined, { cadenceMs: 1, onError: error => { throw error; } });
  const ruleService = new RuleService(() => publisher?.rulesChanged());
  const watchlistService = new WatchlistService(mongooseWatchlistRepository, provider, () => undefined);
  provider.onEvent(event => {
    aggregator.ingest(event);
    void aggregator.snapshotWithMarketState(event.symbol).then(snapshot => publisher?.symbols([snapshot]));
    void monitoring.observe(event.symbol);
  });
  await provider.connect(['AAPL']);
  cleanup.push(() => provider.disconnect());

  const database = { isReady: async () => (await mongoose.connection.db?.admin().ping())?.ok === 1 };
  const config = { nodeEnv: 'test' as const, port: apiPort, webOrigin, mongodbUri: replicaSet.getUri(), google: { clientId: 'fake-client', clientSecret: 'fake-secret', redirectUri: callbackUrl }, alpaca: { apiKey: 'fake-key', apiSecret: 'fake-secret' }, accessTokenSecret: 'e2e-access-secret-at-least-32-characters', refreshTokenPepper: 'e2e-refresh-pepper-at-least-32-characters' };
  const marketData = {
    overview: async () => ({ provider: provider.name, providerState: provider.state(), symbols: ['AAPL'] }),
    symbols: async () => [await aggregator.snapshotWithMarketState('AAPL')],
    symbol: async (symbol: string) => symbol === 'AAPL' ? aggregator.snapshotWithMarketState(symbol) : null,
    metrics: async () => [],
  };
  const app = createApp({ config, database, auth: { provider: google, repository, tokens }, marketData, monitoring: { rules: ruleService, alerts: alertService, watchlist: watchlistService } });
  const httpServer: Server = createServer(app);
  const realtime = createRealtimeServer(httpServer, { tokens, findCurrentUser: id => repository.findUserById(id) });
  const socketErrors: string[] = [];
  realtime.engine.on('connection_error', error => socketErrors.push(`${error.code}:${error.message}:${JSON.stringify(error.context)}`));
  publisher = new RealtimePublisher(realtime, { intervalMs: 10 });
  cleanup.push(async () => { monitoring.stop(); publisher?.close(); await new Promise<void>(resolve => realtime.close(() => resolve())); if (httpServer.listening) await new Promise<void>(resolve => httpServer.close(() => resolve())); });
  await new Promise<void>((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(apiPort, '127.0.0.1', resolve); });

  return {
    provider,
    async waitForSocket() {
      const deadline = Date.now() + 5_000;
      while ((realtime.sockets.adapter.rooms.get('workspace:default')?.size ?? 0) === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if ((realtime.sockets.adapter.rooms.get('workspace:default')?.size ?? 0) === 0) throw new Error(`Authenticated Socket.IO client did not join the workspace: ${socketErrors.join(', ') || 'no engine request received'}`);
    },
    stop: stopAll,
  };
  } catch (error) { await stopAll(); throw error; }
}
