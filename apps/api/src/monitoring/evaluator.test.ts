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
  it.each([
    ['disabled', { ...rule, enabled: false }, { observedLatencyMs: 101 }],
    ['out of scope', { ...rule, scope: { kind: 'symbol' as const, symbol: 'MSFT' } }, { observedLatencyMs: 101 }],
    ['missing metric', rule, {}],
    ['healthy', rule, { observedLatencyMs: 99 }],
  ])('requires a new continuous duration after %s', async (_name, interruption, values) => {
    const opened: number[] = []; const evaluator = new MonitoringEvaluator({ upsertViolation: async (_r, _s, _v, at) => { opened.push(at.valueOf()); }, recover: async () => {} });
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(0));
    await evaluator.evaluate([interruption], 'AAPL', values, new Date(9_000));
    const resumed = rule;
    await evaluator.evaluate([resumed], 'AAPL', { observedLatencyMs: 101 }, new Date(10_000));
    await evaluator.evaluate([resumed], 'AAPL', { observedLatencyMs: 101 }, new Date(19_000));
    expect(opened).toEqual([]);
    await evaluator.evaluate([resumed], 'AAPL', { observedLatencyMs: 101 }, new Date(20_000));
    expect(opened).toEqual([20_000]);
  });
  it('restarts continuity when the rule version changes', async () => {
    const opened: number[] = []; const evaluator = new MonitoringEvaluator({ upsertViolation: async (_r, _s, _v, at) => { opened.push(at.valueOf()); }, recover: async () => {} });
    const next = { ...rule, version: 2 };
    await evaluator.evaluate([rule], 'AAPL', { observedLatencyMs: 101 }, new Date(0));
    await evaluator.evaluate([next], 'AAPL', { observedLatencyMs: 101 }, new Date(9_000));
    await evaluator.evaluate([next], 'AAPL', { observedLatencyMs: 101 }, new Date(18_000));
    expect(opened).toEqual([]);
    await evaluator.evaluate([next], 'AAPL', { observedLatencyMs: 101 }, new Date(19_000));
    expect(opened).toEqual([19_000]);
  });
});
