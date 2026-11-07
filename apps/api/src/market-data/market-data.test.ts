import { describe, expect, it, vi } from 'vitest';
import { normalizeAlpacaMessage } from './normalizer.js';
import { MarketDataAggregator } from './aggregator.js';
import { MarketClockCache } from './market-clock.js';
import { ReconnectBackoff } from './reconnect.js';
import { AlpacaProvider } from './alpaca-provider.js';
import { MinuteMetricWriter } from './minute-writer.js';
import { bootstrapDefaultWatchlist, DEFAULT_WATCHLIST } from '../models/watchlist.js';

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

  it('single-flights concurrent clock cache misses', async () => {
    let resolve!: (value: { isOpen: boolean; nextOpen: string; nextClose: string }) => void;
    const fetchClock = vi.fn(() => new Promise<{ isOpen: boolean; nextOpen: string; nextClose: string }>(done => { resolve = done; }));
    const clock = new MarketClockCache(fetchClock, { timeoutMs: 1_000 });
    const first = clock.get(); const second = clock.get();
    expect(fetchClock).toHaveBeenCalledTimes(1);
    resolve({ isOpen: true, nextOpen: 'a', nextClose: 'b' });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('preserves snapshots with explicit unknown clock state on an initial clock failure', async () => {
    const aggregator = new MarketDataAggregator({ marketClock: new MarketClockCache(async () => { throw new Error('clock unavailable'); }) });
    await expect(aggregator.snapshotWithMarketState('AAPL')).resolves.toMatchObject({ symbol: 'AAPL', marketClock: null, marketClockStatus: 'unavailable' });
  });

  it('uses a bounded last-known clock and surfaces degradation after a refresh failure', async () => {
    let now = 0; let fail = false;
    const clock = new MarketClockCache(async () => {
      if (fail) throw new Error('clock unavailable');
      return { isOpen: false, nextOpen: 'a', nextClose: 'b' };
    }, { now: () => now, ttlMs: 10, staleIfErrorMs: 100 });
    await clock.get(); fail = true; now = 11;
    await expect(clock.get()).resolves.toMatchObject({ isOpen: false, status: 'degraded', staleAgeMs: 11 });
    now = 101;
    await expect(clock.get()).rejects.toThrow('clock unavailable');
  });

  it('handles Alpaca status and subscription control acknowledgements', async () => {
    const sent: string[] = [];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ is_open: false, next_open: 'a', next_close: 'b' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const listeners = new Map<string, (event: { data?: unknown }) => void>();
    let reconnect: (() => void) | undefined;
    const socket = {
      send: (value: string) => sent.push(value), close: vi.fn(() => listeners.get('close')?.({})),
      addEventListener: (type: 'open' | 'close' | 'message' | 'error', listener: (event: { data?: unknown }) => void) => { listeners.set(type, listener); },
    };
    const provider = new AlpacaProvider({ apiKey: 'key', apiSecret: 'secret', socketFactory: () => socket, fetch: fetcher as typeof fetch, setTimeout: callback => { reconnect = callback; return 1; }, clearTimeout: vi.fn() });
    await provider.connect(['AAPL']);
    expect(provider.state()).toBe('connecting');
    listeners.get('open')?.({});
    expect(JSON.parse(sent[0])).toEqual({ action: 'auth', key: 'key', secret: 'secret' });
    listeners.get('message')?.({ data: JSON.stringify([{ T: 'success', msg: 'connected' }]) });
    expect(provider.state()).toBe('connecting');
    listeners.get('message')?.({ data: JSON.stringify([{ T: 'success', msg: 'authenticated' }]) });
    expect(JSON.parse(sent[1])).toEqual({ action: 'subscribe', trades: ['AAPL'], quotes: ['AAPL'] });
    listeners.get('message')?.({ data: JSON.stringify([{ T: 'subscription', trades: ['AAPL'], quotes: ['AAPL'], bars: [] }]) });
    expect(provider.state()).toBe('connected');
    await provider.getMarketClock();
    expect(provider.state()).toBe('market_closed');
    expect(fetcher).toHaveBeenCalledWith('https://paper-api.alpaca.markets/v2/clock', expect.any(Object));
    await provider.replaceSubscriptions(['MSFT']);
    expect(sent.slice(-2).map(value => JSON.parse(value))).toEqual([
      { action: 'unsubscribe', trades: ['AAPL'], quotes: ['AAPL'] },
      { action: 'subscribe', trades: ['MSFT'], quotes: ['MSFT'] },
    ]);
    listeners.get('message')?.({ data: JSON.stringify([{ T: 'error', code: 407, msg: 'slow client' }]) });
    expect(socket.close).toHaveBeenCalledOnce(); expect(provider.state()).toBe('reconnecting'); expect(reconnect).toBeTypeOf('function');
    await provider.disconnect();
  });

  it('cancels reconnect and ignores obsolete socket events on shutdown', async () => {
    const listeners = new Map<string, (event: { data?: unknown }) => void>(); let timer: unknown; const clear = vi.fn(); const events = vi.fn();
    const socket = { send: vi.fn(), close: vi.fn(), addEventListener: (type: 'open' | 'close' | 'message' | 'error', listener: (event: { data?: unknown }) => void) => { listeners.set(type, listener); } };
    const provider = new AlpacaProvider({ apiKey: 'key', apiSecret: 'secret', socketFactory: () => socket, setTimeout: callback => { timer = callback; return 1; }, clearTimeout: clear });
    provider.onEvent(events); await provider.connect(['AAPL']); listeners.get('close')?.({});
    expect(provider.state()).toBe('reconnecting'); await provider.disconnect();
    expect(clear).toHaveBeenCalledWith(1); (timer as (() => void))();
    listeners.get('message')?.({ data: JSON.stringify([{ T: 't', S: 'AAPL', p: 1, s: 1, t: '2026-11-05T17:00:00Z' }]) });
    expect(events).not.toHaveBeenCalled(); expect(socket.close).not.toHaveBeenCalled();
  });

  it('rotates and serializes minute metrics with retries', async () => {
    const written: unknown[] = []; const write = vi.fn(async value => { written.push(value); });
    const writer = new MinuteMetricWriter(write, { now: () => Date.parse('2026-11-05T17:01:00Z') });
    writer.ingest(normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 1, s: 1, t: '2026-11-05T17:00:00Z' }, new Date('2026-11-05T17:00:00.040Z'))!);
    writer.ingest(normalizeAlpacaMessage({ T: 'q', S: 'AAPL', bp: 1, ap: 2, t: '2026-11-05T17:00:10Z' }, new Date('2026-11-05T17:00:10.020Z'))!);
    await writer.flushCompleted();
    expect(written).toEqual([expect.objectContaining({ symbol: 'AAPL', messageCount: 2, receivedMessagesPerSecond: 2 / 60, latencyLatest: 20, latencyP95: 40, spread: 1, staleDurationMs: 49_980 })]);
  });

  it('bounds high-volume latency samples', () => {
    const writer = new MinuteMetricWriter(async () => undefined, { latencyCapacity: 64 });
    const event = normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 1, s: 1, t: '2026-11-05T17:00:00Z' }, new Date('2026-11-05T17:00:00.040Z'))!;
    for (let index = 0; index < 10_000; index += 1) writer.ingest(event);
    expect(writer.latencySampleCount('AAPL', Date.parse('2026-11-05T17:00:00Z'))).toBe(64);
  });

  it('retains an exhausted bucket and recovers on the next flush', async () => {
    let attempts = 0; const failures = vi.fn(); const sleep = vi.fn(async () => undefined);
    const writer = new MinuteMetricWriter(async () => { attempts += 1; if (attempts <= 2) throw new Error('database detail'); }, { now: () => Date.parse('2026-11-05T17:01:00Z'), retries: 1, sleep, onFailure: failures });
    writer.ingest(normalizeAlpacaMessage({ T: 't', S: 'AAPL', p: 1, s: 1, t: '2026-11-05T17:00:00Z' }, new Date('2026-11-05T17:00:00.040Z'))!);
    await writer.flushCompleted();
    expect(attempts).toBe(2); expect(sleep).toHaveBeenCalledWith(50); expect(failures).toHaveBeenCalledWith(expect.objectContaining({ message: 'Minute metric persistence failed' }));
    await writer.flushCompleted(); expect(attempts).toBe(3);
  });

  it('bootstraps defaults only for an empty watchlist', async () => {
    const empty = { countDocuments: vi.fn(async () => 0), insertMany: vi.fn(async () => []) };
    await bootstrapDefaultWatchlist(empty as never);
    expect(empty.insertMany).toHaveBeenCalledWith(DEFAULT_WATCHLIST.map(symbol => ({ symbol, enabled: true })), { ordered: false });
    const existing = { countDocuments: vi.fn(async () => 1), insertMany: vi.fn() };
    await bootstrapDefaultWatchlist(existing as never); expect(existing.insertMany).not.toHaveBeenCalled();
  });
});
