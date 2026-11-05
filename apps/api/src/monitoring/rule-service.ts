import mongoose from 'mongoose';
import type { RuleInput } from '@marketpulse/contracts';
import { Rule } from '../models/rule.js';
import { RuleVersion } from '../models/rule-version.js';
import { AuditEvent } from '../models/audit-event.js';
import { redactAuditValue } from './audit-service.js';

export interface MutationContext { actorId: string; requestId: string }
const snapshot = (value: Record<string, unknown>): RuleInput => ({ name: value.name, scope: value.scope, metric: value.metric, operator: value.operator, threshold: value.threshold, durationSeconds: value.durationSeconds, severity: value.severity, enabled: value.enabled } as RuleInput);
export class RuleService {
  async list() { return Rule.find().sort({ createdAt: -1 }).lean(); }
  async get(id: string) { return Rule.findById(id).lean(); }
  async versions(id: string) { return RuleVersion.find({ ruleId: id }).sort({ version: -1 }).lean(); }
  async create(input: RuleInput, context: MutationContext) {
    const session = await mongoose.startSession(); let result: unknown;
    try { await session.withTransaction(async () => { const [rule] = await Rule.create([{ ...input, version: 1, creatorId: context.actorId }], { session }); result = rule.toObject(); await RuleVersion.create([{ ruleId: rule.id, version: 1, snapshot: input, actorId: context.actorId }], { session }); await AuditEvent.create([{ actorId: context.actorId, action: 'rule.create', resourceType: 'rule', resourceId: rule.id, requestId: context.requestId, after: redactAuditValue(result) }], { session }); }); return result; } finally { await session.endSession(); }
  }
  async update(id: string, input: RuleInput, expectedVersion: number, context: MutationContext, action = 'rule.update') {
    const session = await mongoose.startSession(); let result: unknown | null = null; let found = true;
    try { await session.withTransaction(async () => { const before = await Rule.findById(id).session(session).lean(); if (!before) { found = false; return; } const nextVersion = expectedVersion + 1; const updated = await Rule.findOneAndUpdate({ _id: id, version: expectedVersion }, { $set: input, $inc: { version: 1 } }, { new: true, session }).lean(); if (!updated) return; result = updated; await RuleVersion.create([{ ruleId: id, version: nextVersion, snapshot: input, actorId: context.actorId }], { session }); await AuditEvent.create([{ actorId: context.actorId, action, resourceType: 'rule', resourceId: id, requestId: context.requestId, before: redactAuditValue(before), after: redactAuditValue(updated) }], { session }); }); return !found ? { status: 'not_found' as const } : result ? { status: 'updated' as const, rule: result } : { status: 'conflict' as const }; } finally { await session.endSession(); }
  }
  async rollback(id: string, targetVersion: number, expectedVersion: number, context: MutationContext) {
    const old = await RuleVersion.findOne({ ruleId: id, version: targetVersion }).lean(); if (!old) return { status: 'not_found' as const };
    return this.update(id, snapshot(old.snapshot as unknown as Record<string, unknown>), expectedVersion, { ...context }, 'rule.rollback');
  }
}
