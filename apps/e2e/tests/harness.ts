import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../../api/dist/app.js';
import { createTokenService } from '../../api/dist/auth/tokens.js';
import { MongooseAuthRepository } from '../../api/dist/auth/mongoose-repository.js';
import { MarketDataAggregator } from '../../api/dist/market-data/aggregator.js';
import { MonitoringEvaluator } from '../../api/dist/monitoring/evaluator.js';
import { AlertService } from '../../api/dist/monitoring/alert-service.js';
import { MonitoringRuntime } from '../../api/dist/monitoring/runtime.js';
import { RuleService } from '../../api/dist/monitoring/rule-service.js';
import { WatchlistService, mongooseWatchlistRepository } from '../../api/dist/monitoring/watchlist-service.js';
import { createRealtimeServer } from '../../api/dist/realtime/socket-server.js';
import { RealtimePublisher } from '../../api/dist/realtime/publisher.js';
import { MetricBucket } from '../../api/dist/models/metric-bucket.js';
import { User } from '../../api/dist/models/user.js';
import { Rule } from '../../api/dist/models/rule.js';
import { RuleVersion } from '../../api/dist/models/rule-version.js';
import { Alert } from '../../api/dist/models/alert.js';
import { AuditEvent } from '../../api/dist/models/audit-event.js';
import { Watchlist } from '../../api/dist/models/watchlist.js';
import { FakeGoogleIdentityProvider } from '../../api/dist/test-helpers/fake-google.js';
import { FakeMarketDataProvider } from '../../api/dist/test-helpers/fake-provider.js';

const apiPort = 3000;
const webOrigin = 'http://localhost:43991';

export async function startE2eHarness() {
  if (process.env.NODE_ENV !== 'test') throw new Error('E2E dependency injection is restricted to NODE_ENV=test');
  let systemBinary: string | undefined;
  try { systemBinary = execFileSync('which', ['mongod'], { encoding: 'utf8' }).trim() || undefined; } catch { /* download fallback */ }
  const replicaSet = await MongoMemoryReplSet.create({ binary: systemBinary ? { systemBinary } : undefined, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replicaSet.getUri(), { dbName: 'marketpulse-e2e' });
  await Promise.all([User.syncIndexes(), Rule.syncIndexes(), RuleVersion.syncIndexes(), Alert.syncIndexes(), AuditEvent.syncIndexes(), Watchlist.syncIndexes(), MetricBucket.syncIndexes()]);

  const admin = await User.create({ googleSubject: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin', role: 'admin' });
  await Watchlist.create({ symbol: 'AAPL', enabled: true });
  await Rule.create({ name: 'E2E latency', scope: { kind: 'all' }, metric: 'observedLatencyMs', operator: 'gt', threshold: 25, durationSeconds: 0, severity: 'warning', enabled: true, version: 1, creatorId: String(admin._id) });

  const provider = new FakeMarketDataProvider();
  const google = new FakeGoogleIdentityProvider({ subject: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin' });
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

  const database = { isReady: async () => (await mongoose.connection.db?.admin().ping())?.ok === 1 };
  const config = { nodeEnv: 'test' as const, port: apiPort, webOrigin, mongodbUri: replicaSet.getUri(), google: { clientId: 'fake-client', clientSecret: 'fake-secret', redirectUri: 'http://localhost:3000/api/auth/google/callback' }, alpaca: { apiKey: 'fake-key', apiSecret: 'fake-secret' }, accessTokenSecret: 'e2e-access-secret-at-least-32-characters', refreshTokenPepper: 'e2e-refresh-pepper-at-least-32-characters' };
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
  await new Promise<void>((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(apiPort, '127.0.0.1', resolve); });

  return {
    provider,
    async waitForSocket() {
      const deadline = Date.now() + 5_000;
      while ((realtime.sockets.adapter.rooms.get('workspace:default')?.size ?? 0) === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if ((realtime.sockets.adapter.rooms.get('workspace:default')?.size ?? 0) === 0) throw new Error(`Authenticated Socket.IO client did not join the workspace: ${socketErrors.join(', ') || 'no engine request received'}`);
    },
    async stop() {
      monitoring.stop(); publisher?.close(); await provider.disconnect();
      await new Promise<void>(resolve => realtime.close(() => resolve()));
      if (httpServer.listening) await new Promise<void>(resolve => httpServer.close(() => resolve()));
      await mongoose.disconnect(); await replicaSet.stop();
    },
  };
}
