import type { MarketEvent } from '@marketpulse/contracts';

export interface MinuteMetric {
  symbol: string; bucketStart: Date; messageCount: number; receivedMessagesPerSecond: number;
  latencyLatest: number; latencyP95: number; staleDurationMs: number;
  latestTrade?: { price: number; size: number }; latestQuote?: { bid: number; ask: number }; spread?: number;
  providerErrors: number; reconnects: number;
}
interface Bucket extends MinuteMetric { latencies: number[]; lastEventAt: number }
export class MinuteMetricWriter {
  private readonly buckets = new Map<string, Bucket>(); private readonly flushing = new Set<string>(); private chain = Promise.resolve(); private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly write: (metric: MinuteMetric) => Promise<void>, private readonly options: { now?: () => number; maxBuckets?: number; latencyCapacity?: number; flushMs?: number; retries?: number; retryBaseMs?: number; sleep?: (ms: number) => Promise<void>; onFailure?: (error: Error) => void } = {}) {}
  start() { if (!this.timer) this.timer = setInterval(() => void this.flushCompleted(), this.options.flushMs ?? 1_000); }
  ingest(event: MarketEvent) {
    const at = Date.parse(event.receivedAt); const bucketAt = Math.floor(at / 60_000) * 60_000; const key = `${event.symbol}:${bucketAt}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= (this.options.maxBuckets ?? 1_000)) { this.options.onFailure?.(new Error('Minute metric buffer capacity reached')); return; }
      bucket = { symbol: event.symbol, bucketStart: new Date(bucketAt), messageCount: 0, receivedMessagesPerSecond: 0, latencyLatest: 0, latencyP95: 0, staleDurationMs: 0, providerErrors: 0, reconnects: 0, latencies: [], lastEventAt: at }; this.buckets.set(key, bucket);
    }
    bucket.messageCount += 1; bucket.receivedMessagesPerSecond = bucket.messageCount / 60; bucket.lastEventAt = at;
    const latency = Math.max(0, at - Date.parse(event.providerTimestamp)); bucket.latencyLatest = latency;
    if (bucket.latencies.length === (this.options.latencyCapacity ?? 512)) bucket.latencies.shift(); bucket.latencies.push(latency);
    if (event.type === 'trade') bucket.latestTrade = { price: event.price, size: event.size };
    else { bucket.latestQuote = { bid: event.bid, ask: event.ask }; bucket.spread = event.ask - event.bid; }
  }
  record(kind: 'providerErrors' | 'reconnects', symbols: readonly string[]) { const minute = Math.floor((this.options.now ?? Date.now)() / 60_000) * 60_000; for (const symbol of symbols) { const key = `${symbol}:${minute}`; let bucket = this.buckets.get(key); if (!bucket) { bucket = { symbol, bucketStart: new Date(minute), messageCount: 0, receivedMessagesPerSecond: 0, latencyLatest: 0, latencyP95: 0, staleDurationMs: 0, providerErrors: 0, reconnects: 0, latencies: [], lastEventAt: minute }; this.buckets.set(key, bucket); } bucket[kind] += 1; } }
  async flushCompleted(includeCurrent = false) {
    const now = (this.options.now ?? Date.now)(); const current = Math.floor(now / 60_000) * 60_000;
    const due = [...this.buckets.entries()].filter(([key, value]) => !this.flushing.has(key) && (includeCurrent || value.bucketStart.valueOf() < current));
    for (const [key, bucket] of due) {
      this.flushing.add(key); bucket.staleDurationMs = Math.max(0, Math.min(60_000, bucket.bucketStart.valueOf() + 60_000 - bucket.lastEventAt));
      const sorted = [...bucket.latencies].sort((a, b) => a - b); bucket.latencyP95 = sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0;
      const { latencies: _, lastEventAt: __, ...metric } = bucket;
      this.chain = this.chain.then(async () => { if (await this.writeWithRetry(metric)) this.buckets.delete(key); this.flushing.delete(key); });
    }
    await this.chain;
  }
  private async writeWithRetry(metric: MinuteMetric): Promise<boolean> { let error: unknown; const retries = this.options.retries ?? 2; for (let attempt = 0; attempt <= retries; attempt += 1) { try { await this.write(metric); return true; } catch (caught) { error = caught; if (attempt < retries) await (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(Math.min(1_000, (this.options.retryBaseMs ?? 50) * 2 ** attempt)); } } this.options.onFailure?.(new Error('Minute metric persistence failed', { cause: error })); return false; }
  latencySampleCount(symbol: string, bucketStart: number) { return this.buckets.get(`${symbol}:${bucketStart}`)?.latencies.length ?? 0; }
  async stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.flushCompleted(true); }
}
