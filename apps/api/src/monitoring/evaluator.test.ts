import { describe, expect, it } from 'vitest';
import { MonitoringEvaluator } from './evaluator.js';

const rule = { id: 'r1', name: 'Latency', scope: { kind: 'all' as const }, metric: 'observedLatencyMs' as const, operator: 'gt' as const, threshold: 100, durationSeconds: 10, severity: 'critical' as const, enabled: true, version: 1, creatorId: 'admin' };

describe('MonitoringEvaluator', () => {
  it('opens once only after a sustained violation and updates it thereafter', async () => {
    const calls: string[] = [];
    const evaluator = new MonitoringEvaluator({ upsertViolation: async (_r, symbol) => { calls.push(symbol); }, recover: async () => {} });
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(0));
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(9_000));
    expect(calls).toEqual([]);
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(10_000));
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 105 }, new Date(11_000));
    expect(calls).toEqual(['AAPL', 'AAPL']);
  });

  it('clears violation timing and recovers without acknowledging', async () => {
    const recovered: string[] = [];
    const evaluator = new MonitoringEvaluator({ upsertViolation: async () => {}, recover: async (_r, symbol) => { recovered.push(symbol); } });
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(0));
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 99 }, new Date(5_000));
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(10_000));
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(15_000));
    expect(recovered).toEqual(['AAPL']);
  });
});
