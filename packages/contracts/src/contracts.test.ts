import { describe, expect, it } from 'vitest';
import { marketEventSchema, roleSchema, ruleInputSchema } from './index.js';

describe('shared contracts', () => {
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
