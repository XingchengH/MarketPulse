import type { RuleOperator } from '@marketpulse/contracts';
import type { MetricValues, RuntimeRule } from './types.js';

export interface EvaluationAlertSink {
  upsertViolation(rule: RuntimeRule, symbol: string, value: number, observedAt: Date): Promise<void>;
  recover(rule: RuntimeRule, symbol: string, observedAt: Date): Promise<void>;
}
const compare = (operator: RuleOperator, value: number, threshold: number): boolean => ({ gt: value > threshold, gte: value >= threshold, lt: value < threshold, lte: value <= threshold })[operator];
export class MonitoringEvaluator {
  private readonly started = new Map<string, { at: number; version: number }>();
  constructor(private readonly alerts: EvaluationAlertSink) {}
  async evaluate(rules: readonly RuntimeRule[], symbol: string, metrics: MetricValues, observedAt = new Date()): Promise<void> {
    const activeIds = new Set(rules.filter(rule => rule.enabled && (rule.scope.kind === 'all' || rule.scope.symbol === symbol) && metrics[rule.metric] !== undefined).map(rule => rule.id));
    for (const key of this.started.keys()) if (key.endsWith(`:${symbol}`) && !activeIds.has(key.slice(0, key.length - symbol.length - 1))) this.started.delete(key);
    for (const rule of rules) {
      const key = `${rule.id}:${symbol}`;
      if (!rule.enabled || (rule.scope.kind === 'symbol' && rule.scope.symbol !== symbol)) { this.started.delete(key); continue; }
      const value = metrics[rule.metric]; if (value === undefined) { this.started.delete(key); continue; }
      if (!compare(rule.operator, value, rule.threshold)) {
        this.started.delete(key); await this.alerts.recover(rule, symbol, observedAt); continue;
      }
      let began = this.started.get(key);
      if (!began || began.version !== rule.version) { began = { at: observedAt.valueOf(), version: rule.version }; this.started.set(key, began); if (rule.durationSeconds > 0) continue; }
      if (observedAt.valueOf() - began.at >= rule.durationSeconds * 1000) await this.alerts.upsertViolation(rule, symbol, value, observedAt);
    }
  }
}
