import { Router } from 'express';
import { roleSchema, type Role } from '@marketpulse/contracts';
import type { PublicUser } from './auth.js';
import { requireRole } from '../auth/middleware.js';
import type { AuditService } from '../monitoring/audit-service.js';

export type AdminUser = Pick<PublicUser, 'id' | 'email' | 'name' | 'role' | 'lastLoginAt'>;

export interface AdminUserRepository {
  listUsers(): Promise<AdminUser[]>;
  findUserById(id: string): Promise<PublicUser | null>;
  setRoleSafely(id: string, role: Role): Promise<
    { status: 'updated'; user: AdminUser } | { status: 'not_found' } | { status: 'final_admin' }
  >;
}

export function createAdminUsersRouter(repository: AdminUserRepository, audit?: AuditService): Router {
  const router = Router();
  router.use(requireRole('admin', async (id) => (await repository.findUserById(id))?.role ?? null));
  router.get('/', async (_request, response) => response.json({ users: await repository.listUsers() }));
  router.patch('/:id/role', async (request, response) => {
    const parsed = roleSchema.safeParse(request.body?.role);
    if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_ROLE', message: 'Invalid role' } });
    const result = await repository.setRoleSafely(request.params.id, parsed.data);
    if (result.status === 'not_found') return response.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    if (result.status === 'final_admin') return response.status(409).json({ error: { code: 'FINAL_ADMIN', message: 'The final admin cannot be demoted' } });
    await audit?.record({ actorId: (response.locals.user as { sub: string }).sub, action: 'user.role_changed', resourceType: 'user', resourceId: result.user.id, requestId: response.locals.requestId, after: { role: result.user.role } });
    response.json({ user: result.user });
  });
  return router;
}
