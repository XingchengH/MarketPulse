import type { MarketClock } from './provider.js';

export class MarketClockCache {
  private cached?: { value: MarketClock; expiresAt: number };
  constructor(private readonly fetchClock: () => Promise<MarketClock>, private readonly options: { now?: () => number; ttlMs?: number } = {}) {}
  async get(): Promise<MarketClock> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now < this.cached.expiresAt) return this.cached.value;
    const value = await this.fetchClock();
    this.cached = { value, expiresAt: now + (this.options.ttlMs ?? 30_000) };
    return value;
  }
}
