import { MongoClient } from 'mongodb';

export interface Database {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): boolean;
}

export function connectDatabase(uri: string): Database {
  const client = new MongoClient(uri);
  let ready = false;

  return {
    async connect() {
      try {
        await client.connect();
        await client.db().command({ ping: 1 });
        ready = true;
      } catch (error) {
        ready = false;
        throw error;
      }
    },
    async disconnect() {
      ready = false;
      await client.close();
    },
    isReady() {
      return ready;
    },
  };
}
