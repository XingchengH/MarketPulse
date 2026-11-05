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
  it('enforces viewer < operator < admin on a test-only acknowledge route', async () => {
    expect((await request(appFor('viewer')).post('/test/alerts/a/acknowledge').set('Cookie', await cookie('viewer'))).status).toBe(403);
    expect((await request(appFor('operator')).post('/test/alerts/a/acknowledge').set('Cookie', await cookie('operator'))).status).toBe(200);
  });

  it('allows only admins to change roles', async () => {
    const repository: AdminUserRepository = {
      listUsers: async () => [],
      setRole: async () => ({ id: 'target', email: 't@example.com', name: 'T', role: 'operator' }),
      countAdmins: async () => 2,
      findUserById: async () => ({ id: 'target', email: 't@example.com', name: 'T', role: 'viewer' }),
    };
    const operator = await request(appFor('operator', repository)).patch('/api/admin/users/target/role').set('Cookie', await cookie('operator')).send({ role: 'operator' });
    const admin = await request(appFor('admin', repository)).patch('/api/admin/users/target/role').set('Cookie', await cookie('admin')).send({ role: 'operator' });
    expect(operator.status).toBe(403);
    expect(admin.status).toBe(200);
  });

  it('prevents demoting the final admin', async () => {
    const repository: AdminUserRepository = {
      listUsers: async () => [],
      setRole: async () => { throw new Error('must not update'); },
      countAdmins: async () => 1,
      findUserById: async () => ({ id: 'admin-1', email: 'a@example.com', name: 'A', role: 'admin' }),
    };
    const response = await request(appFor('admin', repository)).patch('/api/admin/users/admin-1/role').set('Cookie', await cookie('admin')).send({ role: 'viewer' });
    expect(response.status).toBe(409);
  });
});
