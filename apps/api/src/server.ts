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

const config = loadConfig();
const database = connectDatabase(config.mongodbUri);
await database.connect();

const provider = createGoogleIdentityProvider(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
const repository = new MongooseAuthRepository();
const tokens = createTokenService(config.accessTokenSecret, config.refreshTokenPepper);
const marketProvider = new AlpacaProvider({ apiKey: config.alpaca.apiKey, apiSecret: config.alpaca.apiSecret });
const aggregator = new MarketDataAggregator({ marketClock: { get: () => marketProvider.getMarketClock() } });
let publisher: RealtimePublisher | undefined;
const alertService = new AlertService(() => publisher?.alertsChanged());
const ruleService = new RuleService(() => publisher?.rulesChanged());
let subscribedSymbols: string[] = [];
const monitoring = new MonitoringRuntime({ snapshot: symbol => aggregator.snapshotWithMarketState(symbol), symbols: () => subscribedSymbols }, new MonitoringEvaluator(alertService), undefined, { onError: error => console.error({ component: 'monitoring', error }, 'Monitoring evaluation failure') });
const minuteWriter = new MinuteMetricWriter(upsertMinuteBucket, { onFailure: error => {
  aggregator.recordProviderError(subscribedSymbols);
  console.error({ component: 'minute-metric-writer', message: error.message }, 'Market metric persistence failure');
} });
minuteWriter.start();
marketProvider.onEvent(event => {
  aggregator.ingest(event);
  publisher?.requestSnapshots({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: subscribedSymbols, snapshot: symbol => aggregator.snapshotWithMarketState(symbol) });
  minuteWriter.ingest(event);
  void monitoring.observe(event.symbol).catch(error => console.error({ component: 'monitoring', error }, 'Monitoring evaluation failure'));
});
marketProvider.onOperationalEvent(event => {
  if (event.type === 'state') publisher?.providerState(event.state);
  if (event.type === 'error') { aggregator.recordProviderError(subscribedSymbols); minuteWriter.record('providerErrors', subscribedSymbols); }
  if (event.type === 'reconnect') { aggregator.recordReconnect(subscribedSymbols); minuteWriter.record('reconnects', subscribedSymbols); }
  void monitoring.tick();
});
const configured = Boolean(config.alpaca.apiKey && config.alpaca.apiSecret);
await bootstrapDefaultWatchlist();
const symbols = (await Watchlist.find({ enabled: true }).select('symbol').lean()) as Array<{ symbol: string }>;
subscribedSymbols = symbols.map(item => item.symbol);
monitoring.start();
if (configured) {
  await marketProvider.connect(subscribedSymbols);
}
const marketData = {
  overview: async () => ({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: subscribedSymbols }),
  symbols: async () => Promise.all(subscribedSymbols.map(symbol => aggregator.snapshotWithMarketState(symbol))),
  symbol: async (symbol: string) => subscribedSymbols.includes(symbol) ? aggregator.snapshotWithMarketState(symbol) : null,
  metrics: async ({ symbol, from, to }: { symbol: string; from: Date; to: Date }) => MetricBucket.find({ symbol, bucketStart: { $gte: from, $lte: to } }).sort({ bucketStart: 1 }).lean(),
};
const app = createApp({ config, database, auth: { provider, repository, tokens }, marketData, monitoring: { rules: ruleService, alerts: alertService } });
const server = createServer(app);
const realtime = createRealtimeServer(server, { tokens, findCurrentUser: id => repository.findUserById(id), webOrigin: config.webOrigin });
publisher = new RealtimePublisher(realtime);
server.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
publisher.overview({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: subscribedSymbols });

const shutdown = createGracefulShutdown({
  server: { close: callback => realtime.close(callback), closeAllConnections: () => server.closeAllConnections() },
  database,
});

const stop = (signal: string) => {
  monitoring.stop(); publisher?.close();
  void Promise.all([marketProvider.disconnect(), minuteWriter.stop()]).then(() => shutdown(signal));
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
