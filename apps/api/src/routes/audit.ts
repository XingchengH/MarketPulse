import { Router } from 'express';
import { requireRole, type CurrentRoleResolver } from '../auth/middleware.js';
import { AuditEvent } from '../models/audit-event.js';
export function createAuditRouter(resolveRole: CurrentRoleResolver): Router {
  const router = Router(); router.use(requireRole('viewer', resolveRole));
  router.get('/', async (_q, r) => r.json({ events: await AuditEvent.find().sort({ createdAt: -1 }).lean() }));
  router.get('/:id', async (q, r) => { const event = await AuditEvent.findById(q.params.id).lean(); return event ? r.json({ event }) : r.status(404).json({ error: { code: 'AUDIT_EVENT_NOT_FOUND', message: 'Audit event not found' } }); });
  return router;
}
