import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createRulesRouter } from './rules.js';

const input = { name: 'Latency', scope: { kind: 'all' as const }, metric: 'observedLatencyMs' as const, operator: 'gt' as const, threshold: 100, durationSeconds: 10, severity: 'critical' as const, enabled: true };
const service = () => ({ list: vi.fn(async () => []), get: vi.fn(async () => ({ ...input, version: 2 })), versions: vi.fn(async () => []), create: vi.fn(async () => ({ ...input, version: 1 })), update: vi.fn(async () => ({ status: 'conflict' as const })), rollback: vi.fn(async () => ({ status: 'updated' as const, rule: { ...input, version: 3 } })) });
const app = (role: 'viewer' | 'operator' | 'admin', current = role, rules = service()) => { const value = express(); value.use(express.json()); value.use((q, r, next) => { r.locals.user = { sub: 'u', role }; r.locals.requestId = 'req'; next(); }); value.use('/rules', createRulesRouter(rules as never, async () => current)); return value; };

describe('rules routes', () => {
  it('uses current role and permits viewers to read only', async () => {
    expect((await request(app('admin', 'viewer')).get('/rules')).status).toBe(200);
    expect((await request(app('admin', 'viewer')).post('/rules').send(input)).status).toBe(403);
  });
  it('returns 409 for an optimistic concurrency conflict', async () => {
    expect((await request(app('admin')).put('/rules/r1').send({ version: 2, rule: input })).status).toBe(409);
  });
  it('rolls a v2 rule into a new v3 version', async () => {
    const rules = service(); const response = await request(app('admin', 'admin', rules)).post('/rules/r1/rollback').send({ version: 2, targetVersion: 1 });
    expect(response.status).toBe(200); expect(response.body.rule.version).toBe(3); expect(rules.rollback).toHaveBeenCalledWith('r1', 1, 2, expect.anything());
  });
});
