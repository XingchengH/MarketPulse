import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert } from '../models/alert.js';
import { AlertService } from './alert-service.js';

const rule = { id: 'r1', name: 'Latency', scope: { kind: 'all' as const }, metric: 'observedLatencyMs' as const, operator: 'gt' as const, threshold: 100, durationSeconds: 10, severity: 'critical' as const, enabled: true, version: 2, creatorId: 'u' };
afterEach(() => vi.restoreAllMocks());

describe('AlertService', () => {
  it('recovers open alerts without acknowledging them', async () => {
    const update = vi.spyOn(Alert, 'updateOne').mockResolvedValue({} as never);
    await new AlertService().recover(rule, 'AAPL', new Date(20));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }), { $set: expect.objectContaining({ status: 'recovered' }) });
  });
  it('resolves a concurrent upsert duplicate by updating the winner', async () => {
    vi.spyOn(Alert, 'findOneAndUpdate').mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    const update = vi.spyOn(Alert, 'updateOne').mockResolvedValue({} as never);
    await new AlertService().upsertViolation(rule, 'AAPL', 120, new Date(20));
    expect(update).toHaveBeenCalledOnce();
  });
  it('acknowledges only open or recovered alerts with actor and time', async () => {
    const lean = vi.fn(async () => ({ status: 'acknowledged' }));
    const query = vi.spyOn(Alert, 'findOneAndUpdate').mockReturnValue({ lean } as never);
    await new AlertService().acknowledge('a1', 'operator', new Date(30));
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ status: { $in: ['open', 'recovered'] } }), { $set: { status: 'acknowledged', acknowledgedAt: new Date(30), acknowledgedBy: 'operator' } }, { new: true });
  });
});
