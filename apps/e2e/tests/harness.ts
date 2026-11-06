import type { Page, Route } from '@playwright/test';
import { FakeGoogleIdentityProvider } from '../../api/src/test-helpers/fake-google.js';
import { FakeMarketDataProvider } from '../../api/src/test-helpers/fake-provider.js';
import { MarketDataAggregator } from '../../api/src/market-data/aggregator.js';

export function createE2eHarness() {
  if (process.env.NODE_ENV !== 'test') throw new Error('E2E dependency injection is restricted to NODE_ENV=test');
  const google = new FakeGoogleIdentityProvider({ subject: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin' });
  const provider = new FakeMarketDataProvider();
  const aggregator = new MarketDataAggregator({ marketClock: { get: async () => ({ isOpen: true, nextOpen: '', nextClose: '' }) } });
  const db = { authenticated: false, alerts: [] as Array<Record<string, unknown>> };
  provider.onEvent(event => {
    aggregator.ingest(event);
    db.alerts = [{ _id: '507f1f77bcf86cd799439011', symbol: event.symbol, metric: 'observedLatencyMs', severity: 'warning', status: 'open', value: Date.parse(event.receivedAt) - Date.parse(event.providerTimestamp), threshold: 25, lastObservedAt: event.receivedAt }];
  });

  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  async function install(page: Page) {
    await provider.connect(['AAPL']);
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/setup/status') return json(route, { configured: true, services: { mongodb: 'ready', googleOAuth: 'ready', alpaca: 'ready', tokens: 'ready' } });
      if (url.pathname === '/api/auth/google') { await google.exchange('fake-google-code'); db.authenticated = true; return route.fulfill({ status: 302, headers: { location: '/' } }); }
      if (url.pathname === '/api/auth/me') return db.authenticated ? json(route, { user: { id: 'e2e-admin', email: 'admin@example.test', name: 'Test Admin', role: 'admin' } }) : json(route, { error: { code: 'UNAUTHENTICATED' } }, 401);
      if (url.pathname === '/api/overview') return json(route, { provider: 'alpaca', providerState: provider.state(), symbols: ['AAPL'] });
      if (url.pathname === '/api/symbols') return json(route, { symbols: [await aggregator.snapshotWithMarketState('AAPL')] });
      if (url.pathname === '/api/alerts' && route.request().method() === 'GET') return json(route, { alerts: db.alerts, page: { limit: 50, page: 1 } });
      if (url.pathname.endsWith('/acknowledge')) { const alert = db.alerts[0]; if (alert) Object.assign(alert, { status: 'acknowledged', acknowledgedBy: 'Test Admin', acknowledgedAt: new Date().toISOString() }); return json(route, { alert }); }
      if (url.pathname === '/api/rules') return json(route, { rules: [] });
      if (url.pathname === '/api/audit') return json(route, { events: [] });
      if (url.pathname === '/api/admin/users') return json(route, { users: [] });
      if (url.pathname === '/api/watchlist') return json(route, { watchlist: [] });
      return json(route, { error: { code: 'NOT_FOUND' } }, 404);
    });
  }
  return { google, provider, db, install };
}
