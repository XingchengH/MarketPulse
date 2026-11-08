import { Router, type Response } from 'express';
import { requireRole, type CurrentRoleResolver } from '../auth/middleware.js';
import { Alert } from '../models/alert.js';
import { AlertService } from '../monitoring/alert-service.js';
import { Types } from 'mongoose';
import { alertStatusSchema } from '@marketpulse/contracts';
import { parsePagination } from '../http/pagination.js';
import { emptyWatchlistScope, type PersonalWatchlistScope } from './watchlist.js';

const missing = (response: Response, message = 'Alert not found') => response.status(404).json({ error: { code: 'ALERT_NOT_FOUND', message } });

export function createAlertsRouter(resolveRole: CurrentRoleResolver, service: Pick<AlertService, 'acknowledge'> = new AlertService(), watchlist: PersonalWatchlistScope = emptyWatchlistScope): Router {
  const router = Router();
  router.get('/', requireRole('viewer', resolveRole), async (request, response) => {
    const page = parsePagination(request);
    const status = request.query.status === undefined ? undefined : alertStatusSchema.safeParse(request.query.status);
    if (!page || (status && !status.success)) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Invalid alert query' } });
    const symbols = await watchlist.symbols(response.locals.user.sub);
    const filter = { symbol: { $in: symbols }, ...(status?.success ? { status: status.data } : {}) };
    return response.json({ alerts: await Alert.find(filter).sort({ lastObservedAt: -1, _id: -1 }).skip(page.skip).limit(page.limit).lean(), page: { limit: page.limit, page: page.page } });
  });
  router.get('/:id', requireRole('viewer', resolveRole), async (request, response) => {
    const id = String(request.params.id);
    const alert = Types.ObjectId.isValid(id) ? await Alert.findById(id).lean() : null;
    if (!alert || !await watchlist.has(response.locals.user.sub, alert.symbol)) return missing(response);
    return response.json({ alert });
  });
  router.post('/:id/acknowledge', requireRole('operator', resolveRole), async (request, response) => {
    const id = String(request.params.id);
    const existing = Types.ObjectId.isValid(id) ? await Alert.findById(id).lean() : null;
    if (!existing || !await watchlist.has(response.locals.user.sub, existing.symbol)) return missing(response, 'Active alert not found');
    const alert = await service.acknowledge(id, response.locals.user.sub, response.locals.requestId);
    return alert ? response.json({ alert }) : missing(response, 'Active alert not found');
  });
  return router;
}
