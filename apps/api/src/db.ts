import mongoose from 'mongoose';

export interface Database {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): Promise<boolean>;
}

interface DatabaseClient {
  connect(): Promise<unknown>;
  close(): Promise<unknown>;
  db(): {
    command(command: { ping: 1 }, options: { maxTimeMS: number; signal: AbortSignal }): Promise<unknown>;
  };
}

interface DatabaseOptions {
  client?: DatabaseClient;
  pingTimeoutMs?: number;
}

export function connectDatabase(uri: string, options: DatabaseOptions = {}): Database {
  const injectedClient = options.client;
  let client = injectedClient;
  const ownsClient = injectedClient === undefined;
  const pingTimeoutMs = options.pingTimeoutMs ?? 1_000;

  async function probe(): Promise<boolean> {
    try {
      if (!client) return false;
      const signal = AbortSignal.timeout(pingTimeoutMs);
      await client.db().command({ ping: 1 }, { maxTimeMS: pingTimeoutMs, signal });
      return true;
    } catch {
      return false;
    }
  }

  return {
    async connect() {
      if (ownsClient) {
        await mongoose.connect(uri);
        client = mongoose.connection.getClient();
      } else {
        await injectedClient!.connect();
      }
      if (!(await probe())) {
        throw new Error('MongoDB readiness probe failed during connection');
      }
    },
    async disconnect() {
      if (ownsClient) await mongoose.disconnect();
      else await client?.close();
    },
    isReady: probe,
  };
}
