import { Rule } from '../models/rule.js';
import type { RuntimeRule, MetricValues } from './types.js';
import type { MonitoringEvaluator } from './evaluator.js';

interface SnapshotSource { snapshot(symbol: string): { observedLatency: { latest: number }; receivedMessagesPerSecond: number; staleDurationMs: number; providerErrors: number; reconnects: number }; symbols(): string[] }
interface RuleSource { enabled(): Promise<RuntimeRule[]> }
export const mongooseRuleSource: RuleSource = { enabled: async () => (await Rule.find({ enabled: true }).lean()).map(value => ({ ...value, id: String(value._id) } as unknown as RuntimeRule)) };
export class MonitoringRuntime {
  private readonly last = new Map<string, number>(); private readonly running = new Set<string>();
  constructor(private readonly source: SnapshotSource, private readonly evaluator: MonitoringEvaluator, private readonly rules: RuleSource = mongooseRuleSource, private readonly options: { cadenceMs?: number; now?: () => number } = {}) {}
  async observe(symbol: string): Promise<void> {
    const now = (this.options.now ?? Date.now)(), cadence = this.options.cadenceMs ?? 1_000;
    if (this.running.has(symbol) || now - (this.last.get(symbol) ?? -Infinity) < cadence) return;
    this.running.add(symbol); this.last.set(symbol, now);
    try { const rules = await this.rules.enabled(); const snapshot = this.source.snapshot(symbol); const metrics: MetricValues = { observedLatencyMs: snapshot.observedLatency.latest, messagesPerSecond: snapshot.receivedMessagesPerSecond, lastEventAgeSeconds: snapshot.staleDurationMs / 1000, providerErrors: snapshot.providerErrors, reconnects: snapshot.reconnects }; this.evaluator.reconcile(new Set(rules.map(rule => rule.id)), new Set(this.source.symbols())); await this.evaluator.evaluate(rules, symbol, metrics, new Date(now)); }
    finally { this.running.delete(symbol); }
  }
}
