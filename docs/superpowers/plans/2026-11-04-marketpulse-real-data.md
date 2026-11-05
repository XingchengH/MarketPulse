# MarketPulse Real-Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved MarketPulse prototype into a tested full-stack application that authenticates users with Google, consumes real Alpaca IEX events, derives honest stream-health metrics, persists rules and alerts, and never substitutes synthetic production data.

**Architecture:** Convert the repository to a pnpm workspace with a Vite React client, an Express/Socket.IO API, and a shared Zod contracts package. The API owns Google OAuth, secure cookie tokens, MongoDB, Alpaca connectivity, aggregation, rules, alerts, and audit records. The client obtains initial state over REST and applies bounded Socket.IO snapshots as Redux Toolkit cache updates.

**Tech Stack:** TypeScript, React 19, Redux Toolkit, Vite, Express, Socket.IO, Mongoose/MongoDB, Zod, jose, Arctic Google OAuth, ws, Vitest, React Testing Library, Supertest, Testcontainers, Playwright, Docker Compose.

---

## Repository Map

Create this structure while preserving the approved UI styling:

```text
apps/
  api/
    src/
      app.ts                  Express composition without listening
      server.ts               process startup and graceful shutdown
      config.ts               validated environment configuration
      db.ts                   MongoDB lifecycle
      http/                   middleware, errors, request context
      auth/                   Google OAuth, JWT cookies, refresh rotation, RBAC
      market-data/            provider interface, Alpaca adapter, aggregation, clock
      monitoring/             rule evaluation, alerts, audit events
      routes/                 REST route modules
      realtime/               authenticated Socket.IO server
      models/                 focused Mongoose models
    test/                     API and service integration tests
  web/
    src/
      app/                    Redux store, API client, router, socket bridge
      auth/                   login and session state
      dashboard/              overview and feed components
      alerts/                 alert views and mutations
      rules/                  rule views and version history
      audit/                  audit views
      admin/                  watchlist and role administration
      setup/                  missing-configuration and service states
      components/             shared layout and controls
      styles.css              migrated visual system
    test/                     component and workflow tests
packages/
  contracts/
    src/                      Zod schemas and inferred TypeScript types
docker-compose.yml
.env.example
```

The existing `src/App.tsx` is 154 physical lines but contains many large single-line components and all stateful workflows. Split it by feature during the client migration rather than adding more behavior to it.

---

### Task 0: Preserve the approved prototype baseline

**Files:**
- Add to Git: `.gitignore`, `DESIGN.md`, `README.md`, `index.html`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `src/**`, `tsconfig.json`, `vite.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Ignore generated TypeScript state**

Add this line to `.gitignore`:

```gitignore
*.tsbuildinfo
```

- [ ] **Step 2: Verify the current prototype still builds**

Run: `pnpm run build`

Expected: exit 0 and a Vite production build under `dist/`.

- [ ] **Step 3: Commit the prototype separately from full-stack changes**

```bash
git add .gitignore DESIGN.md README.md index.html package.json pnpm-lock.yaml pnpm-workspace.yaml src tsconfig.json vite.config.ts
git commit -m "feat: add MarketPulse dashboard prototype"
```

Expected: the approved frontend has a recoverable baseline commit.

---

### Task 1: Create the workspace and shared contracts

**Files:**
- Modify: `package.json`, `pnpm-workspace.yaml`, `.gitignore`
- Move: `src/**` to `apps/web/src/**`
- Move: `index.html`, `vite.config.ts`, `tsconfig.json` to `apps/web/`
- Create: `apps/web/package.json`, `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`, `packages/contracts/src/market.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/monitoring.ts`
- Test: `packages/contracts/src/contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/src/contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { marketEventSchema, roleSchema, ruleInputSchema } from './index.js';

describe('shared contracts', () => {
  it('accepts normalized Alpaca events', () => {
    expect(marketEventSchema.parse({
      provider: 'alpaca', feed: 'iex', symbol: 'AAPL', type: 'trade',
      providerTimestamp: '2026-11-04T20:00:00.000Z',
      receivedAt: '2026-11-04T20:00:00.025Z', price: 201.5, size: 100,
    }).symbol).toBe('AAPL');
  });

  it('rejects unknown roles and invalid rule durations', () => {
    expect(roleSchema.safeParse('owner').success).toBe(false);
    expect(ruleInputSchema.safeParse({
      name: 'Latency', scope: { kind: 'all' }, metric: 'observedLatencyMs',
      operator: 'gt', threshold: 100, durationSeconds: 0,
      severity: 'critical', enabled: true,
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract tests and confirm they fail**

Run: `pnpm --filter @marketpulse/contracts test`

Expected: failure because the package and schemas do not exist.

- [ ] **Step 3: Define exact shared schemas**

Create schemas with these exported names and values:

```ts
export const roleSchema = z.enum(['viewer', 'operator', 'admin']);
export const marketEventTypeSchema = z.enum(['trade', 'quote']);
export const providerStateSchema = z.enum([
  'unconfigured', 'connecting', 'connected', 'reconnecting',
  'market_closed', 'rate_limited', 'unavailable',
]);
export const ruleMetricSchema = z.enum([
  'observedLatencyMs', 'messagesPerSecond', 'lastEventAgeSeconds',
  'providerErrors', 'reconnects',
]);
export const ruleOperatorSchema = z.enum(['gt', 'gte', 'lt', 'lte']);
export const alertStatusSchema = z.enum(['open', 'recovered', 'acknowledged']);
```

`marketEventSchema` must require UTC datetime strings, an uppercase symbol, positive prices and sizes when present, and quote bid/ask fields when type is `quote`. `ruleInputSchema` must require a positive duration and finite non-negative threshold. Export inferred types from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Configure workspace scripts**

The root package scripts must be:

```json
{
  "dev": "pnpm --parallel --filter @marketpulse/api --filter @marketpulse/web dev",
  "build": "pnpm -r build",
  "test": "pnpm -r test",
  "typecheck": "pnpm -r typecheck"
}
```

Use `workspace:*` for internal package dependencies. Keep one root lockfile.

- [ ] **Step 5: Run contracts and workspace builds**

Run: `pnpm install && pnpm --filter @marketpulse/contracts test && pnpm build`

Expected: contract tests pass and the migrated web app builds.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml apps packages .gitignore
git commit -m "build: create MarketPulse workspace and contracts"
```

---

### Task 2: Add configuration, MongoDB, health, and setup status

**Files:**
- Create: `.env.example`, `docker-compose.yml`
- Create: `apps/api/src/config.ts`, `apps/api/src/db.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Create: `apps/api/src/http/errors.ts`, `apps/api/src/http/request-context.ts`
- Create: `apps/api/src/routes/health.ts`, `apps/api/src/routes/setup.ts`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/health.test.ts`

- [ ] **Step 1: Write failing configuration and health tests**

```ts
it('reports missing integration configuration without leaking values', async () => {
  const response = await request(createApp(testDeps({ configured: false })))
    .get('/api/setup/status').expect(200);
  expect(response.body).toEqual({
    configured: false,
    services: { mongodb: 'ready', googleOAuth: 'missing', alpaca: 'missing', tokens: 'ready' },
  });
  expect(JSON.stringify(response.body)).not.toContain('secret');
});

it('keeps liveness up while readiness reports unavailable dependencies', async () => {
  const app = createApp(testDeps({ mongoReady: false }));
  await request(app).get('/health/live').expect(200, { status: 'live' });
  await request(app).get('/health/ready').expect(503);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @marketpulse/api test -- config.test.ts health.test.ts`

Expected: module-not-found or missing-route failures.

- [ ] **Step 3: Implement validated configuration**

`loadConfig(env)` must validate these variables with Zod and return redaction-safe status separately from secret values:

```text
NODE_ENV, PORT, WEB_ORIGIN, MONGODB_URI,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
ALPACA_API_KEY, ALPACA_API_SECRET,
ACCESS_TOKEN_SECRET, REFRESH_TOKEN_PEPPER
```

Local startup may proceed with missing Google or Alpaca values so the setup screen can load. Production startup must reject token secrets shorter than 32 characters. `.env.example` contains names, local URLs, and instructions but no usable secrets.

- [ ] **Step 4: Implement process-independent Express composition**

`createApp(deps)` returns an Express app without binding a port. Add request IDs, JSON limits, Helmet, strict CORS, JSON 404 and error responses, `/health/live`, `/health/ready`, and `/api/setup/status`. Error responses use:

```ts
{ error: { code: string; message: string; requestId: string } }
```

- [ ] **Step 5: Add MongoDB lifecycle and Docker Compose**

`connectDatabase(uri)` must expose `connect`, `disconnect`, and `isReady`. Compose runs MongoDB 8 with a named volume and a health check. It does not embed production credentials.

- [ ] **Step 6: Run focused and full API checks**

Run: `pnpm --filter @marketpulse/api test -- config.test.ts health.test.ts && pnpm --filter @marketpulse/api typecheck`

Expected: all focused tests and typechecking pass.

- [ ] **Step 7: Commit**

```bash
git add .env.example docker-compose.yml apps/api
git commit -m "feat(api): add configuration and service health"
```

---

### Task 3: Implement Google OAuth, secure cookies, refresh rotation, and RBAC

**Files:**
- Create: `apps/api/src/models/user.ts`, `apps/api/src/models/refresh-token.ts`
- Create: `apps/api/src/auth/google-provider.ts`, `apps/api/src/auth/tokens.ts`, `apps/api/src/auth/cookies.ts`, `apps/api/src/auth/middleware.ts`, `apps/api/src/auth/rbac.ts`
- Create: `apps/api/src/routes/auth.ts`, `apps/api/src/routes/admin-users.ts`
- Test: `apps/api/test/auth.test.ts`, `apps/api/test/rbac.test.ts`

- [ ] **Step 1: Write failing OAuth boundary and RBAC tests**

```ts
it('creates a viewer from a verified Google callback', async () => {
  google.exchange.mockResolvedValue({
    subject: 'google-123', email: 'analyst@example.com',
    name: 'Market Analyst', picture: 'https://example.test/avatar.png',
  });
  const agent = request.agent(createApp(deps));
  const start = await agent.get('/api/auth/google').expect(302);
  const state = readStateCookie(start.headers['set-cookie']);
  await agent.get(`/api/auth/google/callback?code=ok&state=${state}`).expect(302, '/');
  expect(await User.findOne({ googleSubject: 'google-123' }).lean())
    .toMatchObject({ role: 'viewer', email: 'analyst@example.com' });
});

it.each([
  ['viewer', '/api/alerts/a1/acknowledge', 403],
  ['operator', '/api/alerts/a1/acknowledge', 200],
  ['operator', '/api/admin/users/u1/role', 403],
  ['admin', '/api/admin/users/u1/role', 200],
])('%s access to %s returns %i', async (role, path, expected) => {
  await request(asRole(role)).post(path).send({ role: 'operator' }).expect(expected);
});
```

- [ ] **Step 2: Confirm auth tests fail**

Run: `pnpm --filter @marketpulse/api test -- auth.test.ts rbac.test.ts`

Expected: missing auth modules and routes.

- [ ] **Step 3: Implement the provider boundary and user model**

Define `GoogleIdentityProvider` with `authorizationUrl(state)` and `exchange(code)` methods. The production implementation uses Arctic; tests inject a fake. Store Google's subject, normalized email, display name, picture URL, role, last-login time, and timestamps. Do not store Google access or refresh tokens because the app needs identity only.

- [ ] **Step 4: Implement cookie tokens and rotation**

Use `jose` HS256 access tokens with 15-minute expiry. Refresh tokens contain a random opaque value; persist only an HMAC-SHA256 hash using `REFRESH_TOKEN_PEPPER`. Rotate on `/api/auth/refresh`, invalidate the prior document, and revoke the family when an invalidated token is reused.

Cookies use `HttpOnly`, `SameSite=Lax`, path scoping, and `Secure` in production. The callback validates the state cookie before exchanging the code.

- [ ] **Step 5: Implement server authorization**

Export `requireUser`, `requireRole('operator')`, and `requireRole('admin')`. Role order is viewer < operator < admin. Add `/api/auth/me`, `/api/auth/refresh`, `/api/auth/logout`, and admin role mutation. Prevent an admin from demoting the last remaining admin.

- [ ] **Step 6: Run auth tests and security assertions**

Run: `pnpm --filter @marketpulse/api test -- auth.test.ts rbac.test.ts`

Expected: OAuth state mismatch, expired access, refresh reuse, logout, and RBAC cases all pass; response bodies contain no token values.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth apps/api/src/models apps/api/src/routes apps/api/test
git commit -m "feat(auth): add Google OAuth and server RBAC"
```

---

### Task 4: Connect Alpaca IEX and derive real stream metrics

**Files:**
- Create: `apps/api/src/market-data/provider.ts`, `apps/api/src/market-data/alpaca-provider.ts`
- Create: `apps/api/src/market-data/normalizer.ts`, `apps/api/src/market-data/aggregator.ts`
- Create: `apps/api/src/market-data/market-clock.ts`, `apps/api/src/market-data/reconnect.ts`
- Create: `apps/api/src/models/watchlist.ts`, `apps/api/src/models/metric-bucket.ts`
- Create: `apps/api/src/routes/market-data.ts`
- Test: `apps/api/test/normalizer.test.ts`, `apps/api/test/aggregator.test.ts`, `apps/api/test/reconnect.test.ts`

- [ ] **Step 1: Write failing normalization and aggregation tests**

```ts
it('normalizes an Alpaca trade and measures backend receive time', () => {
  const event = normalizeAlpacaMessage(
    { T: 't', S: 'AAPL', p: 201.5, s: 100, t: '2026-11-04T20:00:00.000Z' },
    new Date('2026-11-04T20:00:00.025Z'),
  );
  expect(event).toMatchObject({
    provider: 'alpaca', feed: 'iex', type: 'trade', symbol: 'AAPL',
    price: 201.5, size: 100,
  });
});

it('buckets real events without claiming exchange-wide throughput', () => {
  const aggregator = new MarketAggregator(clock);
  aggregator.accept(trade('AAPL', 25));
  aggregator.accept(quote('AAPL', 40));
  expect(aggregator.snapshot('AAPL')).toMatchObject({
    receivedMessagesPerSecond: 2,
    observedLatencyMs: { latest: 40, p95: 40 },
  });
});
```

- [ ] **Step 2: Confirm the focused tests fail**

Run: `pnpm --filter @marketpulse/api test -- normalizer.test.ts aggregator.test.ts reconnect.test.ts`

Expected: missing market-data modules.

- [ ] **Step 3: Define the provider interface**

```ts
export interface MarketDataProvider {
  readonly name: 'alpaca';
  state(): ProviderState;
  connect(symbols: string[]): Promise<void>;
  replaceSubscriptions(symbols: string[]): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(listener: (event: MarketEvent) => void): () => void;
  onOperationalEvent(listener: (event: ProviderOperationalEvent) => void): () => void;
  getMarketClock(): Promise<MarketClock>;
}
```

The test provider implements the same interface. Production construction refuses `fake` unless `NODE_ENV=test`.

- [ ] **Step 4: Implement Alpaca authentication and event handling**

Connect to `wss://stream.data.alpaca.markets/v2/iex`, authenticate using server-side environment values, then subscribe to trades and quotes for the watchlist. Parse status, error, subscription, trade, and quote messages. Never log the auth frame or keys.

- [ ] **Step 5: Implement aggregation and persistence**

Track latest trade, quote, spread, message count, last event, latency samples, provider errors, reconnects, and stale duration per symbol. Bound latency samples with a fixed-size ring buffer. Persist one-minute buckets with a unique compound index on `{ symbol, bucketStart }` and upsert semantics.

- [ ] **Step 6: Implement market-clock-aware staleness and reconnects**

Fetch Alpaca's clock via HTTPS, cache it for 30 seconds, and expose `open`, `nextOpen`, and `nextClose`. Staleness rules run only while `open=true`. Reconnect delay uses full jitter with a 1-second base and 30-second cap. Reset the attempt counter only after a stable connection.

- [ ] **Step 7: Add read endpoints**

Add authenticated `GET /api/overview`, `GET /api/symbols`, `GET /api/symbols/:symbol`, and `GET /api/metrics?symbol=&from=&to=&interval=1m`. Validate symbols and cap history ranges to seven days.

- [ ] **Step 8: Run market-data tests**

Run: `pnpm --filter @marketpulse/api test -- normalizer.test.ts aggregator.test.ts reconnect.test.ts && pnpm --filter @marketpulse/api typecheck`

Expected: real-message fixtures, percentile calculation, bounded buffers, closed-market state, and reconnect timing pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/market-data apps/api/src/models apps/api/src/routes apps/api/test
git commit -m "feat(data): ingest Alpaca IEX stream metrics"
```

---

### Task 5: Add rules, alerts, versioning, and audit history

**Files:**
- Create: `apps/api/src/models/rule.ts`, `apps/api/src/models/rule-version.ts`
- Create: `apps/api/src/models/alert.ts`, `apps/api/src/models/audit-event.ts`
- Create: `apps/api/src/monitoring/evaluator.ts`, `apps/api/src/monitoring/alert-service.ts`, `apps/api/src/monitoring/audit-service.ts`
- Create: `apps/api/src/routes/rules.ts`, `apps/api/src/routes/alerts.ts`, `apps/api/src/routes/audit.ts`
- Test: `apps/api/test/evaluator.test.ts`, `apps/api/test/rules.test.ts`, `apps/api/test/alerts.test.ts`, `apps/api/test/audit.test.ts`

- [ ] **Step 1: Write failing rule and alert service tests**

```ts
it('opens one alert only after a sustained rule violation', async () => {
  const rule = latencyRule({ threshold: 100, durationSeconds: 10 });
  await evaluator.evaluate(rule, symbolSnapshot({ latency: 120 }), atSecond(0));
  await evaluator.evaluate(rule, symbolSnapshot({ latency: 125 }), atSecond(9));
  expect(await Alert.countDocuments()).toBe(0);
  await evaluator.evaluate(rule, symbolSnapshot({ latency: 130 }), atSecond(10));
  await evaluator.evaluate(rule, symbolSnapshot({ latency: 135 }), atSecond(11));
  expect(await Alert.countDocuments({ ruleId: rule.id, symbol: 'AAPL' })).toBe(1);
});

it('creates a new immutable version on rollback', async () => {
  const rule = await createRule({ threshold: 100 });
  await updateRule(rule.id, { threshold: 120 });
  const restored = await rollbackRule(rule.id, 1);
  expect(restored).toMatchObject({ version: 3, threshold: 100 });
  expect(await RuleVersion.countDocuments({ ruleId: rule.id })).toBe(3);
});
```

- [ ] **Step 2: Confirm monitoring tests fail**

Run: `pnpm --filter @marketpulse/api test -- evaluator.test.ts rules.test.ts alerts.test.ts audit.test.ts`

Expected: missing models and services.

- [ ] **Step 3: Implement immutable rule versions**

Use a transaction for rule mutation, version snapshot, and audit write. Enforce optimistic concurrency with the current version. Rollback copies the selected old snapshot into a new current version; it never deletes history.

- [ ] **Step 4: Implement stateful evaluation and deduplication**

Maintain violation start times by `{ruleId, symbol}`. Create a unique partial index preventing more than one non-acknowledged active alert for that pair. Crossing back to a healthy value marks an open alert `recovered`; acknowledgement records actor and timestamp and does not modify measured health.

- [ ] **Step 5: Implement redacted audits**

`writeAudit()` receives explicit safe before/after objects and rejects keys matching `/secret|token|password|cookie|key/i`. Store actor, action, resource, request ID, timestamp, and safe diffs. Audit documents are append-only through application services.

- [ ] **Step 6: Add authorized routes**

Viewer: list/read rules, alerts, and audits. Operator: acknowledge alerts. Admin: create/update/toggle/rollback rules. Return 409 on stale version updates and 404 for missing resources.

- [ ] **Step 7: Run monitoring tests**

Run: `pnpm --filter @marketpulse/api test -- evaluator.test.ts rules.test.ts alerts.test.ts audit.test.ts`

Expected: duration, recovery, deduplication, acknowledgement, rollback, concurrent update, RBAC, and redaction cases pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/models apps/api/src/monitoring apps/api/src/routes apps/api/test
git commit -m "feat(monitoring): add rules alerts and audits"
```

---

### Task 6: Add authenticated Socket.IO snapshots

**Files:**
- Create: `apps/api/src/realtime/socket-server.ts`, `apps/api/src/realtime/publisher.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/src/market-data/aggregator.ts`, `apps/api/src/monitoring/alert-service.ts`
- Test: `apps/api/test/realtime.test.ts`

- [ ] **Step 1: Write failing authenticated realtime tests**

```ts
it('rejects anonymous sockets and publishes bounded snapshots to users', async () => {
  await expect(connectSocket({ cookie: '' })).rejects.toThrow('unauthorized');
  const socket = await connectSocket({ cookie: await cookieFor('viewer') });
  provider.emit(trade('AAPL', 25));
  provider.emit(trade('AAPL', 30));
  const payload = await once(socket, 'symbols:snapshot');
  expect(payload.symbols[0]).toMatchObject({ symbol: 'AAPL' });
  expect(socket.receivedCount('symbols:snapshot')).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @marketpulse/api test -- realtime.test.ts`

Expected: missing Socket.IO implementation.

- [ ] **Step 3: Implement cookie-authenticated sockets**

Verify the access-token cookie in Socket.IO middleware and attach the user ID and role. Join every user to `workspace:default`; reserve `admin:default` for admins. Never accept a client-supplied role or workspace ID.

- [ ] **Step 4: Implement bounded publisher events**

Publish at most once per second:

```text
overview:snapshot, symbols:snapshot, provider:state,
alerts:changed, rules:changed
```

Payloads use shared contracts. On reconnect, the client must refetch REST resources; the server does not replay an unbounded event log.

- [ ] **Step 5: Run realtime and API tests**

Run: `pnpm --filter @marketpulse/api test -- realtime.test.ts && pnpm --filter @marketpulse/api test`

Expected: anonymous rejection, role room membership, throttling, provider state, and alert notifications pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/realtime apps/api/src/server.ts apps/api/src/market-data apps/api/src/monitoring apps/api/test
git commit -m "feat(realtime): stream authenticated dashboard snapshots"
```

---

### Task 7: Replace prototype data with authenticated REST and realtime state

**Files:**
- Create: `apps/web/src/app/store.ts`, `apps/web/src/app/api.ts`, `apps/web/src/app/socket.ts`, `apps/web/src/app/router.tsx`
- Create: `apps/web/src/auth/LoginPage.tsx`, `apps/web/src/auth/AuthGate.tsx`
- Create: `apps/web/src/setup/SetupPage.tsx`, `apps/web/src/setup/ServiceStatus.tsx`
- Create: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/dashboard/OverviewPage.tsx`, `apps/web/src/dashboard/FeedsPage.tsx`, `apps/web/src/dashboard/FeedDrawer.tsx`
- Create: `apps/web/src/alerts/AlertsPage.tsx`
- Create: `apps/web/src/rules/RulesPage.tsx`, `apps/web/src/rules/RuleDialog.tsx`, `apps/web/src/rules/RuleHistoryDialog.tsx`
- Create: `apps/web/src/audit/AuditPage.tsx`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/styles.css`
- Delete after migration: `apps/web/src/data.ts`, `apps/web/src/App.tsx`
- Test: `apps/web/test/auth.test.tsx`, `apps/web/test/dashboard.test.tsx`, `apps/web/test/rules.test.tsx`, `apps/web/test/alerts.test.tsx`

- [ ] **Step 1: Write failing setup and dashboard tests**

```tsx
it('shows exact missing configuration and no synthetic dashboard', async () => {
  server.use(setupStatus({ configured: false, services: { alpaca: 'missing' } }));
  renderApp('/');
  expect(await screen.findByRole('heading', { name: 'Complete setup' })).toBeVisible();
  expect(screen.getByText('Alpaca market data credentials')).toBeVisible();
  expect(screen.queryByText('2.90M')).not.toBeInTheDocument();
});

it('renders values returned by the API and updates from a socket snapshot', async () => {
  renderApp('/');
  expect(await screen.findByText('41 msg/s')).toBeVisible();
  socket.emit('overview:snapshot', overview({ messagesPerSecond: 55 }));
  expect(await screen.findByText('55 msg/s')).toBeVisible();
});
```

- [ ] **Step 2: Verify client tests fail**

Run: `pnpm --filter @marketpulse/web test -- auth.test.tsx dashboard.test.tsx`

Expected: missing app store, pages, and API layer.

- [ ] **Step 3: Implement session and setup gates**

On startup call `/api/setup/status`, then `/api/auth/me` only when configured. Route unauthenticated users to the Google login page. Route configuration failures to setup. Do not import a mock-data module in application code.

- [ ] **Step 4: Implement Redux Toolkit Query and socket reconciliation**

Define API resources for setup, session, overview, symbols, metrics, alerts, rules, audits, watchlist, and users. Socket events patch visible snapshot caches. Socket reconnect invalidates overview, symbols, alerts, and rules tags so REST remains authoritative.

- [ ] **Step 5: Split and migrate the prototype UI**

Preserve the visual tokens and responsive shell. Replace exchange rows with symbols and these columns:

```text
Symbol | Feed | Market state | Latest price | Spread |
Received msg/s | Observed latency | Last event | Health
```

Remove global exchange counts, packet loss, fabricated comparison percentages, simulated timers, demo role selector, and synthetic fixtures. Label every derived metric with an explanatory tooltip.

- [ ] **Step 6: Wire mutations and access states**

Alert acknowledgement updates after the API succeeds. Rule edit sends the current version and displays a conflict refresh action on HTTP 409. Viewer controls are disabled with a concise role explanation, while the server remains authoritative.

- [ ] **Step 7: Run client tests and build**

Run: `pnpm --filter @marketpulse/web test && pnpm --filter @marketpulse/web typecheck && pnpm --filter @marketpulse/web build`

Expected: setup, login, REST loading/error/empty states, socket updates, alert acknowledgement, rule conflict, audit diff, responsive shell, and production build pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): connect dashboard to real application data"
```

---

### Task 8: Add watchlist and user administration

**Files:**
- Create: `apps/api/src/routes/watchlist.ts`
- Create: `apps/api/src/monitoring/watchlist-service.ts`
- Create: `apps/web/src/admin/AdminPage.tsx`, `apps/web/src/admin/WatchlistPanel.tsx`, `apps/web/src/admin/UsersPanel.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/components/AppShell.tsx`
- Test: `apps/api/test/watchlist.test.ts`, `apps/api/test/admin-users.test.ts`, `apps/web/test/admin.test.tsx`

- [ ] **Step 1: Write failing administration tests**

```ts
it('validates a symbol before changing Alpaca subscriptions', async () => {
  alpaca.lookup.mockResolvedValue({ symbol: 'AMD', tradable: true });
  await request(asRole('admin')).post('/api/watchlist').send({ symbol: 'amd' }).expect(201);
  expect(provider.replaceSubscriptions).toHaveBeenCalledWith(expect.arrayContaining(['AMD']));
});

it('does not allow demoting the final admin', async () => {
  await request(asRole('admin')).patch('/api/admin/users/me/role')
    .send({ role: 'viewer' }).expect(409);
});
```

- [ ] **Step 2: Confirm tests fail**

Run: `pnpm --filter @marketpulse/api test -- watchlist.test.ts admin-users.test.ts && pnpm --filter @marketpulse/web test -- admin.test.tsx`

Expected: missing administration routes and pages.

- [ ] **Step 3: Implement watchlist mutation safely**

Normalize uppercase symbols, validate through Alpaca asset lookup, reject duplicates and non-tradable assets, persist the watchlist, then replace provider subscriptions. If subscription replacement fails, return 503 and retain the persisted desired watchlist so reconnect can converge.

- [ ] **Step 4: Implement user administration**

List users with role, email, name, and last login. Role changes require admin, create an audit event, and prevent removal of the last admin. Never expose Google subject IDs or refresh-token records to the client.

- [ ] **Step 5: Implement the admin page**

The route is absent for non-admin users and independently rejects direct navigation. Include symbol add/remove with provider feedback and role changes with a confirmation dialog naming the affected user and new role.

- [ ] **Step 6: Run administration tests**

Run: `pnpm --filter @marketpulse/api test -- watchlist.test.ts admin-users.test.ts && pnpm --filter @marketpulse/web test -- admin.test.tsx`

Expected: validation, provider failure, RBAC, last-admin, audit, and client visibility cases pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api apps/web
git commit -m "feat(admin): manage watchlist and user roles"
```

---

### Task 9: Complete integration testing, operations, and documentation

**Files:**
- Create: `apps/api/test/helpers/fake-provider.ts`, `apps/api/test/helpers/fake-google.ts`
- Create: `e2e/playwright.config.ts`, `e2e/marketpulse.spec.ts`, `e2e/package.json`
- Create: `Dockerfile`, `apps/api/Dockerfile`, `apps/web/Dockerfile`
- Modify: `docker-compose.yml`, `README.md`, `DESIGN.md`, `.env.example`, `package.json`
- Create: `docs/operations.md`, `docs/google-oauth-setup.md`, `docs/alpaca-setup.md`

- [ ] **Step 1: Write the end-to-end smoke test**

```ts
test('admin can monitor a real-shaped stream and acknowledge an alert', async ({ page }) => {
  await loginAs(page, 'admin');
  await page.goto('/');
  await expect(page.getByText('Connected to Alpaca IEX')).toBeVisible();
  await fakeProvider.emitTrade({ symbol: 'AAPL', price: 201.5, latencyMs: 125 });
  await expect(page.getByRole('cell', { name: 'AAPL' })).toBeVisible();
  await expect(page.getByText('Observed latency')).toBeVisible();
  await page.getByRole('link', { name: /Alert center/ }).click();
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByText(/Acknowledged by/)).toBeVisible();
});
```

- [ ] **Step 2: Confirm the smoke test fails before harness completion**

Run: `pnpm --filter @marketpulse/e2e test`

Expected: failure because controlled test login/provider endpoints are not available.

- [ ] **Step 3: Add test-only adapters without production escape hatches**

Only when `NODE_ENV=test`, dependency injection may use `FakeGoogleProvider` and `FakeMarketDataProvider`. Do not add public HTTP endpoints that inject market events. The Playwright test starts the API inside the same test process and calls the fake provider handle directly.

- [ ] **Step 4: Complete container and graceful-shutdown behavior**

Containers run as non-root users, expose health checks, and use multi-stage builds. API shutdown stops accepting requests, closes Socket.IO, disconnects Alpaca, flushes a final metrics bucket with a timeout, and closes MongoDB.

- [ ] **Step 5: Document real credential setup**

Document:

```text
Google redirect URI: http://localhost:3000/api/auth/google/callback
Alpaca feed: IEX free market-data plan
MongoDB local URI: mongodb://localhost:27017/marketpulse
```

Explain that Google and Alpaca credentials must be created by the user and placed in `.env`, that secrets are not entered into the browser, that free IEX is not the consolidated SIP feed, and that derived latency is measured by this application.

- [ ] **Step 6: Run the full verification gate**

Run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
docker compose config
pnpm --filter @marketpulse/e2e test
```

Expected: every command exits 0; all unit, integration, and smoke tests pass; all packages build; Compose configuration validates.

- [ ] **Step 7: Verify real integrations when credentials are available**

Start the application with user-provided environment values. Confirm Google returns to the configured callback, `/api/auth/me` returns the persisted user, provider state becomes `connected`, at least one subscribed symbol receives a provider event while the market is active, and no secret appears in browser network responses or server logs.

If the market is closed, verify the authenticated Alpaca subscription succeeds and the UI reports `market closed`; record that live-event verification remains pending until the next open session.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile apps docker-compose.yml e2e docs README.md DESIGN.md .env.example package.json pnpm-lock.yaml
git commit -m "test: complete MarketPulse integration and operations"
```

---

## Implementation Checkpoints

- After Task 3: the application has real Google identity and server authorization, but still shows the preserved prototype UI.
- After Task 4: the API proves real Alpaca ingestion and derived metrics through tests and REST responses.
- After Task 7: the browser contains no synthetic market-data path and becomes the first full vertical slice.
- After Task 9: the repository is ready for credentials and deployment selection.

Do not claim real-data completion from mocked tests alone. Completion requires a successful authenticated Alpaca connection and, during market hours, at least one observed provider event. Google OAuth completion likewise requires a real callback using user-owned credentials.
