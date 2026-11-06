import { Watchlist } from '../models/watchlist.js';
import type { MarketDataProvider } from '../market-data/provider.js';

export interface WatchlistItem {
  id: string;
  symbol: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WatchlistRepository {
  list(): Promise<WatchlistItem[]>;
  replace(symbols: string[]): Promise<WatchlistItem[]>;
}

export interface AssetLookup {
  lookupAsset(symbol: string): Promise<{ symbol: string; tradable: boolean } | null>;
}

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

  async add(input: string): Promise<WatchlistResult> {
    const symbol = input.trim().toUpperCase();
    const current = await this.repository.list();
    if (current.some(item => item.symbol === symbol)) return { status: 'duplicate' };
    let asset: Awaited<ReturnType<AssetLookup['lookupAsset']>>;
    try { asset = await this.provider.lookupAsset(symbol); }
    catch { return { status: 'provider_unavailable', watchlist: current }; }
    if (!asset || !asset.tradable) return { status: 'not_tradable' };
    return this.persistAndReplace([...current.map(item => item.symbol), asset.symbol.toUpperCase()]);
  }

  async remove(input: string): Promise<WatchlistResult> {
    const symbol = input.trim().toUpperCase();
    const current = await this.repository.list();
    if (!current.some(item => item.symbol === symbol)) return { status: 'not_found' };
    if (current.length === 1) return { status: 'empty' };
    return this.persistAndReplace(current.filter(item => item.symbol !== symbol).map(item => item.symbol));
  }

  private async persistAndReplace(symbols: string[]): Promise<WatchlistResult> {
    const watchlist = await this.repository.replace(symbols);
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
  async replace(symbols) {
    await Watchlist.db.transaction(async session => {
      await Watchlist.updateMany({}, { $set: { enabled: false } }, { session });
      for (const symbol of symbols) await Watchlist.updateOne({ symbol }, { $set: { enabled: true }, $setOnInsert: { symbol } }, { upsert: true, session });
    });
    return this.list();
  },
};
