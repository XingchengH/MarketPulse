import { describe, expect, it } from 'vitest';
import {
  assetSearchResultSchema,
  marketEventSchema,
  personalWatchlistSchema,
  roleSchema,
  ruleInputSchema,
  ruleMetricSchema,
  ruleOperatorSchema,
  watchlistChangedEventSchema,
  watchlistEntrySchema,
} from './index.js';

describe('shared contracts', () => {
  it('accepts an asset search result', () => {
    const result = {
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      exchange: 'NASDAQ',
      assetClass: 'us_equity',
      tradable: true,
      inWatchlist: false,
    };
    expect(assetSearchResultSchema.parse(result)).toEqual(result);
  });

  it('accepts an empty personal watchlist', () => {
    const watchlist = { entries: [], limit: 25, used: 0 };
    expect(personalWatchlistSchema.parse(watchlist)).toEqual(watchlist);
  });

  it('accepts a watchlist change event', () => {
    const event = { symbols: ['AAPL'], used: 1, limit: 25, at: new Date().toISOString() };
    expect(watchlistChangedEventSchema.parse(event)).toEqual(event);
  });

  it('validates asset fields and accepts optional exchange', () => {
    const asset = { symbol: 'BRK.B', companyName: 'Berkshire Hathaway', assetClass: 'us_equity', tradable: true, inWatchlist: false };
    expect(assetSearchResultSchema.safeParse(asset).success).toBe(true);
    expect(assetSearchResultSchema.safeParse({ ...asset, symbol: 'BF-B' }).success).toBe(true);
    for (const invalid of [
      { symbol: 'aapl' }, { symbol: '1AAPL' }, { symbol: '' },
      { companyName: '' }, { exchange: '' }, { assetClass: 'crypto' },
      { tradable: false }, { inWatchlist: 'false' },
    ]) {
      expect(assetSearchResultSchema.safeParse({ ...asset, ...invalid }).success).toBe(false);
    }
  });

  it('accepts persisted entries and enforces watchlist boundaries', () => {
    const entry = { id: 'entry-1', symbol: 'AAPL', companyName: 'Apple Inc.', assetClass: 'us_equity', createdAt: '2026-11-04T20:00:00.000Z' };
    expect(watchlistEntrySchema.parse(entry)).toEqual(entry);
    expect(watchlistEntrySchema.safeParse({ ...entry, createdAt: 'yesterday' }).success).toBe(false);
    expect(personalWatchlistSchema.safeParse({ entries: Array(25).fill(entry), used: 25, limit: 25 }).success).toBe(true);
    expect(personalWatchlistSchema.safeParse({ entries: Array(26).fill(entry), used: 25, limit: 25 }).success).toBe(false);
    for (const used of [-1, 0.5, 26]) {
      expect(personalWatchlistSchema.safeParse({ entries: [], used, limit: 25 }).success).toBe(false);
      expect(watchlistChangedEventSchema.safeParse({ symbols: [], used, limit: 25, at: entry.createdAt }).success).toBe(false);
    }
    expect(personalWatchlistSchema.safeParse({ entries: [], used: 0, limit: 26 }).success).toBe(false);
    expect(watchlistChangedEventSchema.safeParse({ symbols: Array(26).fill('AAPL'), used: 25, limit: 25, at: entry.createdAt }).success).toBe(false);
    expect(watchlistChangedEventSchema.safeParse({ symbols: ['aapl'], used: 1, limit: 25, at: entry.createdAt }).success).toBe(false);
    expect(watchlistChangedEventSchema.safeParse({ symbols: [], used: 0, limit: 26, at: entry.createdAt }).success).toBe(false);
    expect(watchlistChangedEventSchema.safeParse({ symbols: [], used: 0, limit: 25, at: 'yesterday' }).success).toBe(false);
  });

  it('exports the canonical rule metric and operator enums', () => {
    expect(ruleMetricSchema.options).toEqual([
      'observedLatencyMs',
      'messagesPerSecond',
      'lastEventAgeSeconds',
      'providerErrors',
      'reconnects',
    ]);
    expect(ruleOperatorSchema.options).toEqual(['gt', 'gte', 'lt', 'lte']);
  });

  it('accepts a normalized market trade', () => {
    expect(
      marketEventSchema.parse({
        provider: 'alpaca',
        feed: 'iex',
        symbol: 'AAPL',
        type: 'trade',
        providerTimestamp: '2026-11-04T20:00:00.000Z',
        receivedAt: '2026-11-04T20:00:00.025Z',
        price: 201.5,
        size: 100,
      }),
    ).toEqual({
      provider: 'alpaca',
      feed: 'iex',
      symbol: 'AAPL',
      type: 'trade',
      providerTimestamp: '2026-11-04T20:00:00.000Z',
      receivedAt: '2026-11-04T20:00:00.025Z',
      price: 201.5,
      size: 100,
    });
  });

  it("rejects the unsupported 'owner' role", () => {
    expect(roleSchema.safeParse('owner').success).toBe(false);
  });

  it('rejects a zero-second rule duration', () => {
    expect(
      ruleInputSchema.safeParse({
        name: 'Latency',
        scope: { kind: 'all' },
        metric: 'observedLatencyMs',
        operator: 'gt',
        threshold: 100,
        durationSeconds: 0,
        severity: 'critical',
        enabled: true,
      }).success,
    ).toBe(false);
  });
});
