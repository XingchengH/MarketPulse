import { Router } from 'express';
import { roleSchema, type Role } from '@marketpulse/contracts';
import type { PublicUser } from './auth.js';
import { requireRole } from '../auth/middleware.js';

export interface AdminUserRepository {
  listUsers(): Promise<PublicUser[]>;
  findUserById(id: string): Promise<PublicUser | null>;
  countAdmins(): Promise<number>;
  setRole(id: string, role: Role): Promise<PublicUser | null>;
}

export function createAdminUsersRouter(repository: AdminUserRepository): Router {
  const router = Router();
  router.use(requireRole('admin'));
  router.get('/', async (_request, response) => response.json({ users: await repository.listUsers() }));
  router.patch('/:id/role', async (request, response) => {
    const parsed = roleSchema.safeParse(request.body?.role);
    if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_ROLE', message: 'Invalid role' } });
    const current = await repository.findUserById(request.params.id);
    if (!current) return response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    if (current.role === 'admin' && parsed.data !== 'admin' && await repository.countAdmins() <= 1) {
      return response.status(409).json({ error: { code: 'FINAL_ADMIN', message: 'The final admin cannot be demoted' } });
    }
    response.json({ user: await repository.setRole(request.params.id, parsed.data) });
  });
  return router;
}
