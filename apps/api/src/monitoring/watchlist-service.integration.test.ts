import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditEvent } from '../models/audit-event.js';
import { AuthInvariant } from '../models/auth-invariant.js';
import { Watchlist } from '../models/watchlist.js';
import { mongooseWatchlistRepository } from './watchlist-service.js';

describe('watchlist serialized transaction invariants', () => {
  let replicaSet: MongoMemoryReplSet;
  beforeAll(async () => {
    let systemBinary: string | undefined;
    try { systemBinary = execFileSync('which', ['mongod'], { encoding: 'utf8' }).trim() || undefined; } catch { /* download fallback */ }
    replicaSet = await MongoMemoryReplSet.create({ binary: systemBinary ? { systemBinary } : undefined, replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replicaSet.getUri(), { dbName: 'watchlist-transactions' });
    await Promise.all([Watchlist.syncIndexes(), AuthInvariant.syncIndexes(), AuditEvent.syncIndexes()]);
  }, 60_000);
  beforeEach(async () => { await Promise.all([Watchlist.deleteMany({}), AuthInvariant.deleteMany({}), AuditEvent.collection.deleteMany({})]); await Watchlist.create({ symbol: 'AAPL', enabled: true }); });
  afterAll(async () => { await mongoose.disconnect(); await replicaSet?.stop(); });

  const audit = (requestId: string) => ({ actorId: 'actor', requestId });
  it('serializes simultaneous adds without losing either delta', async () => {
    await Promise.all([
      mongooseWatchlistRepository.mutate({ type: 'add', symbol: 'MSFT', audit: audit('add-msft') }),
      mongooseWatchlistRepository.mutate({ type: 'add', symbol: 'NVDA', audit: audit('add-nvda') }),
    ]);
    expect((await mongooseWatchlistRepository.list()).map(item => item.symbol)).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(await AuditEvent.countDocuments()).toBe(2);
  });
  it('serializes a simultaneous add and remove with accurate audit snapshots', async () => {
    await Watchlist.create({ symbol: 'MSFT', enabled: true });
    await Promise.all([
      mongooseWatchlistRepository.mutate({ type: 'add', symbol: 'NVDA', audit: audit('add') }),
      mongooseWatchlistRepository.mutate({ type: 'remove', symbol: 'MSFT', audit: audit('remove') }),
    ]);
    expect((await mongooseWatchlistRepository.list()).map(item => item.symbol)).toEqual(['AAPL', 'NVDA']);
    const events = await AuditEvent.find().lean();
    expect(events).toHaveLength(2);
    expect(events.some((left, leftIndex) => events.some((right, rightIndex) => leftIndex !== rightIndex && JSON.stringify(left.after) === JSON.stringify(right.before)))).toBe(true);
  });
});
