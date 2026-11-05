import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';

const config = loadConfig();
const database = connectDatabase(config.mongodbUri);
await database.connect();

const server = createApp({ config, database }).listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await database.disconnect();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
