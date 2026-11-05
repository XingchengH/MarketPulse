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

const config = loadConfig();
const database = connectDatabase(config.mongodbUri);
await database.connect();

const provider = createGoogleIdentityProvider(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
const marketProvider = new AlpacaProvider({ apiKey: config.alpaca.apiKey, apiSecret: config.alpaca.apiSecret });
const aggregator = new MarketDataAggregator({ marketClock: { get: () => marketProvider.getMarketClock() } });
let subscribedSymbols: string[] = [];
const minuteWriter = new MinuteMetricWriter(upsertMinuteBucket, { onFailure: () => aggregator.recordProviderError(subscribedSymbols) });
minuteWriter.start();
marketProvider.onEvent(event => {
  aggregator.ingest(event);
  minuteWriter.ingest(event);
});
marketProvider.onOperationalEvent(event => {
  if (event.type === 'error') { aggregator.recordProviderError(subscribedSymbols); minuteWriter.record('providerErrors', subscribedSymbols); }
  if (event.type === 'reconnect') { aggregator.recordReconnect(subscribedSymbols); minuteWriter.record('reconnects', subscribedSymbols); }
});
const configured = Boolean(config.alpaca.apiKey && config.alpaca.apiSecret);
await bootstrapDefaultWatchlist();
const symbols = (await Watchlist.find({ enabled: true }).select('symbol').lean()) as Array<{ symbol: string }>;
subscribedSymbols = symbols.map(item => item.symbol);
if (configured) {
  await marketProvider.connect(subscribedSymbols);
}
const marketData = {
  overview: async () => ({ provider: marketProvider.name, providerState: marketProvider.state(), symbols: subscribedSymbols }),
  symbols: async () => Promise.all(subscribedSymbols.map(symbol => aggregator.snapshotWithMarketState(symbol))),
  symbol: async (symbol: string) => subscribedSymbols.includes(symbol) ? aggregator.snapshotWithMarketState(symbol) : null,
  metrics: async ({ symbol, from, to }: { symbol: string; from: Date; to: Date }) => MetricBucket.find({ symbol, bucketStart: { $gte: from, $lte: to } }).sort({ bucketStart: 1 }).lean(),
};
const server = createApp({ config, database, auth: { provider, repository: new MongooseAuthRepository() }, marketData }).listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

const shutdown = createGracefulShutdown({ server, database });

process.once('SIGINT', () => void Promise.all([marketProvider.disconnect(), minuteWriter.stop()]).then(() => shutdown('SIGINT')));
process.once('SIGTERM', () => void Promise.all([marketProvider.disconnect(), minuteWriter.stop()]).then(() => shutdown('SIGTERM')));
