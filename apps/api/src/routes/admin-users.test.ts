import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAdminUsersRouter, type AdminUserRepository } from './admin-users.js';
import { AuditService } from '../monitoring/audit-service.js';

const admin = { id: 'a', email: 'admin@example.com', name: 'Admin', role: 'admin' as const, lastLoginAt: new Date('2026-01-01') };
const setup = (currentRole: 'admin' | 'viewer' = 'admin', result: Awaited<ReturnType<AdminUserRepository['setRoleSafely']>> = { status: 'updated', user: { ...admin, role: 'operator' } }) => {
  const repository: AdminUserRepository = { listUsers: vi.fn(async () => [admin]), findUserById: vi.fn(async () => ({ ...admin, role: currentRole })), setRoleSafely: vi.fn(async () => result) };
  const append = vi.fn(async () => undefined); const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.user = { sub: 'actor', role: 'admin' }; res.locals.requestId = 'req'; next(); }); app.use('/users', createAdminUsersRouter(repository, new AuditService({ append })));
  return { app, append };
};

describe('user administration', () => {
  it('lists only the public user shape', async () => { const response = await request(setup().app).get('/users').expect(200); expect(response.body.users[0]).toMatchObject({ email: admin.email, name: admin.name, role: 'admin' }); expect(response.body.users[0]).not.toHaveProperty('googleSubject'); expect(response.body.users[0]).not.toHaveProperty('refreshTokens'); expect(response.body.users[0]).not.toHaveProperty('picture'); });
  it('uses the current database role and protects the final admin', async () => { await request(setup('viewer').app).get('/users').expect(403); await request(setup('admin', { status: 'final_admin' }).app).patch('/users/a/role').send({ role: 'viewer' }).expect(409); });
  it('records an audit event after changing a role', async () => { const { app, append } = setup(); await request(app).patch('/users/a/role').send({ role: 'operator' }).expect(200); expect(append).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor', action: 'user.role_changed', resourceId: 'a', after: { role: 'operator' } })); });
});
