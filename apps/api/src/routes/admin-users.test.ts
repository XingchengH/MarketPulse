import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAdminUsersRouter, type AdminUserRepository } from './admin-users.js';
import { Types } from 'mongoose';

const userId = new Types.ObjectId().toString();
const admin = { id: userId, email: 'admin@example.com', name: 'Admin', role: 'admin' as const, lastLoginAt: new Date('2026-01-01') };
const setup = (currentRole: 'admin' | 'viewer' = 'admin', result: Awaited<ReturnType<AdminUserRepository['setRoleSafely']>> = { status: 'updated', user: { ...admin, role: 'operator' }, previousRole: 'viewer' }) => {
  const repository: AdminUserRepository = { listUsers: vi.fn(async () => [admin]), findUserById: vi.fn(async () => ({ ...admin, role: currentRole })), setRoleSafely: vi.fn(async () => result) };
  const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.user = { sub: 'actor', role: 'admin' }; res.locals.requestId = 'req'; next(); }); app.use('/users', createAdminUsersRouter(repository));
  return { app, repository };
};

describe('user administration', () => {
  it('lists only the public user shape', async () => { const response = await request(setup().app).get('/users').expect(200); expect(response.body.users[0]).toMatchObject({ email: admin.email, name: admin.name, role: 'admin' }); expect(response.body.users[0]).not.toHaveProperty('googleSubject'); expect(response.body.users[0]).not.toHaveProperty('refreshTokens'); expect(response.body.users[0]).not.toHaveProperty('picture'); });
  it('uses the current database role and protects the final admin', async () => { await request(setup('viewer').app).get('/users').expect(403); await request(setup('admin', { status: 'final_admin' }).app).patch(`/users/${userId}/role`).send({ role: 'viewer' }).expect(409); });
  it('passes required audit identity into the atomic repository mutation', async () => { const { app, repository } = setup(); await request(app).patch(`/users/${userId}/role`).send({ role: 'operator' }).expect(200); expect(repository.setRoleSafely).toHaveBeenCalledWith(userId, 'operator', { actorId: 'actor', requestId: 'req' }); });
  it('rejects malformed user IDs before repository access', async () => { const { app, repository } = setup(); await request(app).patch('/users/not-an-object-id/role').send({ role: 'operator' }).expect(400); expect(repository.setRoleSafely).not.toHaveBeenCalled(); });
});
