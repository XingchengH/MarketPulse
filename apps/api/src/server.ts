import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createGracefulShutdown } from './http/shutdown.js';
import { createGoogleIdentityProvider } from './auth/google-provider.js';
import { MongooseAuthRepository } from './auth/mongoose-repository.js';
import { AlpacaProvider } from './market-data/alpaca-provider.js';
import { MarketDataAggregator } from './market-data/aggregator.js';
import { MetricBucket, upsertMinuteBucket } from './models/metric-bucket.js';
import { Watchlist } from './models/watchlist.js';

const config = loadConfig();
const database = connectDatabase(config.mongodbUri);
await database.connect();

const provider = createGoogleIdentityProvider(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
const marketProvider = new AlpacaProvider({ apiKey: config.alpaca.apiKey, apiSecret: config.alpaca.apiSecret });
const aggregator = new MarketDataAggregator({ marketClock: { get: () => marketProvider.getMarketClock() } });
let subscribedSymbols: string[] = [];
marketProvider.onEvent(event => {
  aggregator.ingest(event);
  const snapshot = aggregator.snapshot(event.symbol);
  const bucketStart = new Date(Math.floor(Date.parse(event.receivedAt) / 60_000) * 60_000);
  void upsertMinuteBucket({ symbol: event.symbol, bucketStart, messageCount: snapshot.receivedMessagesPerSecond, latencyLatest: snapshot.observedLatency.latest, latencyP95: snapshot.observedLatency.p95, latestTrade: snapshot.latestTrade, latestQuote: snapshot.latestQuote, spread: snapshot.spread, providerErrors: snapshot.providerErrors, reconnects: snapshot.reconnects }).catch(() => undefined);
});
marketProvider.onOperationalEvent(event => {
  if (event.type === 'error') aggregator.recordProviderError(subscribedSymbols);
  if (event.type === 'reconnect') aggregator.recordReconnect(subscribedSymbols);
});
const configured = Boolean(config.alpaca.apiKey && config.alpaca.apiSecret);
if (configured) {
  const symbols = (await Watchlist.find({ enabled: true }).select('symbol').lean()) as Array<{ symbol: string }>;
  subscribedSymbols = symbols.map(item => item.symbol);
  marketProvider.replaceSubscriptions(subscribedSymbols);
  await marketProvider.connect();
}
const marketData = {
  overview: async () => ({ provider: marketProvider.name, providerState: marketProvider.state, symbols: subscribedSymbols }),
  symbols: async () => Promise.all(subscribedSymbols.map(symbol => aggregator.snapshotWithMarketState(symbol))),
  symbol: async (symbol: string) => subscribedSymbols.includes(symbol) ? aggregator.snapshotWithMarketState(symbol) : null,
  metrics: async ({ symbol, from, to }: { symbol: string; from: Date; to: Date }) => MetricBucket.find({ symbol, bucketStart: { $gte: from, $lte: to } }).sort({ bucketStart: 1 }).lean(),
};
const server = createApp({ config, database, auth: { provider, repository: new MongooseAuthRepository() }, marketData }).listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

const shutdown = createGracefulShutdown({ server, database });

process.once('SIGINT', () => void marketProvider.disconnect().then(() => shutdown('SIGINT')));
process.once('SIGTERM', () => void marketProvider.disconnect().then(() => shutdown('SIGTERM')));
