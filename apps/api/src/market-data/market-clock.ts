import type { MarketClock } from './provider.js';

export class MarketClockCache {
  private cached?: { value: MarketClock; expiresAt: number };
  private pending?: Promise<MarketClock>;
  constructor(private readonly fetchClock: () => Promise<MarketClock>, private readonly options: { now?: () => number; ttlMs?: number; timeoutMs?: number } = {}) {}
  async get(): Promise<MarketClock> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now < this.cached.expiresAt) return this.cached.value;
    if (this.pending) return this.pending;
    let timeout: ReturnType<typeof setTimeout>;
    this.pending = Promise.race([
      this.fetchClock(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Market clock request timed out')), this.options.timeoutMs ?? 3_000); }),
    ]).then(value => { this.cached = { value, expiresAt: (this.options.now ?? Date.now)() + (this.options.ttlMs ?? 30_000) }; return value; })
      .finally(() => { clearTimeout(timeout); this.pending = undefined; });
    return this.pending;
  }
}
