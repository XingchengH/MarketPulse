import { Router } from 'express';
import { requireRole, type CurrentRoleResolver } from '../auth/middleware.js';
import { AuditEvent } from '../models/audit-event.js';
import { Types } from 'mongoose';
import { parsePagination } from '../http/pagination.js';

const visibleTo = (userId: string) => ({ $or: [{ ownerUserId: { $exists: false } }, { ownerUserId: userId }] });

export function createAuditRouter(resolveRole: CurrentRoleResolver): Router {
  const router = Router(); router.use(requireRole('viewer', resolveRole));
  router.get('/', async (request, response) => {
    const page = parsePagination(request);
    if (!page) return response.status(400).json({ error: { code: 'INVALID_PAGINATION', message: 'Invalid pagination' } });
    const events = await AuditEvent.find(visibleTo(response.locals.user.sub)).sort({ createdAt: -1, _id: -1 }).skip(page.skip).limit(page.limit).lean();
    return response.json({ events, page: { limit: page.limit, page: page.page } });
  });
  router.get('/:id', async (request, response) => {
    const id = String(request.params.id);
    const event = Types.ObjectId.isValid(id) ? await AuditEvent.findOne({ _id: id, ...visibleTo(response.locals.user.sub) }).lean() : null;
    return event ? response.json({ event }) : response.status(404).json({ error: { code: 'AUDIT_EVENT_NOT_FOUND', message: 'Audit event not found' } });
  });
  return router;
}
