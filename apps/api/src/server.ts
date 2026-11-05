import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createGracefulShutdown } from './http/shutdown.js';

const config = loadConfig();
const database = connectDatabase(config.mongodbUri);
await database.connect();

const server = createApp({ config, database }).listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

const shutdown = createGracefulShutdown({ server, database });

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
