import { Router } from 'express';
import { requireRole, type CurrentRoleResolver } from '../auth/middleware.js';
import { Alert } from '../models/alert.js';
import { AlertService } from '../monitoring/alert-service.js';
import { AuditService } from '../monitoring/audit-service.js';
export function createAlertsRouter(resolveRole: CurrentRoleResolver, service = new AlertService(), audit = new AuditService()): Router {
  const router = Router();
  router.get('/', requireRole('viewer', resolveRole), async (q, r) => { const filter = typeof q.query.status === 'string' ? { status: q.query.status } : {}; r.json({ alerts: await Alert.find(filter).sort({ lastObservedAt: -1 }).lean() }); });
  router.get('/:id', requireRole('viewer', resolveRole), async (q, r) => { const alert = await Alert.findById(q.params.id).lean(); return alert ? r.json({ alert }) : r.status(404).json({ error: { code: 'ALERT_NOT_FOUND', message: 'Alert not found' } }); });
  router.post('/:id/acknowledge', requireRole('operator', resolveRole), async (q, r) => { const id = String(q.params.id); const alert = await service.acknowledge(id, r.locals.user.sub); if (!alert) return r.status(404).json({ error: { code: 'ALERT_NOT_FOUND', message: 'Active alert not found' } }); await audit.record({ actorId: r.locals.user.sub, action: 'alert.acknowledge', resourceType: 'alert', resourceId: id, requestId: r.locals.requestId, after: alert }); return r.json({ alert }); });
  return router;
}
