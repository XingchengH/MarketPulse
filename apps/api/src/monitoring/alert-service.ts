import { Alert } from '../models/alert.js';
import type { RuntimeRule } from './types.js';
export class AlertService {
  async upsertViolation(rule: RuntimeRule, symbol: string, value: number, observedAt: Date): Promise<void> {
    const filter = { ruleId: rule.id, symbol, status: { $in: ['open', 'recovered'] } };
    const update = { $set: { ruleVersion: rule.version, metric: rule.metric, severity: rule.severity, value, threshold: rule.threshold, lastObservedAt: observedAt, status: 'open' }, $setOnInsert: { openedAt: observedAt } };
    try { await Alert.findOneAndUpdate(filter, update, { upsert: true }); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      await Alert.updateOne(filter, update);
    }
  }
  async recover(rule: RuntimeRule, symbol: string, observedAt: Date): Promise<void> { await Alert.updateOne({ ruleId: rule.id, symbol, status: 'open' }, { $set: { status: 'recovered', recoveredAt: observedAt, lastObservedAt: observedAt } }); }
  async acknowledge(id: string, actorId: string, at = new Date()) { return Alert.findOneAndUpdate({ _id: id, status: { $in: ['open', 'recovered'] } }, { $set: { status: 'acknowledged', acknowledgedAt: at, acknowledgedBy: actorId } }, { new: true }).lean(); }
}
