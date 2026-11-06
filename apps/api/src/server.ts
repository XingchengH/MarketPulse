import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createGracefulShutdown } from './http/shutdown.js';
import { createGoogleIdentityProvider } from './auth/google-provider.js';
import { MongooseAuthRepository } from './auth/mongoose-repository.js';
import { AlpacaProvider } from './market-data/alpaca-provider.js';
import { MarketDataAggregator } from './market-data/aggregator.js';
import { MetricBucket, upsertMinuteBucket } from './models/metric-bucket.js';
import { bootstrapDefaultWatchlist, Watchlist } from './models/watchlist.js';
import { MinuteMetricWriter } from './market-data/minute-writer.js';
import { MonitoringEvaluator } from './monitoring/evaluator.js';
import { AlertService } from './monitoring/alert-service.js';
import { MonitoringRuntime } from './monitoring/runtime.js';
import { RuleService } from './monitoring/rule-service.js';
import { createTokenService } from './auth/tokens.js';
import { createRealtimeServer } from './realtime/socket-server.js';
import { RealtimePublisher } from './realtime/publisher.js';
import { WatchlistService, mongooseWatchlistRepository } from './monitoring/watchlist-service.js';
import { BootstrapAttempt } from './bootstrap-attempt.js';

const config = loadConfig();
const database = connectDatabase(config.mongodbUri);
const marketProvider = new AlpacaProvider({ apiKey: config.alpaca.apiKey, apiSecret: config.alpaca.apiSecret });
let application = createApp({ config, database, providerState: () => marketProvider.state() });
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
    const repository = new MongooseAuthRepository();
    const tokens = createTokenService(config.accessTokenSecret, config.refreshTokenPepper);
    const aggregator = new MarketDataAggregator({ marketClock: { get: () => marketProvider.getMarketClock() } });
    let publisher: RealtimePublisher | undefined;
    const alertService = new AlertService(() => publisher?.alertsChanged());
    const ruleService = new RuleService(() => publisher?.rulesChanged());
    let subscribedSymbols: string[] = [];
    const monitoring = new MonitoringRuntime(
      { snapshot: symbol => aggregator.snapshotWithMarketState(symbol), symbols: () => subscribedSymbols },
      new MonitoringEvaluator(alertService), undefined,
      { onError: error => console.error({ component: 'monitoring', error }, 'Monitoring evaluation failure') },
    );
    const minuteWriter = new MinuteMetricWriter(upsertMinuteBucket, { onFailure: error => {
      aggregator.recordProviderError(subscribedSymbols);
      console.error({ component: 'minute-metric-writer', message: error.message }, 'Market metric persistence failure');
    } });
    await bootstrapDefaultWatchlist();
    const symbols = (await Watchlist.find({ enabled: true }).select('symbol').lean()) as Array<{ symbol: string }>;
    subscribedSymbols = symbols.map(item => item.symbol);
    const watchlistService = new WatchlistService(mongooseWatchlistRepository, marketProvider, next => {
      subscribedSymbols = next;
      publisher?.overview({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: next });
    });
    const marketData = {
      overview: async () => ({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: subscribedSymbols }),
      symbols: async () => Promise.all(subscribedSymbols.map(symbol => aggregator.snapshotWithMarketState(symbol))),
      symbol: async (symbol: string) => subscribedSymbols.includes(symbol) ? aggregator.snapshotWithMarketState(symbol) : null,
      metrics: async ({ symbol, from, to }: { symbol: string; from: Date; to: Date }) => MetricBucket.find({ symbol, bucketStart: { $gte: from, $lte: to } }).sort({ bucketStart: 1 }).lean(),
    };
    if (config.alpaca.apiKey && config.alpaca.apiSecret) {
      await marketProvider.connect(subscribedSymbols);
      attempt.defer(() => marketProvider.disconnect());
    }
    const unsubscribeEvents = marketProvider.onEvent(event => {
      aggregator.ingest(event);
      publisher?.requestSnapshots({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: subscribedSymbols, snapshot: symbol => aggregator.snapshotWithMarketState(symbol) });
      minuteWriter.ingest(event);
      void monitoring.observe(event.symbol).catch(error => console.error({ component: 'monitoring', error }, 'Monitoring evaluation failure'));
    });
    attempt.defer(() => { unsubscribeEvents(); });
    const unsubscribeOperational = marketProvider.onOperationalEvent(event => {
      if (event.type === 'state') publisher?.providerState(event.state);
      if (event.type === 'error') { aggregator.recordProviderError(subscribedSymbols); minuteWriter.record('providerErrors', subscribedSymbols); }
      if (event.type === 'reconnect') { aggregator.recordReconnect(subscribedSymbols); minuteWriter.record('reconnects', subscribedSymbols); }
      void monitoring.tick();
    });
    attempt.defer(() => { unsubscribeOperational(); });
    minuteWriter.start();
    attempt.defer(() => minuteWriter.stop());
    monitoring.start();
    attempt.defer(() => monitoring.stop());
    const fullApplication = createApp({ config, database, providerState: () => marketProvider.state(), auth: { provider, repository, tokens }, marketData, monitoring: { rules: ruleService, alerts: alertService, watchlist: watchlistService } });
    // Socket.IO is attached only after every fallible bootstrap step above has succeeded.
    const realtime = createRealtimeServer(server, { tokens, findCurrentUser: id => repository.findUserById(id), webOrigin: config.webOrigin });
    publisher = new RealtimePublisher(realtime);
    shutdown = createGracefulShutdown({ server, socket: { close: () => new Promise<void>(resolve => realtime.close(() => resolve())) }, provider: marketProvider, monitoring: { stop: () => { monitoring.stop(); publisher?.close(); } }, metrics: { flush: () => minuteWriter.stop() }, database });
    application = fullApplication;
    attempt.commit();
    try { publisher.overview({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: subscribedSymbols }); }
    catch (error) { console.error({ component: 'realtime', error }, 'Initial overview publication failed'); }
    console.log('Database connected; application services started');
  } catch (error) {
    await attempt.rollback();
    console.error({ component: 'bootstrap', error }, 'Application initialization failed; retrying');
    if (!stopped) setTimeout(() => { initializing = false; void initialize(); }, 2_000).unref();
    return;
  }
  initializing = false;
}

void initialize();

const stop = (signal: string) => {
  stopped = true;
  if (shutdown) void shutdown(signal);
  else server.close(() => void database.disconnect());
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
