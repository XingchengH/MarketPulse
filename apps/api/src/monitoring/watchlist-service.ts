import { Watchlist } from '../models/watchlist.js';
import type { MarketDataProvider } from '../market-data/provider.js';
import { AuditEvent } from '../models/audit-event.js';
import { AuthInvariant } from '../models/auth-invariant.js';
import { redactAuditValue, type AuditInput } from './audit-service.js';

export interface WatchlistItem {
  id: string;
  symbol: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WatchlistRepository {
  list(): Promise<WatchlistItem[]>;
  mutate(mutation: { type: 'add' | 'remove'; symbol: string; audit: Omit<AuditInput, 'action' | 'resourceType' | 'resourceId' | 'before' | 'after'> }): Promise<
    { status: 'updated'; watchlist: WatchlistItem[]; before: string[] } | { status: 'duplicate' | 'not_found' | 'empty' }
  >;
}

export interface AssetLookup {
  lookupAsset(symbol: string): Promise<{ symbol: string; tradable: boolean } | null>;
}
export interface WatchlistMutationContext { actorId: string; requestId: string }

export type WatchlistResult =
  | { status: 'updated'; watchlist: WatchlistItem[] }
  | { status: 'duplicate' | 'not_found' | 'not_tradable' | 'empty' }
  | { status: 'provider_unavailable'; watchlist: WatchlistItem[] };

export class WatchlistService {
  constructor(
    private readonly repository: WatchlistRepository,
    private readonly provider: Pick<MarketDataProvider, 'replaceSubscriptions'> & AssetLookup,
    private readonly onChanged: (symbols: string[]) => void = () => undefined,
  ) {}

  list(): Promise<WatchlistItem[]> { return this.repository.list(); }

  async add(input: string, context: WatchlistMutationContext): Promise<WatchlistResult> {
    const symbol = input.trim().toUpperCase();
    let asset: Awaited<ReturnType<AssetLookup['lookupAsset']>>;
    try { asset = await this.provider.lookupAsset(symbol); }
    catch { return { status: 'provider_unavailable', watchlist: await this.repository.list() }; }
    if (!asset || !asset.tradable) return { status: 'not_tradable' };
    return this.mutateAndReplace('add', asset.symbol.toUpperCase(), context);
  }

  async remove(input: string, context: WatchlistMutationContext): Promise<WatchlistResult> {
    const symbol = input.trim().toUpperCase();
    return this.mutateAndReplace('remove', symbol, context);
  }

  private async mutateAndReplace(type: 'add' | 'remove', symbol: string, context: WatchlistMutationContext): Promise<WatchlistResult> {
    const result = await this.repository.mutate({ type, symbol, audit: context });
    if (result.status !== 'updated') return result;
    const watchlist = result.watchlist;
    const symbols = watchlist.map(item => item.symbol);
    this.onChanged(symbols);
    try {
      await this.provider.replaceSubscriptions(symbols);
      return { status: 'updated', watchlist };
    } catch {
      return { status: 'provider_unavailable', watchlist };
    }
  }
}

export const mongooseWatchlistRepository: WatchlistRepository = {
  async list() {
    const values = await Watchlist.find({ enabled: true }).sort({ symbol: 1 }).lean();
    return values.map(value => ({ id: String(value._id), symbol: value.symbol, enabled: value.enabled, createdAt: value.createdAt, updatedAt: value.updatedAt }));
  },
  async mutate(mutation) {
    await AuthInvariant.updateOne({ key: 'watchlist' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    let result: Awaited<ReturnType<WatchlistRepository['mutate']>> | undefined;
    await Watchlist.db.transaction(async session => {
      await AuthInvariant.updateOne({ key: 'watchlist' }, { $inc: { revision: 1 } }, { session });
      const current = await Watchlist.find({ enabled: true }).sort({ symbol: 1 }).session(session).lean();
      const before = current.map(item => item.symbol);
      if (mutation.type === 'add' && before.includes(mutation.symbol)) { result = { status: 'duplicate' }; return; }
      if (mutation.type === 'remove' && !before.includes(mutation.symbol)) { result = { status: 'not_found' }; return; }
      if (mutation.type === 'remove' && before.length === 1) { result = { status: 'empty' }; return; }
      const symbols = mutation.type === 'add' ? [...before, mutation.symbol].sort() : before.filter(symbol => symbol !== mutation.symbol);
      await Watchlist.updateMany({}, { $set: { enabled: false } }, { session });
      for (const symbol of symbols) await Watchlist.updateOne({ symbol }, { $set: { enabled: true }, $setOnInsert: { symbol } }, { upsert: true, session });
      const audit = { ...mutation.audit, action: `watchlist.symbol_${mutation.type === 'add' ? 'added' : 'removed'}`, resourceType: 'watchlist', resourceId: mutation.symbol, before: { symbols: before }, after: { symbols } };
      await AuditEvent.create([{ ...audit, before: redactAuditValue(audit.before), after: redactAuditValue(audit.after), createdAt: audit.createdAt ?? new Date() }], { session });
      const committed = await Watchlist.find({ enabled: true }).sort({ symbol: 1 }).session(session).lean();
      result = { status: 'updated', before, watchlist: committed.map(value => ({ id: String(value._id), symbol: value.symbol, enabled: value.enabled, createdAt: value.createdAt, updatedAt: value.updatedAt })) };
    });
    if (!result) throw new Error('Watchlist transaction completed without a result');
    return result;
  },
};
