import { Router } from 'express';
import { requireRole, type CurrentRoleResolver } from '../auth/middleware.js';
import { Alert } from '../models/alert.js';
import { AlertService } from '../monitoring/alert-service.js';
import { Types } from 'mongoose';
export function createAlertsRouter(resolveRole: CurrentRoleResolver, service = new AlertService()): Router {
  const router = Router();
  router.get('/', requireRole('viewer', resolveRole), async (q, r) => { const filter = typeof q.query.status === 'string' ? { status: q.query.status } : {}; r.json({ alerts: await Alert.find(filter).sort({ lastObservedAt: -1 }).lean() }); });
  router.get('/:id', requireRole('viewer', resolveRole), async (q, r) => { const id = String(q.params.id); const alert = Types.ObjectId.isValid(id) ? await Alert.findById(id).lean() : null; return alert ? r.json({ alert }) : r.status(404).json({ error: { code: 'ALERT_NOT_FOUND', message: 'Alert not found' } }); });
  router.post('/:id/acknowledge', requireRole('operator', resolveRole), async (q, r) => { const id = String(q.params.id); if (!Types.ObjectId.isValid(id)) return r.status(404).json({ error: { code: 'ALERT_NOT_FOUND', message: 'Active alert not found' } }); const alert = await service.acknowledge(id, r.locals.user.sub, r.locals.requestId); if (!alert) return r.status(404).json({ error: { code: 'ALERT_NOT_FOUND', message: 'Active alert not found' } }); return r.json({ alert }); });
  return router;
}
