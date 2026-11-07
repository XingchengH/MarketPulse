import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAlertsRouter } from './alerts.js';
import { Alert } from '../models/alert.js';
import { afterEach } from 'vitest';

describe('alert acknowledgement RBAC', () => {
  afterEach(() => vi.restoreAllMocks());
  const make = (role: 'viewer' | 'operator' | 'admin') => { const app = express(); app.use((q, r, n) => { r.locals.user = { sub: 'u', role }; r.locals.requestId = 'r'; n(); }); const service = { acknowledge: vi.fn(async () => ({ id: 'a', status: 'acknowledged' })) }; app.use('/alerts', createAlertsRouter(async () => role, service as never)); return { app, service }; };
  it('rejects viewers and allows operators to acknowledge', async () => {
    expect((await request(make('viewer').app).post('/alerts/507f1f77bcf86cd799439011/acknowledge')).status).toBe(403);
    const operator = make('operator'); expect((await request(operator.app).post('/alerts/507f1f77bcf86cd799439011/acknowledge')).status).toBe(200);
    expect((await request(make('admin').app).post('/alerts/507f1f77bcf86cd799439011/acknowledge')).status).toBe(200);
  });
  it('allows viewers to list/detail and returns 404 for invalid IDs', async () => {
    vi.spyOn(Alert, 'find').mockReturnValue({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) } as never);
    vi.spyOn(Alert, 'findById').mockReturnValue({ lean: async () => ({ _id: '507f1f77bcf86cd799439011' }) } as never);
    const viewer = make('viewer').app;
    expect((await request(viewer).get('/alerts')).status).toBe(200);
    expect((await request(viewer).get('/alerts/507f1f77bcf86cd799439011')).status).toBe(200);
    expect((await request(viewer).get('/alerts/nope')).status).toBe(404);
    expect((await request(viewer).get('/alerts?status=bogus')).status).toBe(400);
    expect((await request(viewer).get('/alerts?limit=101')).status).toBe(400);
  });
});
