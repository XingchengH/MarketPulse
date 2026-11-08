import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAlertsRouter } from './alerts.js';
import { Alert } from '../models/alert.js';

const alertId = '507f1f77bcf86cd799439011';
const make = (role: 'viewer' | 'operator' | 'admin' = 'viewer', currentRole: 'viewer' | 'operator' | 'admin' | null = role) => {
  const alerts = [{ _id: alertId, symbol: 'AAPL', status: 'open' }, { _id: '507f1f77bcf86cd799439012', symbol: 'MSFT', status: 'open' }];
  const find = vi.spyOn(Alert, 'find').mockImplementation((filter: any) => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => alerts.filter(alert => filter.symbol.$in.includes(alert.symbol) && (!filter.status || alert.status === filter.status)) }) }) }) }) as never);
  const findById = vi.spyOn(Alert, 'findById').mockImplementation((id: any) => ({ lean: async () => alerts.find(alert => alert._id === id) ?? null }) as never);
  const scope = {
    symbols: vi.fn(async (userId: string) => userId === 'alice' ? ['AAPL'] : ['MSFT']),
    has: vi.fn(async (userId: string, symbol: string) => symbol === (userId === 'alice' ? 'AAPL' : 'MSFT')),
  };
  const service = { acknowledge: vi.fn(async () => ({ id: alertId, status: 'acknowledged' })) };
  const resolveRole = vi.fn(async (_userId: string) => currentRole);
  const app = express();
  app.use((req, res, next) => { res.locals.user = { sub: req.header('x-user') ?? 'alice', role }; res.locals.requestId = 'request-1'; next(); });
  app.use('/alerts', createAlertsRouter(resolveRole, service, scope));
  return { app, service, find, findById, scope, resolveRole };
};

describe('personal alerts and acknowledgement RBAC', () => {
  afterEach(() => vi.restoreAllMocks());

  it('filters Mongo alerts by personal symbols and status for both users', async () => {
    const { app, find, scope } = make();
    for (const [userId, symbol] of [['alice', 'AAPL'], ['bob', 'MSFT']]) {
      const response = await request(app).get('/alerts?status=open&userId=other').set('x-user', userId).expect(200);
      expect(response.body.alerts.map((alert: { symbol: string }) => alert.symbol)).toEqual([symbol]);
      expect(find).toHaveBeenLastCalledWith({ symbol: { $in: [symbol] }, status: 'open' });
      expect(scope.symbols).toHaveBeenCalledWith(userId);
    }
  });

  it('retains the personal Mongo filter without status and for empty lists', async () => {
    const { app, scope, find } = make();
    await request(app).get('/alerts').expect(200);
    expect(find).toHaveBeenLastCalledWith({ symbol: { $in: ['AAPL'] } });
    scope.symbols.mockResolvedValueOnce([]);
    expect((await request(app).get('/alerts').expect(200)).body.alerts).toEqual([]);
    expect(find).toHaveBeenLastCalledWith({ symbol: { $in: [] } });
  });

  it('returns 404 for missing, invalid or unowned alert details', async () => {
    const { app } = make();
    await request(app).get(`/alerts/${alertId}`).expect(200);
    for (const id of [alertId, '507f1f77bcf86cd799439099', 'nope']) expect((await request(app).get(`/alerts/${id}`).set('x-user', 'bob').expect(404)).body.error.code).toBe('ALERT_NOT_FOUND');
  });

  it('allows operator and admin acknowledgements only for owned alerts', async () => {
    for (const role of ['operator', 'admin'] as const) {
      const { app, service } = make(role);
      await request(app).post(`/alerts/${alertId}/acknowledge`).expect(200);
      expect(service.acknowledge).toHaveBeenCalledWith(alertId, 'alice', 'request-1');
      service.acknowledge.mockClear();
      expect((await request(app).post(`/alerts/${alertId}/acknowledge`).set('x-user', 'bob').expect(404)).body.error.code).toBe('ALERT_NOT_FOUND');
      expect(service.acknowledge).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('resolves current role before ownership/data access', async () => {
    for (const currentRole of ['viewer', null] as const) {
      const { app, findById, service, resolveRole } = make('operator', currentRole);
      await request(app).post(`/alerts/${alertId}/acknowledge`).expect(403);
      expect(resolveRole).toHaveBeenCalledWith('alice');
      expect(findById).not.toHaveBeenCalled();
      expect(service.acknowledge).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('does not acknowledge invalid/missing alerts and preserves inactive-alert 404', async () => {
    const { app, service } = make('operator');
    for (const id of ['nope', '507f1f77bcf86cd799439099']) await request(app).post(`/alerts/${id}/acknowledge`).expect(404);
    expect(service.acknowledge).not.toHaveBeenCalled();
    service.acknowledge.mockResolvedValueOnce(null as never);
    expect((await request(app).post(`/alerts/${alertId}/acknowledge`).expect(404)).body.error.code).toBe('ALERT_NOT_FOUND');
  });

  it('validates status and pagination before querying', async () => {
    const { app, find } = make();
    for (const query of ['status=bogus', 'limit=101', 'page=0']) expect((await request(app).get(`/alerts?${query}`).expect(400)).body.error.code).toBe('INVALID_QUERY');
    expect(find).not.toHaveBeenCalled();
  });
});
