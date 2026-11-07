import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditEvent } from '../models/audit-event.js';
import { createAuditRouter } from './audit.js';

afterEach(() => vi.restoreAllMocks());
describe('audit routes', () => {
  it('allows viewers to list and read events and invalid IDs are 404', async () => {
    vi.spyOn(AuditEvent, 'find').mockReturnValue({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) } as never);
    vi.spyOn(AuditEvent, 'findById').mockReturnValue({ lean: async () => ({ _id: '507f1f77bcf86cd799439011' }) } as never);
    const app = express(); app.use((q, r, n) => { r.locals.user = { sub: 'u', role: 'viewer' }; n(); }); app.use('/audit', createAuditRouter(async () => 'viewer'));
    expect((await request(app).get('/audit')).status).toBe(200);
    expect((await request(app).get('/audit/507f1f77bcf86cd799439011')).status).toBe(200);
    expect((await request(app).get('/audit/nope')).status).toBe(404);
    expect((await request(app).get('/audit?page=0')).status).toBe(400);
  });
});
