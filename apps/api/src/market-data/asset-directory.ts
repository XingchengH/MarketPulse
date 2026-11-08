import type { ProviderAsset } from './provider.js';

export interface AssetDirectoryProvider {
  listAssets(): Promise<ProviderAsset[]>;
}

export interface AssetSearchResult {
  symbol: string;
  companyName: string;
  exchange?: string;
  assetClass: 'us_equity';
  tradable: boolean;
}

export interface AssetDirectoryOptions {
  ttlMs?: number;
  maxStaleMs?: number;
  now?: () => number;
  maxResults?: number;
}

interface CachedAssetDirectory {
  assets: AssetSearchResult[];
  refreshedAt: number;
}

export class AssetDirectory {
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly now: () => number;
  private readonly maxResults: number;
  private cache?: CachedAssetDirectory;
  private inFlight?: Promise<CachedAssetDirectory>;

  constructor(private readonly provider: AssetDirectoryProvider, options: AssetDirectoryOptions = {}) {
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
    this.maxStaleMs = options.maxStaleMs ?? 60 * 60_000;
    this.now = options.now ?? Date.now;
    this.maxResults = options.maxResults ?? 10;
  }

  async search(query: string): Promise<AssetSearchResult[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length < 2) return [];

    const directory = await this.getDirectory();
    return directory.assets
      .map(asset => ({ asset, rank: this.rank(asset, normalizedQuery) }))
      .filter((entry): entry is { asset: AssetSearchResult; rank: number } => entry.rank !== null)
      .sort((left, right) => left.rank - right.rank || (left.asset.symbol < right.asset.symbol ? -1 : left.asset.symbol > right.asset.symbol ? 1 : 0))
      .slice(0, this.maxResults)
      .map(({ asset }) => asset);
  }

  private rank(asset: AssetSearchResult, query: string): number | null {
    const symbol = asset.symbol.toLowerCase();
    const companyName = asset.companyName.toLowerCase();
    if (symbol === query) return 0;
    if (symbol.startsWith(query)) return 1;
    if (companyName.startsWith(query)) return 2;
    if (companyName.includes(query)) return 3;
    return null;
  }

  private async getDirectory(): Promise<CachedAssetDirectory> {
    const now = this.now();
    if (this.cache && now - this.cache.refreshedAt < this.ttlMs) return this.cache;
    try {
      return await this.refresh();
    } catch (error) {
      if (this.cache && this.now() - this.cache.refreshedAt <= this.maxStaleMs) return this.cache;
      throw error;
    }
  }

  private refresh(): Promise<CachedAssetDirectory> {
    if (this.inFlight) return this.inFlight;
    const request = this.provider.listAssets().then(assets => {
      const refreshedAt = this.now();
      const directory: CachedAssetDirectory = { assets: assets.map(asset => this.normalize(asset)).filter((asset): asset is AssetSearchResult => asset !== null), refreshedAt };
      this.cache = directory;
      return directory;
    });
    this.inFlight = request;
    void request.finally(() => { if (this.inFlight === request) this.inFlight = undefined; }).catch(() => undefined);
    return request;
  }

  private normalize(asset: ProviderAsset): AssetSearchResult | null {
    if (!asset || asset.assetClass !== 'us_equity' || asset.status !== 'active' || asset.tradable !== true) return null;
    if (typeof asset.symbol !== 'string' || typeof asset.name !== 'string') return null;
    const symbol = asset.symbol.trim().toUpperCase();
    const companyName = asset.name.trim();
    if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(symbol) || !companyName) return null;
    const exchange = typeof asset.exchange === 'string' ? asset.exchange.trim() : undefined;
    return { symbol, companyName, ...(exchange ? { exchange } : {}), assetClass: 'us_equity', tradable: true };
  }
}
