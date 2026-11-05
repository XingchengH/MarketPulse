import { describe, expect, it, vi } from 'vitest';
import { normalizeAlpacaMessage } from './normalizer.js';
import { MarketDataAggregator } from './aggregator.js';
import { MarketClockCache } from './market-clock.js';
import { ReconnectBackoff } from './reconnect.js';

describe('Alpaca market data', () => {
  it('normalizes a trade exactly', () => {
    expect(normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 201.5, s: 3, t: '2026-11-05T17:00:00.000000Z' }, new Date('2026-11-05T17:00:00.040Z'))).toEqual({
      provider: 'alpaca', feed: 'iex', symbol: 'AAPL', type: 'trade',
      providerTimestamp: '2026-11-05T17:00:00.000Z', receivedAt: '2026-11-05T17:00:00.040Z',
      price: 201.5, size: 3,
    });
  });

  it('tracks trades, quotes, two messages/second, and a bounded latency ring', () => {
    const aggregator = new MarketDataAggregator({ latencyCapacity: 2, now: () => new Date('2026-11-05T17:00:01.000Z') });
    aggregator.ingest(normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 200, s: 2, t: '2026-11-05T17:00:00.000Z' }, new Date('2026-11-05T17:00:00.040Z'))!);
    aggregator.ingest(normalizeAlpacaMessage({ T: 'q', S: 'AAPL', bp: 199, ap: 201, bs: 4, as: 5, t: '2026-11-05T17:00:00.000Z' }, new Date('2026-11-05T17:00:00.040Z'))!);
    const snapshot = aggregator.snapshot('AAPL');
    expect(snapshot).toMatchObject({ latestTrade: { price: 200, size: 2 }, latestQuote: { bid: 199, ask: 201, bidSize: 4, askSize: 5 }, spread: 2, receivedMessagesPerSecond: 2, observedLatency: { latest: 40, p95: 40 } });
    aggregator.ingest(normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 202, s: 1, t: '2026-11-05T17:00:00.000Z' }, new Date('2026-11-05T17:00:00.050Z'))!);
    expect(aggregator.latencySampleCount('AAPL')).toBe(2);
  });

  it('does not mark data stale while the market is closed', async () => {
    const clock = new MarketClockCache(async () => ({ isOpen: false, nextOpen: '2026-11-06T14:30:00Z', nextClose: '2026-11-05T21:00:00Z' }));
    const aggregator = new MarketDataAggregator({ now: () => new Date('2026-11-05T23:00:00Z'), marketClock: clock });
    aggregator.ingest(normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 200, s: 1, t: '2026-11-05T20:00:00Z' }, new Date('2026-11-05T20:00:00Z'))!);
    expect((await aggregator.snapshotWithMarketState('AAPL')).staleDurationMs).toBe(0);
  });

  it('uses capped full jitter and only resets after a stable connection', () => {
    const backoff = new ReconnectBackoff({ random: () => 0.5, stableAfterMs: 10_000 });
    expect(backoff.nextDelay()).toBe(500);
    expect(backoff.nextDelay()).toBe(1_000);
    backoff.connected(0); backoff.disconnected(9_999);
    expect(backoff.nextDelay()).toBe(2_000);
    backoff.connected(10_000); backoff.disconnected(20_000);
    expect(backoff.nextDelay()).toBe(500);
    for (let index = 0; index < 10; index += 1) backoff.nextDelay();
    expect(backoff.nextDelay()).toBeLessThanOrEqual(30_000);
  });

  it('caches the market clock for thirty seconds', async () => {
    const fetchClock = vi.fn(async () => ({ isOpen: true, nextOpen: 'a', nextClose: 'b' }));
    let now = 0;
    const clock = new MarketClockCache(fetchClock, { now: () => now });
    await clock.get(); now = 29_999; await clock.get();
    expect(fetchClock).toHaveBeenCalledTimes(1);
    now = 30_000; await clock.get(); expect(fetchClock).toHaveBeenCalledTimes(2);
  });
});
