import { Router } from 'express';
import { requireRole, type CurrentRoleResolver } from '../auth/middleware.js';
import { AuditEvent } from '../models/audit-event.js';
import { Types } from 'mongoose';
import { parsePagination } from '../http/pagination.js';
export function createAuditRouter(resolveRole: CurrentRoleResolver): Router {
  const router = Router(); router.use(requireRole('viewer', resolveRole));
  router.get('/', async (q, r) => { const page = parsePagination(q); if (!page) return r.status(400).json({ error: { code: 'INVALID_PAGINATION', message: 'Invalid pagination' } }); return r.json({ events: await AuditEvent.find().sort({ createdAt: -1, _id: -1 }).skip(page.skip).limit(page.limit).lean(), page: { limit: page.limit, page: page.page } }); });
  router.get('/:id', async (q, r) => { const id = String(q.params.id); const event = Types.ObjectId.isValid(id) ? await AuditEvent.findById(id).lean() : null; return event ? r.json({ event }) : r.status(404).json({ error: { code: 'AUDIT_EVENT_NOT_FOUND', message: 'Audit event not found' } }); });
  return router;
}
