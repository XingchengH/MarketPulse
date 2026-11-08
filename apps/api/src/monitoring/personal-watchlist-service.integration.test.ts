import { execFileSync } from 'node:child_process';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { personalWatchlistSchema, watchlistLimit } from '@marketpulse/contracts';
import { AuditEvent } from '../models/audit-event.js';
import { AuthInvariant } from '../models/auth-invariant.js';
import { User } from '../models/user.js';
import { UserWatchlistEntry } from '../models/user-watchlist-entry.js';
import { PersonalWatchlistService, STARTER_SYMBOLS } from './personal-watchlist-service.js';

describe('personal watchlist persistence', () => {
  let replicaSet: MongoMemoryReplSet;
  const service = new PersonalWatchlistService();
  const asset = (symbol: string) => ({ symbol, companyName: `Company ${symbol}`, exchange: 'NASDAQ', assetClass: 'us_equity' as const });
  const audit = (requestId = 'request') => ({ actorId: 'actor', requestId });
  const createUser = async (subject = 'one') => String((await User.create({ googleSubject: subject, email: `${subject}@example.com`, name: subject }))._id);

  beforeAll(async () => {
    let systemBinary: string | undefined;
    try { systemBinary = execFileSync('which', ['mongod'], { encoding: 'utf8' }).trim() || undefined; } catch { /* download fallback */ }
    replicaSet = await MongoMemoryReplSet.create({ binary: systemBinary ? { systemBinary } : undefined, replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replicaSet.getUri(), { dbName: 'personal-watchlist-transactions' });
    await Promise.all([User.syncIndexes(), UserWatchlistEntry.syncIndexes(), AuthInvariant.syncIndexes(), AuditEvent.syncIndexes()]);
  }, 60_000);
  beforeEach(async () => { await Promise.all([User.deleteMany({}), UserWatchlistEntry.deleteMany({}), AuthInvariant.deleteMany({}), AuditEvent.collection.deleteMany({})]); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await mongoose.disconnect(); await replicaSet?.stop(); });

  it('keeps users separate and exposes contract-shaped entries and indexed membership/reference queries', async () => {
    const first = await createUser();
    const second = await createUser('two');
    expect((await service.add(first, asset('AAPL'), audit())).status).toBe('updated');
    await service.add(second, asset('MSFT'), audit());
    expect(personalWatchlistSchema.parse(await service.list(first))).toMatchObject({ used: 1, limit: 25, entries: [{ symbol: 'AAPL', companyName: 'Company AAPL', exchange: 'NASDAQ', assetClass: 'us_equity' }] });
    expect(await service.symbols(second)).toEqual(['MSFT']);
    expect(await service.has(first, ' aapl ')).toBe(true);
    expect(await service.has(second, 'AAPL')).toBe(false);
    expect(await service.union()).toEqual(['AAPL', 'MSFT']);
    const indexes = await UserWatchlistEntry.collection.indexes();
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { userId: 1, symbol: 1 }, unique: true }),
      expect.objectContaining({ key: { symbol: 1, userId: 1 } }),
    ]));
  });

  it('normalizes metadata and prevents duplicate memberships including simultaneous adds', async () => {
    const user = await createUser();
    const outcomes = await Promise.all([
      service.add(user, { ...asset(' aapl '), companyName: ' Apple ', exchange: ' NASDAQ ' }, audit('first')),
      service.add(user, asset('AAPL'), audit('second')),
    ]);
    expect(outcomes.map(result => result.status).sort()).toEqual(['duplicate', 'updated']);
    expect((await service.list(user)).used).toBe(1);
    expect(await AuditEvent.countDocuments()).toBe(1);
    await expect(UserWatchlistEntry.create({ userId: user, ...asset('aapl') })).rejects.toMatchObject({ code: 11000 });
    const entry = await UserWatchlistEntry.findOne().lean();
    expect(entry?.symbol).toBe('AAPL');
    expect(entry?.companyName).toBe(entry?.companyName.trim());
    expect(entry?.exchange).toBe('NASDAQ');
  });

  it('initializes starters exactly once under simultaneous and repeated calls', async () => {
    const user = await createUser();
    await Promise.all([service.initializeUser(user), service.initializeUser(user), service.initializeUser(user)]);
    const first = await service.list(user);
    expect(first.entries.map(entry => entry.symbol)).toEqual([...STARTER_SYMBOLS].sort());
    expect(first.entries.every(entry => Boolean(entry.companyName))).toBe(true);
    const marker = (await User.findById(user).lean())?.watchlistInitializedAt;
    expect(marker).toBeInstanceOf(Date);
    await service.initializeUser(user);
    expect(await service.list(user)).toEqual(first);
    expect((await User.findById(user).lean())?.watchlistInitializedAt).toEqual(marker);
  });

  it('leaves an initialized empty list empty and fails clearly for missing users', async () => {
    const user = await createUser();
    await service.initializeUser(user);
    for (const symbol of STARTER_SYMBOLS) expect((await service.remove(user, symbol, audit())).status).toBe('updated');
    await service.initializeUser(user);
    expect(await service.list(user)).toEqual({ entries: [], used: 0, limit: watchlistLimit });
    expect((await service.remove(user, 'AAPL', audit())).status).toBe('not_found');
    await expect(service.initializeUser(String(new Types.ObjectId()))).rejects.toThrow(/user.*not found/i);
  });

  it('rolls back starter entries and initialization marker when inserts fail', async () => {
    const user = await createUser();
    vi.spyOn(User, 'updateOne').mockRejectedValueOnce(new Error('marker unavailable') as never);
    await expect(service.initializeUser(user)).rejects.toThrow('marker unavailable');
    expect((await service.list(user)).used).toBe(0);
    expect((await User.findById(user).lean())?.watchlistInitializedAt).toBeUndefined();
    await service.initializeUser(user);
    expect((await service.list(user)).used).toBe(STARTER_SYMBOLS.length);
  });

  it('enforces the 25-entry maximum transactionally across racing adds', async () => {
    const user = await createUser();
    await UserWatchlistEntry.insertMany(Array.from({ length: 24 }, (_, index) => ({ userId: user, ...asset(`S${index}`) })));
    const outcomes = await Promise.all(['AAPL', 'MSFT', 'NVDA'].map(symbol => service.add(user, asset(symbol), audit(symbol))));
    expect(outcomes.map(result => result.status).sort()).toEqual(['limit_reached', 'limit_reached', 'updated']);
    expect((await service.list(user)).used).toBe(25);
    expect(await AuditEvent.countDocuments()).toBe(1);
    expect((await service.add(user, asset('AMZN'), audit())).status).toBe('limit_reached');
    expect((await service.add(user, asset('S0'), audit())).status).toBe('duplicate');
  });

  it('commits accurate add/remove audit snapshots and rolls both mutations back on audit failure', async () => {
    const user = await createUser();
    const added = await service.add(user, asset('AAPL'), audit('added'));
    expect(added).toMatchObject({ status: 'updated', unionChanged: true, watchlist: { used: 1 } });
    expect(await AuditEvent.findOne({ requestId: 'added' }).lean()).toMatchObject({ actorId: 'actor', action: 'watchlist.symbol_added', resourceType: 'watchlist', resourceId: 'AAPL', before: { symbols: [] }, after: { symbols: ['AAPL'] } });
    vi.spyOn(AuditEvent, 'create').mockRejectedValueOnce(new Error('audit unavailable') as never);
    await expect(service.add(user, asset('MSFT'), audit('failed-add'))).rejects.toThrow('audit unavailable');
    expect(await service.symbols(user)).toEqual(['AAPL']);
    vi.spyOn(AuditEvent, 'create').mockRejectedValueOnce(new Error('audit unavailable') as never);
    await expect(service.remove(user, 'AAPL', audit('failed-remove'))).rejects.toThrow('audit unavailable');
    expect(await service.symbols(user)).toEqual(['AAPL']);
    const removed = await service.remove(user, 'AAPL', audit('removed'));
    expect(removed).toMatchObject({ status: 'updated', unionChanged: true, watchlist: { used: 0 } });
    expect(await AuditEvent.findOne({ requestId: 'removed' }).lean()).toMatchObject({ action: 'watchlist.symbol_removed', before: { symbols: ['AAPL'] }, after: { symbols: [] } });
    expect(await AuditEvent.countDocuments()).toBe(2);
  });

  it('reports exactly one first/final union change across simultaneous mutations for different users', async () => {
    const first = await createUser();
    const second = await createUser('two');
    const adds = await Promise.all([service.add(first, asset('AAPL'), audit()), service.add(second, asset('AAPL'), audit())]);
    expect(adds.map(result => result.status === 'updated' && result.unionChanged).sort()).toEqual([false, true]);
    expect(await service.union()).toEqual(['AAPL']);
    const removals = await Promise.all([service.remove(first, 'AAPL', audit()), service.remove(second, 'AAPL', audit())]);
    expect(removals.map(result => result.status === 'updated' && result.unionChanged).sort()).toEqual([false, true]);
    expect(await service.union()).toEqual([]);
  });

  it('refreshes subscriptions only after committed initialization and mutations, retaining database state on provider failure', async () => {
    const user = await createUser();
    const observed: string[][] = [];
    const changed = vi.fn(async () => { observed.push(await service.union()); });
    const notifying = new PersonalWatchlistService(changed);
    await notifying.initializeUser(user);
    expect(observed).toEqual([[...STARTER_SYMBOLS].sort()]);
    expect(changed).toHaveBeenLastCalledWith(user);
    await notifying.initializeUser(user);
    expect(changed).toHaveBeenCalledOnce();
    vi.spyOn(AuditEvent, 'create').mockRejectedValueOnce(new Error('audit failed') as never);
    await expect(notifying.add(user, asset('F'), audit())).rejects.toThrow('audit failed');
    expect(changed).toHaveBeenCalledOnce();
    changed.mockRejectedValueOnce(new Error('provider failed'));
    await expect(notifying.add(user, asset('F'), audit())).rejects.toThrow('provider failed');
    expect(await service.has(user, 'F')).toBe(true);
    await notifying.remove(user, 'F', audit());
    expect(observed.at(-1)).toEqual([...STARTER_SYMBOLS].sort());
    expect(changed).toHaveBeenLastCalledWith(user);
    await notifying.remove(user, 'F', audit());
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
