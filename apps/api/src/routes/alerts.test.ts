import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAlertsRouter } from './alerts.js';

describe('alert acknowledgement RBAC', () => {
  const make = (role: 'viewer' | 'operator' | 'admin') => { const app = express(); app.use((q, r, n) => { r.locals.user = { sub: 'u', role }; r.locals.requestId = 'r'; n(); }); const service = { acknowledge: vi.fn(async () => ({ id: 'a', status: 'acknowledged' })) }; const audit = { record: vi.fn(async () => {}) }; app.use('/alerts', createAlertsRouter(async () => role, service as never, audit as never)); return { app, service, audit }; };
  it('rejects viewers and allows operators to acknowledge', async () => {
    expect((await request(make('viewer').app).post('/alerts/a/acknowledge')).status).toBe(403);
    const operator = make('operator'); expect((await request(operator.app).post('/alerts/a/acknowledge')).status).toBe(200); expect(operator.audit.record).toHaveBeenCalledOnce();
  });
});
