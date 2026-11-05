import { Router } from 'express';
import { roleSchema, type Role } from '@marketpulse/contracts';
import type { PublicUser } from './auth.js';
import { requireRole } from '../auth/middleware.js';

export interface AdminUserRepository {
  listUsers(): Promise<PublicUser[]>;
  findUserById(id: string): Promise<PublicUser | null>;
  setRoleSafely(id: string, role: Role): Promise<
    { status: 'updated'; user: PublicUser } | { status: 'not_found' } | { status: 'final_admin' }
  >;
}

export function createAdminUsersRouter(repository: AdminUserRepository): Router {
  const router = Router();
  router.use(requireRole('admin', async (id) => (await repository.findUserById(id))?.role ?? null));
  router.get('/', async (_request, response) => response.json({ users: await repository.listUsers() }));
  router.patch('/:id/role', async (request, response) => {
    const parsed = roleSchema.safeParse(request.body?.role);
    if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_ROLE', message: 'Invalid role' } });
    const result = await repository.setRoleSafely(request.params.id, parsed.data);
    if (result.status === 'not_found') return response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    if (result.status === 'final_admin') return response.status(409).json({ error: { code: 'FINAL_ADMIN', message: 'The final admin cannot be demoted' } });
    response.json({ user: result.user });
  });
  return router;
}
