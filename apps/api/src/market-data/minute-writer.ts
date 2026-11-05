import type { MarketEvent } from '@marketpulse/contracts';

export interface MinuteMetric {
  symbol: string; bucketStart: Date; messageCount: number; receivedMessagesPerSecond: number;
  latencyLatest: number; latencyP95: number; staleDurationMs: number;
  latestTrade?: { price: number; size: number }; latestQuote?: { bid: number; ask: number }; spread?: number;
  providerErrors: number; reconnects: number;
}
interface Bucket extends MinuteMetric { latencies: number[]; lastEventAt: number }
export class MinuteMetricWriter {
  private readonly buckets = new Map<string, Bucket>(); private chain = Promise.resolve(); private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly write: (metric: MinuteMetric) => Promise<void>, private readonly options: { now?: () => number; maxBuckets?: number; flushMs?: number; retries?: number; onFailure?: (error: Error) => void } = {}) {}
  start() { if (!this.timer) this.timer = setInterval(() => void this.flushCompleted(), this.options.flushMs ?? 1_000); }
  ingest(event: MarketEvent) {
    const at = Date.parse(event.receivedAt); const bucketAt = Math.floor(at / 60_000) * 60_000; const key = `${event.symbol}:${bucketAt}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= (this.options.maxBuckets ?? 1_000)) this.buckets.delete(this.buckets.keys().next().value!);
      bucket = { symbol: event.symbol, bucketStart: new Date(bucketAt), messageCount: 0, receivedMessagesPerSecond: 0, latencyLatest: 0, latencyP95: 0, staleDurationMs: 0, providerErrors: 0, reconnects: 0, latencies: [], lastEventAt: at }; this.buckets.set(key, bucket);
    }
    bucket.messageCount += 1; bucket.receivedMessagesPerSecond = bucket.messageCount / 60; bucket.lastEventAt = at;
    const latency = Math.max(0, at - Date.parse(event.providerTimestamp)); bucket.latencyLatest = latency; bucket.latencies.push(latency);
    const sorted = [...bucket.latencies].sort((a, b) => a - b); bucket.latencyP95 = sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0;
    if (event.type === 'trade') bucket.latestTrade = { price: event.price, size: event.size };
    else { bucket.latestQuote = { bid: event.bid, ask: event.ask }; bucket.spread = event.ask - event.bid; }
  }
  record(kind: 'providerErrors' | 'reconnects', symbols: readonly string[]) { const minute = Math.floor((this.options.now ?? Date.now)() / 60_000) * 60_000; for (const symbol of symbols) { const key = `${symbol}:${minute}`; let bucket = this.buckets.get(key); if (!bucket) { bucket = { symbol, bucketStart: new Date(minute), messageCount: 0, receivedMessagesPerSecond: 0, latencyLatest: 0, latencyP95: 0, staleDurationMs: 0, providerErrors: 0, reconnects: 0, latencies: [], lastEventAt: minute }; this.buckets.set(key, bucket); } bucket[kind] += 1; } }
  async flushCompleted(includeCurrent = false) {
    const now = (this.options.now ?? Date.now)(); const current = Math.floor(now / 60_000) * 60_000;
    const due = [...this.buckets.entries()].filter(([, value]) => includeCurrent || value.bucketStart.valueOf() < current);
    for (const [key, bucket] of due) { this.buckets.delete(key); bucket.staleDurationMs = Math.max(0, Math.min(60_000, bucket.bucketStart.valueOf() + 60_000 - bucket.lastEventAt)); const { latencies: _, lastEventAt: __, ...metric } = bucket; this.chain = this.chain.then(() => this.writeWithRetry(metric)); }
    await this.chain;
  }
  private async writeWithRetry(metric: MinuteMetric) { let error: unknown; for (let attempt = 0; attempt <= (this.options.retries ?? 2); attempt += 1) { try { await this.write(metric); return; } catch (caught) { error = caught; } } this.options.onFailure?.(error instanceof Error ? error : new Error('Minute metric persistence failed')); }
  async stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.flushCompleted(true); }
}
