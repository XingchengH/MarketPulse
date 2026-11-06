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
});
