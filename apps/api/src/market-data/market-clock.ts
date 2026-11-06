import type { MarketClock } from './provider.js';

export class MarketClockCache {
  private cached?: { value: MarketClock; fetchedAt: number; expiresAt: number };
  private pending?: Promise<MarketClock>;
  constructor(private readonly fetchClock: () => Promise<MarketClock>, private readonly options: { now?: () => number; ttlMs?: number; staleIfErrorMs?: number; timeoutMs?: number } = {}) {}
  async get(): Promise<MarketClock> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now < this.cached.expiresAt) return { ...this.cached.value, status: 'current', fetchedAt: new Date(this.cached.fetchedAt).toISOString(), staleAgeMs: now - this.cached.fetchedAt };
    if (this.pending) return this.pending;
    let timeout: ReturnType<typeof setTimeout>;
    this.pending = Promise.race([
      this.fetchClock(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Market clock request timed out')), this.options.timeoutMs ?? 3_000); }),
    ]).then(value => {
      const fetchedAt = (this.options.now ?? Date.now)();
      this.cached = { value, fetchedAt, expiresAt: fetchedAt + (this.options.ttlMs ?? 30_000) };
      return { ...value, status: 'current' as const, fetchedAt: new Date(fetchedAt).toISOString(), staleAgeMs: 0 };
    }).catch(error => {
      const failedAt = (this.options.now ?? Date.now)();
      if (this.cached && failedAt - this.cached.fetchedAt <= (this.options.staleIfErrorMs ?? 5 * 60_000)) {
        return { ...this.cached.value, status: 'degraded' as const, fetchedAt: new Date(this.cached.fetchedAt).toISOString(), staleAgeMs: failedAt - this.cached.fetchedAt };
      }
      throw error;
    })
      .finally(() => { clearTimeout(timeout); this.pending = undefined; });
    return this.pending;
  }
}
