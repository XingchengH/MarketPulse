import { Alert } from '../models/alert.js';
import { AuditEvent } from '../models/audit-event.js';
import mongoose from 'mongoose';
import { redactAuditValue } from './audit-service.js';
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
  async acknowledge(id: string, actorId: string, requestId: string, at = new Date()) {
    const session = await mongoose.startSession();
    try { return await session.withTransaction(async () => { const before = await Alert.findOne({ _id: id, status: { $in: ['open', 'recovered'] } }).session(session).lean(); if (!before) return null; const result = await Alert.findOneAndUpdate({ _id: id, status: { $in: ['open', 'recovered'] } }, { $set: { status: 'acknowledged', acknowledgedAt: at, acknowledgedBy: actorId } }, { returnDocument: 'after', session }).lean(); if (!result) return null; await AuditEvent.create([{ actorId, action: 'alert.acknowledge', resourceType: 'alert', resourceId: id, requestId, before: redactAuditValue(before), after: redactAuditValue(result) }], { session }); return result; }); } finally { await session.endSession(); }
  }
}
