import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rule } from '../models/rule.js';
import { RuleVersion } from '../models/rule-version.js';
import { AuditEvent } from '../models/audit-event.js';
import { Alert } from '../models/alert.js';
import { RuleService } from './rule-service.js';
import { AlertService } from './alert-service.js';

const base = { name: 'Latency', scope: { kind: 'all' as const }, metric: 'observedLatencyMs' as const, operator: 'gt' as const, threshold: 100, durationSeconds: 10, severity: 'critical' as const, enabled: true };
const context = { actorId: 'admin', requestId: 'request-1' };

describe('monitoring Mongo transaction and index invariants', () => {
  let replicaSet: MongoMemoryReplSet;
  const rules = new RuleService();
  beforeAll(async () => {
    let systemBinary: string | undefined;
    try { systemBinary = execFileSync('which', ['mongod'], { encoding: 'utf8' }).trim() || undefined; } catch { /* download fallback */ }
    replicaSet = await MongoMemoryReplSet.create({ binary: systemBinary ? { systemBinary } : undefined, replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replicaSet.getUri(), { dbName: 'monitoring-transactions' });
    await Promise.all([Rule.syncIndexes(), RuleVersion.syncIndexes(), AuditEvent.syncIndexes(), Alert.syncIndexes()]);
  }, 60_000);
  beforeEach(async () => { await Promise.all([Rule.deleteMany({}), RuleVersion.collection.deleteMany({}), Alert.deleteMany({}), AuditEvent.collection.deleteMany({})]); });
  afterAll(async () => { await mongoose.disconnect(); await replicaSet?.stop(); });

  it('atomically creates, updates and rolls back into three immutable versions with audits', async () => {
    const created = await rules.create(base, context) as { _id: unknown }; const id = String(created._id);
    expect((await rules.update(id, { ...base, threshold: 200 }, 1, context)).status).toBe('updated');
    const rollback = await rules.rollback(id, 1, 2, context);
    expect(rollback.status).toBe('updated');
    expect((rollback as { rule: { version: number; threshold: number } }).rule).toMatchObject({ version: 3, threshold: 100 });
    const versions = await RuleVersion.find({ ruleId: id }).sort({ version: 1 }).lean();
    expect(versions.map(item => [item.version, item.snapshot.threshold])).toEqual([[1, 100], [2, 200], [3, 100]]);
    expect(await AuditEvent.countDocuments({ resourceId: id })).toBe(3);
    await RuleVersion.updateOne({ ruleId: id, version: 1 }, { $set: { snapshot: { ...base, threshold: 999 } } });
    expect((await RuleVersion.findOne({ ruleId: id, version: 1 }).lean())?.snapshot.threshold).toBe(100);
  });
  it('rejects deletion and replacement of rule versions', async () => {
    const created = await rules.create(base, context) as { _id: unknown }; const id = String(created._id);
    await expect(RuleVersion.deleteOne({ ruleId: id })).rejects.toThrow('append-only');
    await expect(RuleVersion.deleteMany({ ruleId: id })).rejects.toThrow('append-only');
    await expect(RuleVersion.findOneAndDelete({ ruleId: id })).rejects.toThrow('append-only');
    const version = await RuleVersion.findOne({ ruleId: id }).lean();
    await expect(RuleVersion.findByIdAndDelete(version?._id)).rejects.toThrow('append-only');
    await expect(RuleVersion.replaceOne({ ruleId: id }, { ruleId: id, version: 1, snapshot: base, actorId: 'x' })).rejects.toThrow('append-only');
    await expect(RuleVersion.findOneAndReplace({ ruleId: id }, { ruleId: id, version: 1, snapshot: base, actorId: 'x' })).rejects.toThrow('append-only');
    expect(await RuleVersion.countDocuments({ ruleId: id })).toBe(1);
  });

  it('allows exactly one real concurrent optimistic update', async () => {
    const created = await rules.create(base, context) as { _id: unknown }; const id = String(created._id);
    const outcomes = await Promise.all([150, 200].map(threshold => rules.update(id, { ...base, threshold }, 1, context)));
    expect(outcomes.map(value => value.status).sort()).toEqual(['conflict', 'updated']);
    expect(await RuleVersion.countDocuments({ ruleId: id })).toBe(2);
    expect(await AuditEvent.countDocuments({ resourceId: id })).toBe(2);
  });

  it('enforces one non-acknowledged active alert with the real partial unique index', async () => {
    const alert = { ruleId: new mongoose.Types.ObjectId().toString(), ruleVersion: 1, symbol: 'AAPL', metric: 'observedLatencyMs', severity: 'critical', status: 'open', value: 120, threshold: 100, openedAt: new Date(), lastObservedAt: new Date() };
    const results = await Promise.allSettled([Alert.create(alert), Alert.create(alert)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await Alert.countDocuments()).toBe(1);
  });

  it('rolls back acknowledgement if its audit insertion fails', async () => {
    const alert = await Alert.create({ ruleId: new mongoose.Types.ObjectId().toString(), ruleVersion: 1, symbol: 'AAPL', metric: 'observedLatencyMs', severity: 'critical', status: 'open', value: 120, threshold: 100, openedAt: new Date(), lastObservedAt: new Date() });
    const create = vi.spyOn(AuditEvent, 'create').mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(new AlertService().acknowledge(String(alert._id), 'operator', 'req')).rejects.toThrow('audit unavailable');
    create.mockRestore();
    expect((await Alert.findById(alert._id).lean())?.status).toBe('open');
  });

  it.each(['open', 'recovered'] as const)('atomically acknowledges a %s alert and appends its audit event', async status => {
    const alert = await Alert.create({ ruleId: new mongoose.Types.ObjectId().toString(), ruleVersion: 1, symbol: 'AAPL', metric: 'observedLatencyMs', severity: 'critical', status, value: 120, threshold: 100, openedAt: new Date(10), lastObservedAt: new Date(20), ...(status === 'recovered' ? { recoveredAt: new Date(30) } : {}) });
    const acknowledgedAt = new Date('2026-11-05T20:00:00.000Z');
    await new AlertService().acknowledge(String(alert._id), 'operator-1', 'request-ack', acknowledgedAt);
    const persisted = await Alert.findById(alert._id).lean();
    expect(persisted).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'operator-1', acknowledgedAt });
    const audit = await AuditEvent.findOne({ resourceId: String(alert._id) }).lean();
    expect(audit).toMatchObject({ actorId: 'operator-1', requestId: 'request-ack', resourceType: 'alert', resourceId: String(alert._id), action: 'alert.acknowledge' });
  });
  it('invokes realtime hooks after committed rule and alert mutations', async () => {
    const rulesChanged = vi.fn();
    const alertsChanged = vi.fn();
    const rule = await new RuleService(rulesChanged).create(base, context) as { _id: unknown };
    const alert = await Alert.create({ ruleId: String(rule._id), ruleVersion: 1, symbol: 'AAPL', metric: 'observedLatencyMs', severity: 'critical', status: 'open', value: 120, threshold: 100, openedAt: new Date(), lastObservedAt: new Date() });
    await new AlertService(alertsChanged).acknowledge(String(alert._id), 'operator', 'request-realtime');
    expect(rulesChanged).toHaveBeenCalledOnce();
    expect(alertsChanged).toHaveBeenCalledOnce();
  });
  it('redacts sensitive nested alert metadata in acknowledgement audit snapshots', async () => {
    const inserted = await Alert.collection.insertOne({ ruleId: new mongoose.Types.ObjectId().toString(), ruleVersion: 1, symbol: 'AAPL', metric: 'observedLatencyMs', severity: 'critical', status: 'open', value: 120, threshold: 100, openedAt: new Date(), lastObservedAt: new Date(), metadata: { accessToken: 'nope', nested: { password: 'nope', safe: 'yes' } } });
    await new AlertService().acknowledge(String(inserted.insertedId), 'operator', 'req');
    const audit = await AuditEvent.findOne({ resourceId: String(inserted.insertedId) }).lean() as { before?: Record<string, unknown> } | null;
    expect(audit?.before).toMatchObject({ metadata: { nested: { safe: 'yes' } } });
    expect(JSON.stringify(audit?.before)).not.toMatch(/nope|token|password/i);
  });
});
