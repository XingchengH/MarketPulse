import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createGracefulShutdown } from './http/shutdown.js';
import { createGoogleIdentityProvider } from './auth/google-provider.js';
import { MongooseAuthRepository } from './auth/mongoose-repository.js';

const config = loadConfig();
const database = connectDatabase(config.mongodbUri);
await database.connect();

const provider = createGoogleIdentityProvider(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
const server = createApp({ config, database, auth: { provider, repository: new MongooseAuthRepository() } }).listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

const shutdown = createGracefulShutdown({ server, database });

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
