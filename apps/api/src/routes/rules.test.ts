import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createRulesRouter } from './rules.js';

const input = { name: 'Latency', scope: { kind: 'all' as const }, metric: 'observedLatencyMs' as const, operator: 'gt' as const, threshold: 100, durationSeconds: 10, severity: 'critical' as const, enabled: true };
const service = () => ({ list: vi.fn(async () => []), get: vi.fn(async () => ({ ...input, version: 2 })), versions: vi.fn(async () => []), create: vi.fn(async () => ({ ...input, version: 1 })), update: vi.fn(async () => ({ status: 'conflict' as const })), rollback: vi.fn(async () => ({ status: 'updated' as const, rule: { ...input, version: 3 } })) });
const app = (role: 'viewer' | 'operator' | 'admin', current = role, rules = service()) => { const value = express(); value.use(express.json()); value.use((q, r, next) => { r.locals.user = { sub: 'u', role }; r.locals.requestId = 'req'; next(); }); value.use('/rules', createRulesRouter(rules as never, async () => current)); return value; };

describe('rules routes', () => {
  const ruleId = '507f1f77bcf86cd799439011';
  it('uses current role and permits viewers to read only', async () => {
    expect((await request(app('admin', 'viewer')).get('/rules')).status).toBe(200);
    expect((await request(app('viewer')).get(`/rules/${ruleId}`)).status).toBe(200);
    expect((await request(app('admin', 'viewer')).post('/rules').send(input)).status).toBe(403);
  });
  it('returns 404 for invalid IDs and versions of a missing rule', async () => {
    expect((await request(app('viewer')).get('/rules/not-an-id')).status).toBe(404);
    const rules = service(); rules.get.mockResolvedValueOnce(null as never);
    expect((await request(app('viewer', 'viewer', rules)).get(`/rules/${ruleId}/versions`)).status).toBe(404);
  });
  it('returns 409 for an optimistic concurrency conflict', async () => {
    expect((await request(app('admin')).put(`/rules/${ruleId}`).send({ version: 2, rule: input })).status).toBe(409);
  });
  it('rolls a v2 rule into a new v3 version', async () => {
    const rules = service(); const response = await request(app('admin', 'admin', rules)).post(`/rules/${ruleId}/rollback`).send({ version: 2, targetVersion: 1 });
    expect(response.status).toBe(200); expect(response.body.rule.version).toBe(3); expect(rules.rollback).toHaveBeenCalledWith(ruleId, 1, 2, expect.anything());
  });
});
