import { describe, expect, it } from 'vitest';
import { MonitoringEvaluator } from './evaluator.js';
import { MonitoringRuntime } from './runtime.js';
import { MarketDataAggregator } from '../market-data/aggregator.js';

describe('MonitoringRuntime', () => {
  it('turns stream snapshots into an alert and then recovery on a bounded cadence', async () => {
    let now = 1_000; const events: string[] = [];
    const source = new MarketDataAggregator({ now: () => new Date(now) });
    const ingest = (latency: number) => source.ingest({ type: 'trade', symbol: 'AAPL', price: 100, size: 1, providerTimestamp: new Date(now - latency).toISOString(), receivedAt: new Date(now).toISOString() });
    const rule = { id: 'r1', name: 'latency', scope: { kind: 'all' as const }, metric: 'observedLatencyMs' as const, operator: 'gt' as const, threshold: 100, durationSeconds: 1, severity: 'critical' as const, enabled: true, version: 1, creatorId: 'u' };
    const evaluator = new MonitoringEvaluator({ upsertViolation: async () => { events.push('alert'); }, recover: async () => { events.push('recovered'); } });
    const runtime = new MonitoringRuntime(source, evaluator, { enabled: async () => [rule] }, { cadenceMs: 1_000, now: () => now });
    ingest(120); await runtime.observe('AAPL'); now = 1_500; ingest(120); await runtime.observe('AAPL'); expect(events).toEqual([]);
    now = 2_000; ingest(120); await runtime.observe('AAPL'); expect(events).toEqual(['alert']);
    now = 3_000; ingest(50); await runtime.observe('AAPL'); expect(events).toEqual(['alert', 'recovered']);
  });
  it('opens a stale-data alert from periodic ticks while the stream is silent', async () => {
    let now = 1_000; const opened: string[] = [];
    const aggregator = new MarketDataAggregator({ now: () => new Date(now), marketClock: { get: async () => ({ isOpen: true } as never) } });
    aggregator.ingest({ type: 'trade', symbol: 'AAPL', price: 100, size: 1, providerTimestamp: new Date(1_000).toISOString(), receivedAt: new Date(1_000).toISOString() });
    const rule = { id: 'stale', name: 'stale', scope: { kind: 'all' as const }, metric: 'lastEventAgeSeconds' as const, operator: 'gt' as const, threshold: 5, durationSeconds: 1, severity: 'critical' as const, enabled: true, version: 1, creatorId: 'u' };
    const runtime = new MonitoringRuntime({ snapshot: symbol => aggregator.snapshotWithMarketState(symbol), symbols: () => ['AAPL'] }, new MonitoringEvaluator({ upsertViolation: async value => { opened.push(value.id); }, recover: async () => {} }), { enabled: async () => [rule] }, { cadenceMs: 1_000, now: () => now });
    now = 7_000; await runtime.tick(); expect(opened).toEqual([]);
    now = 8_000; await runtime.tick(); expect(opened).toEqual(['stale']);
  });
  it('evaluates provider error and reconnect counters without a subsequent trade', async () => {
    let now = 0; const opened: string[] = []; const aggregator = new MarketDataAggregator({ now: () => new Date(now) });
    const makeRule = (id: string, metric: 'providerErrors' | 'reconnects') => ({ id, name: id, scope: { kind: 'all' as const }, metric, operator: 'gt' as const, threshold: 0, durationSeconds: 0, severity: 'warning' as const, enabled: true, version: 1, creatorId: 'u' });
    const rules = [makeRule('errors', 'providerErrors'), makeRule('reconnects', 'reconnects')];
    const runtime = new MonitoringRuntime(aggregator, new MonitoringEvaluator({ upsertViolation: async value => { opened.push(value.id); }, recover: async () => {} }), { enabled: async () => rules }, { cadenceMs: 1_000, now: () => now });
    aggregator.recordProviderError(['AAPL']); await runtime.tick(); expect(opened).toContain('errors');
    now = 1_000; aggregator.recordReconnect(['AAPL']); await runtime.tick(); expect(opened).toContain('reconnects');
  });
  it('suppresses stale age while the market is closed', async () => {
    let now = 1_000; const opened: string[] = []; const aggregator = new MarketDataAggregator({ now: () => new Date(now), marketClock: { get: async () => ({ isOpen: false } as never) } });
    aggregator.ingest({ type: 'trade', symbol: 'AAPL', price: 100, size: 1, providerTimestamp: new Date(1_000).toISOString(), receivedAt: new Date(1_000).toISOString() });
    const rule = { id: 'stale', name: 'stale', scope: { kind: 'all' as const }, metric: 'lastEventAgeSeconds' as const, operator: 'gt' as const, threshold: 5, durationSeconds: 0, severity: 'critical' as const, enabled: true, version: 1, creatorId: 'u' };
    const runtime = new MonitoringRuntime({ snapshot: symbol => aggregator.snapshotWithMarketState(symbol), symbols: () => ['AAPL'] }, new MonitoringEvaluator({ upsertViolation: async value => { opened.push(value.id); }, recover: async () => {} }), { enabled: async () => [rule] }, { cadenceMs: 1_000, now: () => now });
    now = 60_000; await runtime.tick(); expect(opened).toEqual([]);
  });
  it('suppresses only stale-data rules when market state is unknown and keeps other evaluation operational', async () => {
    const opened: string[] = [];
    const rules = [
      { id: 'stale', name: 'stale', scope: { kind: 'all' as const }, metric: 'lastEventAgeSeconds' as const, operator: 'gt' as const, threshold: 5, durationSeconds: 0, severity: 'critical' as const, enabled: true, version: 1, creatorId: 'u' },
      { id: 'errors', name: 'errors', scope: { kind: 'all' as const }, metric: 'providerErrors' as const, operator: 'gt' as const, threshold: 0, durationSeconds: 0, severity: 'warning' as const, enabled: true, version: 1, creatorId: 'u' },
    ];
    const snapshot = { observedLatency: { latest: 0 }, receivedMessagesPerSecond: 0, staleDurationMs: 60_000, providerErrors: 1, reconnects: 0, marketClockStatus: 'unavailable' as const };
    const runtime = new MonitoringRuntime({ snapshot: async () => snapshot, symbols: () => ['AAPL'] }, new MonitoringEvaluator({ upsertViolation: async value => { opened.push(value.id); }, recover: async () => {} }), { enabled: async () => rules }, { cadenceMs: 1, now: () => 10 });
    await runtime.tick();
    expect(opened).toEqual(['errors']);
  });
});
