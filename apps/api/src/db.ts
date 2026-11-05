import { MongoClient } from 'mongodb';

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
  const client = options.client ?? new MongoClient(uri);
  const pingTimeoutMs = options.pingTimeoutMs ?? 1_000;

  async function probe(): Promise<boolean> {
    try {
      const signal = AbortSignal.timeout(pingTimeoutMs);
      await client.db().command({ ping: 1 }, { maxTimeMS: pingTimeoutMs, signal });
      return true;
    } catch {
      return false;
    }
  }

  return {
    async connect() {
      await client.connect();
      if (!(await probe())) {
        throw new Error('MongoDB readiness probe failed during connection');
      }
    },
    async disconnect() {
      await client.close();
    },
    isReady: probe,
  };
}
