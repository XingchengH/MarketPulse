import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Role } from '@marketpulse/contracts';
import { createAdminUsersRouter, type AdminUserRepository } from '../routes/admin-users.js';
import { requireRole, requireUser } from './middleware.js';
import { createTokenService } from './tokens.js';

const tokens = createTokenService('rbac-test-access-secret', 'rbac-test-refresh-pepper');

async function cookie(role: Role) {
  const value = await tokens.signAccessToken({ id: `${role}-1`, email: `${role}@example.com`, name: role, role });
  return `access_token=${value}`;
}

function appFor(role: Role, repository?: AdminUserRepository) {
  const app = express();
  app.use(express.json());
  app.post('/test/alerts/:id/acknowledge', requireUser(tokens), requireRole('operator'), (_req, res) => res.sendStatus(200));
  if (repository) app.use('/api/admin/users', requireUser(tokens), createAdminUsersRouter(repository));
  return app;
}

describe('RBAC', () => {
  it('enforces the complete viewer < operator < admin matrix on a test-only operator route', async () => {
    for (const [role, expected] of [['viewer', 403], ['operator', 200], ['admin', 200]] as const) {
      expect((await request(appFor(role)).post('/test/alerts/a/acknowledge').set('Cookie', await cookie(role))).status).toBe(expected);
    }
    expect((await request(appFor('viewer')).post('/test/alerts/a/acknowledge')).status).toBe(401);
  });

  it('enforces the complete role matrix for admin list and role changes', async () => {
    const repository: AdminUserRepository = {
      listUsers: async () => [],
      setRoleSafely: async () => ({ status: 'updated', user: { id: 'target', email: 't@example.com', name: 'T', role: 'operator' } }),
    };
    for (const [role, expected] of [['viewer', 403], ['operator', 403], ['admin', 200]] as const) {
      const app = appFor(role, repository);
      expect((await request(app).get('/api/admin/users').set('Cookie', await cookie(role))).status).toBe(expected);
      expect((await request(app).patch('/api/admin/users/target/role').set('Cookie', await cookie(role)).send({ role: 'operator' })).status).toBe(expected);
    }
    const anonymous = appFor('viewer', repository);
    expect((await request(anonymous).get('/api/admin/users')).status).toBe(401);
    expect((await request(anonymous).patch('/api/admin/users/target/role').send({ role: 'operator' })).status).toBe(401);
  });

  it('prevents demoting the final admin', async () => {
    const repository: AdminUserRepository = {
      listUsers: async () => [],
      setRoleSafely: async () => ({ status: 'final_admin' }),
    };
    const response = await request(appFor('admin', repository)).patch('/api/admin/users/admin-1/role').set('Cookie', await cookie('admin')).send({ role: 'viewer' });
    expect(response.status).toBe(409);
  });

  it('serializes concurrent admin demotions so one admin always remains', async () => {
    const roles = new Map([['admin-1', 'admin' as Role], ['admin-2', 'admin' as Role]]);
    const repository: AdminUserRepository = {
      listUsers: async () => [],
      async setRoleSafely(id, role) {
        const current = roles.get(id);
        if (!current) return { status: 'not_found' };
        if (current === 'admin' && role !== 'admin' && [...roles.values()].filter((value) => value === 'admin').length <= 1) return { status: 'final_admin' };
        roles.set(id, role);
        return { status: 'updated', user: { id, email: `${id}@example.com`, name: id, role } };
      },
    };
    const app = appFor('admin', repository);
    const responses = await Promise.all([
      request(app).patch('/api/admin/users/admin-1/role').set('Cookie', await cookie('admin')).send({ role: 'viewer' }),
      request(app).patch('/api/admin/users/admin-2/role').set('Cookie', await cookie('admin')).send({ role: 'viewer' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect([...roles.values()].filter((role) => role === 'admin')).toHaveLength(1);
  });
});
