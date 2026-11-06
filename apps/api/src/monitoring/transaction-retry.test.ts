import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rule } from '../models/rule.js';
import { RuleVersion } from '../models/rule-version.js';
import { Alert } from '../models/alert.js';
import { AuditEvent } from '../models/audit-event.js';
import { RuleService } from './rule-service.js';
import { AlertService } from './alert-service.js';

afterEach(() => vi.restoreAllMocks());
const retryingSession = () => ({ withTransaction: async (callback: () => Promise<unknown>) => { await callback(); return callback(); }, endSession: async () => {} });
const input = { name: 'Latency', scope: { kind: 'all' as const }, metric: 'observedLatencyMs' as const, operator: 'gt' as const, threshold: 100, durationSeconds: 10, severity: 'critical' as const, enabled: true };

describe('transaction retry result isolation', () => {
  it('RuleService returns the final retry result, not a prior mutable attempt value', async () => {
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(retryingSession() as never);
    vi.spyOn(Rule, 'findById').mockReturnValue({ session: () => ({ lean: async () => ({ version: 1 }) }) } as never);
    const lean = vi.fn().mockResolvedValueOnce({ version: 2 }).mockResolvedValueOnce(null);
    vi.spyOn(Rule, 'findOneAndUpdate').mockReturnValue({ lean } as never);
    vi.spyOn(RuleVersion, 'create').mockResolvedValue([] as never); vi.spyOn(AuditEvent, 'create').mockResolvedValue([] as never);
    expect(await new RuleService().update('507f1f77bcf86cd799439011', input, 1, { actorId: 'u', requestId: 'r' })).toEqual({ status: 'conflict' });
  });
  it('AlertService returns the final retry result, not an acknowledged prior attempt', async () => {
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(retryingSession() as never);
    const before = vi.fn().mockResolvedValueOnce({ status: 'open' }).mockResolvedValueOnce(null);
    vi.spyOn(Alert, 'findOne').mockReturnValue({ session: () => ({ lean: before }) } as never);
    vi.spyOn(Alert, 'findOneAndUpdate').mockReturnValue({ lean: async () => ({ status: 'acknowledged' }) } as never);
    vi.spyOn(AuditEvent, 'create').mockResolvedValue([] as never);
    expect(await new AlertService().acknowledge('507f1f77bcf86cd799439011', 'u', 'r')).toBeNull();
  });
});
