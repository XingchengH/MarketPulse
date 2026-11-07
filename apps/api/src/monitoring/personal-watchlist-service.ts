import { watchlistLimit, type PersonalWatchlist, type WatchlistEntry } from '@marketpulse/contracts';
import { Types, type ClientSession } from 'mongoose';
import { AuditEvent } from '../models/audit-event.js';
import { AuthInvariant } from '../models/auth-invariant.js';
import { User } from '../models/user.js';
import { UserWatchlistEntry } from '../models/user-watchlist-entry.js';
import { redactAuditValue } from './audit-service.js';

export const STARTER_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA'] as const;
export type PersonalWatchlistAsset = Pick<WatchlistEntry, 'symbol' | 'companyName' | 'exchange' | 'assetClass'>;
export interface PersonalWatchlistMutationContext { actorId: string; requestId: string }
export type PersonalWatchlistMutationResult =
  | { status: 'updated'; watchlist: PersonalWatchlist; unionChanged: boolean }
  | { status: 'duplicate' | 'not_found' | 'limit_reached' };

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();
const userLock = (userId: string) => `watchlist:${userId}`;
const symbolLock = (symbol: string) => `watchlist-symbol:${symbol}`;
const duplicateKey = (error: unknown): error is { code: number; keyPattern?: Record<string, number> } =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

// Create invariant records before starting a snapshot, so competing first writes can
// safely retry their transactions without racing an invariant upsert inside them.
async function ensureLocks(keys: string[]): Promise<void> {
  for (const key of keys) {
    try { await AuthInvariant.updateOne({ key }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
    catch (error) { if (!duplicateKey(error)) throw error; }
  }
}
async function lock(key: string, session: ClientSession): Promise<void> {
  await AuthInvariant.updateOne({ key }, { $inc: { revision: 1 } }, { session });
}

export class PersonalWatchlistService {
  async initializeUser(inputUserId: string): Promise<void> {
    const userId = new Types.ObjectId(inputUserId);
    const key = userLock(String(userId));
    const starters = [...STARTER_SYMBOLS].sort();
    await ensureLocks([key, ...starters.map(symbolLock)]);
    await UserWatchlistEntry.db.transaction(async session => {
      await lock(key, session);
      const user = await User.findById(userId).session(session).lean();
      if (!user) throw new Error('Watchlist user not found');
      if (user.watchlistInitializedAt) return;
      // Initialization participates in the same symbol locks as regular mutations,
      // preserving accurate first/final reference decisions across different users.
      for (const symbol of starters) await lock(symbolLock(symbol), session);
      const existing = await UserWatchlistEntry.find({ userId }).select('symbol').session(session).lean();
      const symbols = new Set(existing.map(entry => entry.symbol));
      if (new Set([...symbols, ...starters]).size > watchlistLimit) throw new Error('Starter watchlist exceeds watchlist limit');
      for (const symbol of starters) {
        await UserWatchlistEntry.updateOne(
          { userId, symbol },
          { $setOnInsert: { userId, symbol, companyName: symbol, assetClass: 'us_equity' } },
          { upsert: true, runValidators: true, session },
        );
      }
      await User.updateOne({ _id: userId }, { $set: { watchlistInitializedAt: new Date() } }, { session });
    });
  }

  list(userId: string): Promise<PersonalWatchlist> { return this.readList(new Types.ObjectId(userId)); }

  async symbols(userId: string): Promise<string[]> {
    const entries = await UserWatchlistEntry.find({ userId }).select('symbol -_id').sort({ symbol: 1 }).lean();
    return entries.map(entry => entry.symbol);
  }

  async has(userId: string, symbol: string): Promise<boolean> {
    return Boolean(await UserWatchlistEntry.exists({ userId, symbol: normalizeSymbol(symbol) }));
  }

  async union(): Promise<string[]> { return (await UserWatchlistEntry.distinct('symbol')).sort(); }

  add(userId: string, asset: PersonalWatchlistAsset, context: PersonalWatchlistMutationContext): Promise<PersonalWatchlistMutationResult> {
    return this.mutate(userId, 'add', normalizeSymbol(asset.symbol), context, asset);
  }

  remove(userId: string, symbol: string, context: PersonalWatchlistMutationContext): Promise<PersonalWatchlistMutationResult> {
    return this.mutate(userId, 'remove', normalizeSymbol(symbol), context);
  }

  private async readList(userId: Types.ObjectId, session?: ClientSession): Promise<PersonalWatchlist> {
    const values = await UserWatchlistEntry.find({ userId }).sort({ symbol: 1 }).session(session ?? null).lean();
    const entries = values.map(value => ({
      id: String(value._id), symbol: value.symbol, companyName: value.companyName,
      ...(value.exchange ? { exchange: value.exchange } : {}),
      assetClass: value.assetClass, createdAt: value.createdAt.toISOString(),
    }));
    return { entries, used: entries.length, limit: watchlistLimit };
  }

  private async mutate(inputUserId: string, type: 'add' | 'remove', symbol: string, context: PersonalWatchlistMutationContext, asset?: PersonalWatchlistAsset): Promise<PersonalWatchlistMutationResult> {
    const userId = new Types.ObjectId(inputUserId);
    const key = userLock(String(userId));
    await ensureLocks([key, symbolLock(symbol)]);
    try {
      return await UserWatchlistEntry.db.transaction(async session => {
        await lock(key, session);
        await lock(symbolLock(symbol), session);
        if (!await User.exists({ _id: userId }).session(session)) throw new Error('Watchlist user not found');
        const before = await this.readList(userId, session);
        const present = before.entries.some(entry => entry.symbol === symbol);
        if (type === 'add' && present) return { status: 'duplicate' as const };
        if (type === 'remove' && !present) return { status: 'not_found' as const };
        if (type === 'add' && before.used >= watchlistLimit) return { status: 'limit_reached' as const };
        const references = await UserWatchlistEntry.countDocuments({ symbol }).session(session);
        if (type === 'add') {
          await UserWatchlistEntry.create([{
            userId, symbol, companyName: asset!.companyName, exchange: asset!.exchange, assetClass: asset!.assetClass,
          }], { session });
        } else {
          await UserWatchlistEntry.deleteOne({ userId, symbol }, { session });
        }
        const watchlist = await this.readList(userId, session);
        await AuditEvent.create([{
          actorId: context.actorId, requestId: context.requestId,
          action: `watchlist.symbol_${type === 'add' ? 'added' : 'removed'}`,
          resourceType: 'watchlist', resourceId: symbol,
          before: redactAuditValue({ userId: String(userId), symbols: before.entries.map(entry => entry.symbol) }),
          after: redactAuditValue({ userId: String(userId), symbols: watchlist.entries.map(entry => entry.symbol) }),
          createdAt: new Date(),
        }], { session });
        return { status: 'updated' as const, watchlist, unionChanged: type === 'add' ? references === 0 : references === 1 };
      });
    } catch (error) {
      // The unique index remains the final duplicate guard, including writers that
      // do not use this service's per-user transaction lock.
      if (type === 'add' && duplicateKey(error) && error.keyPattern?.userId && error.keyPattern?.symbol) return { status: 'duplicate' };
      throw error;
    }
  }
}
