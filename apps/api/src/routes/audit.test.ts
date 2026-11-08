import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditEvent } from '../models/audit-event.js';
import { createAuditRouter } from './audit.js';

const alice = '507f1f77bcf86cd799439001';
const bob = '507f1f77bcf86cd799439002';
const eventId = (id: number) => id.toString(16).padStart(24, '0');
const personalEvents = [
  { _id: eventId(1), ownerUserId: alice, action: 'watchlist.symbol_added', actorId: bob },
  { _id: eventId(2), ownerUserId: bob, action: 'watchlist.symbol_added', actorId: alice },
  { _id: eventId(3), ownerUserId: alice, action: 'watchlist.symbol_removed', actorId: bob },
  { _id: eventId(4), ownerUserId: bob, action: 'watchlist.symbol_removed', actorId: alice },
];
const sharedEvents = [
  { _id: eventId(5), action: 'rule.created', actorId: alice },
  // The pre-personal global watchlist audit format has no explicit owner.
  { _id: eventId(6), action: 'watchlist.symbol_added', actorId: alice },
];
const events = [...personalEvents, ...sharedEvents];
type Event = typeof events[number];
type Filter = { _id?: string; $or?: Array<{ ownerUserId: string | { $exists: boolean } }> };
const visibleFilter = (userId: string) => ({ $or: [{ ownerUserId: { $exists: false } }, { ownerUserId: userId }] });
const matches = (event: Event, filter?: Filter): boolean => {
  if (filter?._id && event._id !== filter._id) return false;
  return !filter?.$or || filter.$or.some(condition => typeof condition.ownerUserId === 'string'
    ? 'ownerUserId' in event && event.ownerUserId === condition.ownerUserId
    : ('ownerUserId' in event) === condition.ownerUserId.$exists);
};
const setup = (role: 'viewer' | 'admin') => {
  const find = vi.spyOn(AuditEvent, 'find').mockImplementation((filter?: Filter) => {
    const filtered = events.filter(event => matches(event, filter));
    return { sort: () => ({ skip: (skip: number) => ({ limit: (limit: number) => ({ lean: async () => filtered.slice(skip, skip + limit) }) }) }) } as never;
  });
  const findOne = vi.spyOn(AuditEvent, 'findOne').mockImplementation((filter?: Filter) => ({ lean: async () => events.find(event => matches(event, filter)) ?? null }) as never);
  vi.spyOn(AuditEvent, 'findById').mockImplementation((id: string) => ({ lean: async () => events.find(event => event._id === id) ?? null }) as never);
  const app = express();
  app.use((req, res, next) => { res.locals.user = { sub: req.header('x-user') ?? alice, role }; next(); });
  app.use('/audit', createAuditRouter(async () => role));
  return { app, find, findOne };
};

afterEach(() => vi.restoreAllMocks());
describe('audit routes', () => {
  for (const role of ['viewer', 'admin'] as const) {
    it(`scopes personal audit lists to each ${role} while retaining shared events`, async () => {
      const { app, find } = setup(role);
      for (const userId of [alice, bob]) {
        const response = await request(app).get(`/audit?userId=${userId === alice ? bob : alice}`).set('x-user', userId).expect(200);
        expect(response.body.events).toEqual([...personalEvents.filter(event => event.ownerUserId === userId), ...sharedEvents]);
        expect(find).toHaveBeenLastCalledWith(visibleFilter(userId));
      }
    });

    it(`keeps other users' personal audit details private from ${role}s`, async () => {
      const { app, findOne } = setup(role);
      for (const userId of [alice, bob]) {
        for (const event of personalEvents) {
          const response = await request(app).get(`/audit/${event._id}?userId=${event.ownerUserId}`).set('x-user', userId);
          if (event.ownerUserId === userId) expect(response.status).toBe(200);
          else { expect(response.status).toBe(404); expect(response.body).toEqual({ error: { code: 'AUDIT_EVENT_NOT_FOUND', message: 'Audit event not found' } }); }
          expect(findOne).toHaveBeenLastCalledWith({ _id: event._id, ...visibleFilter(userId) });
        }
        for (const event of sharedEvents) expect((await request(app).get(`/audit/${event._id}`).set('x-user', userId).expect(200)).body.event).toEqual(event);
      }
    });
  }

  it('filters private audits before applying pagination', async () => {
    const { app, find } = setup('viewer');
    const response = await request(app).get('/audit?limit=1&page=2').set('x-user', bob).expect(200);
    expect(response.body.events).toEqual([personalEvents[3]]);
    expect(response.body.page).toEqual({ limit: 1, page: 2 });
    expect(find).toHaveBeenCalledWith(visibleFilter(bob));
  });

  it('allows viewers to list and read events and invalid IDs are 404', async () => {
    vi.spyOn(AuditEvent, 'find').mockReturnValue({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) } as never);
    vi.spyOn(AuditEvent, 'findOne').mockReturnValue({ lean: async () => ({ _id: '507f1f77bcf86cd799439011' }) } as never);
    const app = express(); app.use((q, r, n) => { r.locals.user = { sub: 'u', role: 'viewer' }; n(); }); app.use('/audit', createAuditRouter(async () => 'viewer'));
    expect((await request(app).get('/audit')).status).toBe(200);
    expect((await request(app).get('/audit/507f1f77bcf86cd799439011')).status).toBe(200);
    expect((await request(app).get('/audit/nope')).status).toBe(404);
    expect((await request(app).get('/audit?page=0')).status).toBe(400);
  });
});
