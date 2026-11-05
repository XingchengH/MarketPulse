import type { RuleOperator } from '@marketpulse/contracts';
import type { MetricValues, RuntimeRule } from './types.js';

export interface EvaluationAlertSink {
  upsertViolation(rule: RuntimeRule, symbol: string, value: number, observedAt: Date): Promise<void>;
  recover(rule: RuntimeRule, symbol: string, observedAt: Date): Promise<void>;
}
const compare = (operator: RuleOperator, value: number, threshold: number): boolean => ({ gt: value > threshold, gte: value >= threshold, lt: value < threshold, lte: value <= threshold })[operator];
export class MonitoringEvaluator {
  private readonly started = new Map<string, number>();
  constructor(private readonly alerts: EvaluationAlertSink) {}
  async evaluate(rules: readonly RuntimeRule[], symbol: string, metrics: MetricValues, observedAt = new Date()): Promise<void> {
    for (const rule of rules) {
      if (!rule.enabled || (rule.scope.kind === 'symbol' && rule.scope.symbol !== symbol)) continue;
      const value = metrics[rule.metric]; if (value === undefined) continue;
      const key = `${rule.id}:${symbol}`;
      if (!compare(rule.operator, value, rule.threshold)) {
        this.started.delete(key); await this.alerts.recover(rule, symbol, observedAt); continue;
      }
      const began = this.started.get(key);
      if (began === undefined) { this.started.set(key, observedAt.valueOf()); if (rule.durationSeconds > 0) continue; }
      if (observedAt.valueOf() - (began ?? observedAt.valueOf()) >= rule.durationSeconds * 1000) await this.alerts.upsertViolation(rule, symbol, value, observedAt);
    }
  }
}
