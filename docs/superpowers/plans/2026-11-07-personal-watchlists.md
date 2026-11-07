# Personal Watchlists and Asset Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add searchable Alpaca equities and persistent, private, 25-symbol watchlists whose deduplicated union drives one realtime provider subscription.

**Architecture:** Store one `UserWatchlistEntry` per user and symbol, initialize a six-symbol starter list exactly once, and expose authenticated personal watchlist/search APIs. A coordinator computes the global provider union while REST authorization and Socket.IO symbol rooms ensure each user receives only their own monitored symbols.

**Tech Stack:** TypeScript, Node.js, Express, MongoDB/Mongoose transactions, Alpaca Trading API and IEX WebSocket, Socket.IO, React, Redux Toolkit Query, Vitest, React Testing Library, Playwright, pnpm, Docker, Render.

---

## File Structure

**Create**

- `packages/contracts/src/watchlist.ts` — shared asset-search, personal-watchlist, and membership-event schemas.
- `apps/api/src/models/user-watchlist-entry.ts` — per-user symbol persistence and indexes.
- `apps/api/src/market-data/asset-directory.ts` — cached, ranked Alpaca asset search.
- `apps/api/src/monitoring/personal-watchlist-service.ts` — initialization, list, add/remove transactions, auditing, and union refresh.
- `apps/api/src/monitoring/subscription-coordinator.ts` — serialized, deduplicated provider subscription replacement.
- `apps/api/src/routes/assets.ts` — authenticated asset-search HTTP route.
- `apps/web/src/watchlist/AssetSearch.tsx` — debounced search and add controls.
- `apps/web/src/watchlist/WatchlistWorkspace.tsx` — search, counter, empty/error states, and personal feed composition.

**Modify**

- `packages/contracts/src/index.ts`, `packages/contracts/src/realtime.ts` — export schemas and add personal membership events.
- `apps/api/src/models/user.ts` — record one-time watchlist initialization.
- `apps/api/src/auth/mongoose-repository.ts` — initialize starter entries after Google upsert.
- `apps/api/src/market-data/provider.ts`, `apps/api/src/market-data/alpaca-provider.ts` — expose eligible asset-directory retrieval.
- `apps/api/src/routes/watchlist.ts`, `apps/api/src/routes/market-data.ts`, `apps/api/src/routes/alerts.ts` — current-user ownership and filtering.
- `apps/api/src/realtime/socket-server.ts`, `apps/api/src/realtime/publisher.ts` — symbol rooms and user room refresh.
- `apps/api/src/app.ts`, `apps/api/src/server.ts` — wire services, migration, union subscriptions, and personalized APIs.
- `apps/api/src/routes/auth.ts`, `apps/api/src/auth/google-provider.ts`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/auth/AuthGate.tsx` — sign-out and explicit Google account switching.
- `apps/web/src/api.ts`, `apps/web/src/socket.ts`, `apps/web/src/dashboard/FeedsPage.tsx`, `apps/web/src/dashboard/OverviewPage.tsx`, `apps/web/src/alerts/AlertsPage.tsx`, `apps/web/src/styles.css` — personal watchlist UI and cache updates.
- `apps/e2e/tests/harness.ts`, `apps/e2e/tests/marketpulse.spec.ts` — two-user ownership and realtime coverage.
- `README.md`, `docs/operations.md` — usage, migration, limits, and production verification.

The existing `apps/api/src/models/watchlist.ts`, `apps/api/src/monitoring/watchlist-service.ts`, and `apps/web/src/admin/WatchlistPanel.tsx` remain until the new flow passes all compatibility tests. Remove their runtime wiring only after Task 8 proves no dependency remains; do not delete production collection data.

### Task 1: Shared Watchlist Contracts

**Files:**
- Create: `packages/contracts/src/watchlist.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/realtime.ts`
- Test: `packages/contracts/src/contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests that parse one eligible asset, a personal list with `limit: 25`, and a realtime membership event:

```ts
expect(assetSearchResultSchema.parse({
  symbol: 'AAPL', companyName: 'Apple Inc.', exchange: 'NASDAQ',
  assetClass: 'us_equity', tradable: true, inWatchlist: false,
}).symbol).toBe('AAPL');

expect(personalWatchlistSchema.parse({
  entries: [], limit: 25, used: 0,
}).limit).toBe(25);

expect(watchlistChangedEventSchema.parse({
  symbols: ['AAPL'], used: 1, limit: 25, at: new Date().toISOString(),
}).symbols).toEqual(['AAPL']);
```

- [ ] **Step 2: Run the focused contract test and verify failure**

Run: `corepack pnpm --filter @marketpulse/contracts test -- contracts.test.ts`

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Implement the schemas**

Create strict schemas with reusable uppercase-symbol validation:

```ts
import { z } from 'zod';

export const watchlistLimit = 25;
export const watchlistSymbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]*$/);
export const assetSearchResultSchema = z.object({
  symbol: watchlistSymbolSchema,
  companyName: z.string().min(1),
  exchange: z.string().min(1).optional(),
  assetClass: z.literal('us_equity'),
  tradable: z.literal(true),
  inWatchlist: z.boolean(),
});
export const watchlistEntrySchema = assetSearchResultSchema.omit({ inWatchlist: true, tradable: true }).extend({
  id: z.string().min(1), createdAt: z.string().datetime(),
});
export const personalWatchlistSchema = z.object({
  entries: z.array(watchlistEntrySchema).max(watchlistLimit),
  used: z.number().int().min(0).max(watchlistLimit),
  limit: z.literal(watchlistLimit),
});
export const watchlistChangedEventSchema = z.object({
  symbols: z.array(watchlistSymbolSchema).max(watchlistLimit),
  used: z.number().int().min(0).max(watchlistLimit),
  limit: z.literal(watchlistLimit),
  at: z.string().datetime(),
});
export type AssetSearchResult = z.infer<typeof assetSearchResultSchema>;
export type PersonalWatchlist = z.infer<typeof personalWatchlistSchema>;
```

Export these from `index.ts` and add `'watchlist:changed'` to `RealtimeServerEvents`.

- [ ] **Step 4: Run tests and typecheck**

Run: `corepack pnpm --filter @marketpulse/contracts test && corepack pnpm --filter @marketpulse/contracts typecheck`

Expected: all contract tests and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat: define personal watchlist contracts"
```

### Task 2: Per-User Persistence and Starter Initialization

**Files:**
- Create: `apps/api/src/models/user-watchlist-entry.ts`
- Create: `apps/api/src/monitoring/personal-watchlist-service.ts`
- Modify: `apps/api/src/models/user.ts`
- Modify: `apps/api/src/auth/mongoose-repository.ts`
- Test: `apps/api/src/monitoring/personal-watchlist-service.integration.test.ts`
- Test: `apps/api/src/auth/mongoose-repository.integration.test.ts`

- [ ] **Step 1: Write failing integration tests**

Cover distinct user lists, duplicate prevention, exactly-once starter initialization, an intentionally emptied initialized list, and the 25-item limit:

```ts
it('keeps watchlists private and enforces 25 symbols transactionally', async () => {
  await service.initializeUser(userA);
  await service.initializeUser(userB);
  await service.remove(userA, 'AAPL', audit);
  expect((await service.list(userA)).entries.some(x => x.symbol === 'AAPL')).toBe(false);
  expect((await service.list(userB)).entries.some(x => x.symbol === 'AAPL')).toBe(true);
  for (let index = 0; index < 19; index += 1) await service.add(userA, asset(`T${index}`), audit);
  expect((await service.add(userA, asset('OVER'), audit)).status).toBe('limit_reached');
});
```

- [ ] **Step 2: Run the integration tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/api test -- personal-watchlist-service.integration.test.ts mongoose-repository.integration.test.ts`

Expected: FAIL because the model and service do not exist.

- [ ] **Step 3: Add the model and indexes**

Define `UserWatchlistEntry` with required `userId`, uppercase `symbol`, `companyName`, optional `exchange`, literal `assetClass: 'us_equity'`, and timestamps. Add:

```ts
schema.index({ userId: 1, symbol: 1 }, { unique: true });
schema.index({ symbol: 1, userId: 1 });
```

Add `watchlistInitializedAt?: Date` to the user interface and schema.

- [ ] **Step 4: Implement initialization and transactional mutations**

Use these constants and result boundaries:

```ts
export const STARTER_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA'] as const;
export type PersonalMutationResult =
  | { status: 'updated'; watchlist: PersonalWatchlist; unionChanged: boolean }
  | { status: 'duplicate' | 'not_found' | 'limit_reached' };
```

`initializeUser(userId)` must run in a MongoDB transaction, lock a per-user `AuthInvariant` record, re-read `watchlistInitializedAt`, insert starter entries with `$setOnInsert`, and set the timestamp only after inserts succeed. `add` and `remove` must write the audit event in the same transaction. Removal is allowed to produce an empty list.

- [ ] **Step 5: Initialize after Google user upsert**

Inject a narrow initializer into `MongooseAuthRepository`:

```ts
constructor(private readonly initializeWatchlist: (userId: string) => Promise<void> = async () => undefined) {}
```

After `findOneAndUpdate`, call `initializeWatchlist(String(user._id))` before returning the public user. Keep this callback replaceable in auth unit tests.

- [ ] **Step 6: Run focused and existing auth tests**

Run: `corepack pnpm --filter @marketpulse/api test -- personal-watchlist-service.integration.test.ts mongoose-repository.integration.test.ts auth.test.ts rbac.test.ts`

Expected: all focused and auth tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/models apps/api/src/monitoring/personal-watchlist-service.ts apps/api/src/auth
git commit -m "feat: persist private user watchlists"
```

### Task 3: Alpaca Asset Directory and Ranked Search

**Files:**
- Create: `apps/api/src/market-data/asset-directory.ts`
- Modify: `apps/api/src/market-data/provider.ts`
- Modify: `apps/api/src/market-data/alpaca-provider.ts`
- Test: `apps/api/src/market-data/asset-directory.test.ts`
- Test: `apps/api/src/market-data/market-data.test.ts`

- [ ] **Step 1: Write failing provider and ranking tests**

Use a controlled fetch response containing active/inactive, tradable/non-tradable, US equity/non-equity records. Assert exact symbol, prefix, then company-name ranking and ten-result truncation:

```ts
expect((await directory.search('aapl')).map(x => x.symbol)).toEqual(['AAPL']);
expect((await directory.search('apple')).map(x => x.symbol)).toEqual(['AAPL', 'APLE']);
expect(fetchMock).toHaveBeenCalledTimes(1);
await directory.search('micro');
expect(fetchMock).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/api test -- asset-directory.test.ts market-data.test.ts`

Expected: FAIL because provider asset listing and the directory do not exist.

- [ ] **Step 3: Extend the provider boundary**

Add:

```ts
export interface ProviderAsset {
  symbol: string;
  name: string;
  exchange?: string;
  assetClass: 'us_equity';
  status: 'active' | 'inactive';
  tradable: boolean;
}
listAssets(): Promise<ProviderAsset[]>;
```

Implement Alpaca `GET /v2/assets?status=active&asset_class=us_equity` with the existing credentials and `tradingBaseUrl`. Map only well-formed records. Update the fake provider with deterministic assets.

- [ ] **Step 4: Implement bounded cache and ranking**

`AssetDirectory` accepts `listAssets`, a 15-minute TTL, `now`, and `maxResults = 10`. Normalize once per refresh, filter active/tradable US equities, and rank with tuple weights: exact symbol `0`, symbol prefix `1`, company-name prefix `2`, company-name substring `3`. Break ties by symbol. Empty or one-character whitespace-only queries return `[]` without a provider request.

- [ ] **Step 5: Run provider tests and typecheck**

Run: `corepack pnpm --filter @marketpulse/api test -- asset-directory.test.ts market-data.test.ts && corepack pnpm --filter @marketpulse/api typecheck`

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/market-data apps/api/src/test-helpers
git commit -m "feat: search eligible Alpaca equities"
```

### Task 4: Personal REST APIs and Ownership Filtering

**Files:**
- Create: `apps/api/src/routes/assets.ts`
- Modify: `apps/api/src/routes/watchlist.ts`
- Modify: `apps/api/src/routes/market-data.ts`
- Modify: `apps/api/src/routes/alerts.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/watchlist.test.ts`
- Test: `apps/api/src/routes/market-data.test.ts`
- Test: `apps/api/src/routes/alerts.test.ts`
- Create: `apps/api/src/routes/assets.test.ts`

- [ ] **Step 1: Write failing route tests**

Test viewer access, user ID propagation from `response.locals.user.sub`, search membership flags, 25-limit `409`, ownership `404` for symbol/detail/alert access, and personal collection filtering.

```ts
await agent.get('/api/assets/search?q=apple').expect(200).expect(({ body }) => {
  expect(body.results[0]).toMatchObject({ symbol: 'AAPL', inWatchlist: true });
});
await agent.post('/api/watchlist').send({ symbol: 'MSFT' }).expect(409, {
  error: { code: 'WATCHLIST_LIMIT_REACHED', message: 'Watchlist limit of 25 symbols reached' },
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/api test -- assets.test.ts watchlist.test.ts market-data.test.ts alerts.test.ts`

Expected: FAIL because routes still use global/admin semantics.

- [ ] **Step 3: Replace watchlist route semantics**

Remove `requireRole('admin')`. Read `response.locals.user.sub` for every handler. Return `{ entries, used, limit }`. Map mutation statuses to stable codes: `DUPLICATE_SYMBOL`, `SYMBOL_NOT_FOUND`, `SYMBOL_NOT_TRADABLE`, `WATCHLIST_LIMIT_REACHED`, and `PROVIDER_UNAVAILABLE`.

- [ ] **Step 4: Add asset search route**

Validate `q` with Zod as a trimmed string of 2–80 characters. Search the cached directory, read the user's symbol set, and return results with `inWatchlist`. Return `503 PROVIDER_UNAVAILABLE` on an unusable provider/cache failure.

- [ ] **Step 5: Personalize market-data and alert routes**

Change `MarketDataApi` methods to accept `userId`. Before a single-symbol or metrics query, call `watchlists.has(userId, symbol)` and return `404` when false. Filter alerts with `{ symbol: { $in: await watchlists.symbols(userId) } }`; detail and acknowledge routes must apply the same ownership test.

- [ ] **Step 6: Wire dependencies and run route tests**

Run: `corepack pnpm --filter @marketpulse/api test -- assets.test.ts watchlist.test.ts market-data.test.ts alerts.test.ts`

Expected: all route tests pass, including two-user isolation cases.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes apps/api/src/app.ts
git commit -m "feat: expose private watchlist APIs"
```

### Task 5: Union Subscription Coordinator

**Files:**
- Create: `apps/api/src/monitoring/subscription-coordinator.ts`
- Modify: `apps/api/src/monitoring/personal-watchlist-service.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/monitoring/subscription-coordinator.test.ts`
- Test: `apps/api/src/monitoring/watchlist-service.integration.test.ts`

- [ ] **Step 1: Write failing coordinator tests**

Prove overlapping lists subscribe once, removal of one reference does not unsubscribe, final removal does, identical unions do not call the provider, and concurrent refresh requests serialize:

```ts
await coordinator.refresh();
expect(provider.replaceSubscriptions).toHaveBeenLastCalledWith(['AAPL', 'MSFT']);
await repository.remove(userA, 'AAPL');
await coordinator.refresh();
expect(provider.replaceSubscriptions).toHaveBeenLastCalledWith(['AAPL', 'MSFT']);
await repository.remove(userB, 'AAPL');
await coordinator.refresh();
expect(provider.replaceSubscriptions).toHaveBeenLastCalledWith(['MSFT']);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/api test -- subscription-coordinator.test.ts watchlist-service.integration.test.ts`

Expected: FAIL because subscription replacement still uses one global list.

- [ ] **Step 3: Implement serialized distinct-union refresh**

The coordinator repository exposes `union(): Promise<string[]>`. Normalize, sort, and compare against the last applied array. Coalesce concurrent refreshes with one in-flight promise and one dirty flag. Update the applied array only after `replaceSubscriptions` succeeds.

- [ ] **Step 4: Wire startup and mutation callbacks**

In `server.ts`, sync indexes, initialize users missing `watchlistInitializedAt`, compute the union, connect Alpaca with that union, and inject `() => coordinator.refresh()` into personal mutations. Replace `subscribedSymbols` global-list updates with `coordinator.symbols()`.

- [ ] **Step 5: Run coordinator, bootstrap, and readiness tests**

Run: `corepack pnpm --filter @marketpulse/api test -- subscription-coordinator.test.ts bootstrap-attempt.test.ts health.test.ts`

Expected: all tests pass and readiness remains false when initialization fails.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/monitoring apps/api/src/server.ts
git commit -m "feat: coordinate deduplicated market subscriptions"
```

### Task 6: Socket.IO Symbol Rooms and Personalized Cache Events

**Files:**
- Modify: `apps/api/src/realtime/socket-server.ts`
- Modify: `apps/api/src/realtime/publisher.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/socket.ts`
- Test: `apps/api/src/realtime/realtime.test.ts`
- Test: `apps/web/src/auth/auth.test.tsx`

- [ ] **Step 1: Write failing two-user realtime tests**

Connect users A and B with lists `['AAPL', 'MSFT']` and `['AAPL', 'TSLA']`. Publish three snapshots and assert both receive AAPL, only A receives MSFT, and only B receives TSLA. Change A's list, invoke room refresh, and assert the existing socket membership changes without reconnecting.

- [ ] **Step 2: Run realtime tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/api test -- realtime.test.ts`

Expected: FAIL because all snapshots are broadcast to `workspace:default`.

- [ ] **Step 3: Join and refresh symbol rooms**

Add `symbolsForUser(userId)` to realtime dependencies. On connection, join `user:<id>` and `symbol:<ticker>` rooms. Export:

```ts
async function refreshUserRooms(userId: string): Promise<void> {
  const desired = new Set((await dependencies.symbolsForUser(userId)).map(s => `symbol:${s}`));
  for (const socket of server.sockets.sockets.values()) {
    if (socket.data.user.id !== userId) continue;
    for (const room of [...socket.rooms].filter(r => r.startsWith('symbol:'))) if (!desired.has(room)) await socket.leave(room);
    for (const room of desired) await socket.join(room);
  }
}
```

Return this method with the server handle so the personal-watchlist mutation callback can invoke it.

- [ ] **Step 4: Publish one symbol per room**

Change publisher snapshot delivery to emit each snapshot to `symbol:${snapshot.symbol}`. Keep provider state global. Stop broadcasting the global symbol union in overview events; REST supplies personalized symbols. Emit `watchlist:changed` to `user:<id>` after successful add/remove.

- [ ] **Step 5: Update web socket cache handling**

Merge incoming symbol snapshots by symbol instead of replacing the entire array, invalidate `Watchlist`, `Overview`, `Symbols`, and `Alerts` on `watchlist:changed`, and refetch all personalized tags after reconnect.

- [ ] **Step 6: Run API and web socket tests**

Run: `corepack pnpm --filter @marketpulse/api test -- realtime.test.ts && corepack pnpm --filter @marketpulse/web test -- auth.test.tsx`

Expected: room isolation and cache invalidation tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/realtime apps/api/src/server.ts apps/web/src/socket.ts
git commit -m "feat: isolate realtime data by watchlist"
```

### Task 7: Search and Personal Watchlist UI

**Files:**
- Create: `apps/web/src/watchlist/AssetSearch.tsx`
- Create: `apps/web/src/watchlist/WatchlistWorkspace.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/dashboard/FeedsPage.tsx`
- Modify: `apps/web/src/dashboard/OverviewPage.tsx`
- Modify: `apps/web/src/alerts/AlertsPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/dashboard/feeds-states.test.tsx`
- Create: `apps/web/src/watchlist/watchlist.test.tsx`

- [ ] **Step 1: Write failing component tests**

Use fake timers and mocked RTK Query responses. Verify no search before two characters, 300 ms debounce, ranked results, disabled `In watchlist`, add/remove calls, `6 / 25`, limit state, provider error/retry, and empty-list prompt.

```tsx
await user.type(screen.getByRole('searchbox', { name: /stocks or companies/i }), 'apple');
act(() => vi.advanceTimersByTime(300));
expect(await screen.findByText('Apple Inc.')).toBeVisible();
await user.click(screen.getByRole('button', { name: /add aapl/i }));
expect(addSymbol).toHaveBeenCalledWith('AAPL');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/web test -- watchlist.test.tsx feeds-states.test.tsx`

Expected: FAIL because the search workspace does not exist.

- [ ] **Step 3: Add RTK Query endpoints**

Add `assetSearch(q)`, personal `watchlist`, `addWatchlistSymbol`, and `removeWatchlistSymbol` using the shared contract types. Use `skipToken` or `skip: query.trim().length < 2`. Mutations invalidate `Watchlist`, `Overview`, `Symbols`, `Alerts`, and `Audit`.

- [ ] **Step 4: Build the debounced search control**

Use a controlled query, a 300 ms `useEffect` timer, and accessible result list. Each row displays symbol, name, exchange, and the appropriate `Add`, `In watchlist`, or `Limit reached` control. Keep mutation errors inline and retain the search term after a retryable error.

- [ ] **Step 5: Build the workspace and removal flow**

Display the `used / 25` counter above `FeedsPage`. Add company name and remove action to each non-compact row. Confirm removal with the existing `Modal` component, then call the mutation. For zero entries, render “Search for a stock or company to start monitoring.”

- [ ] **Step 6: Apply personal scope across pages**

Overview continues deriving cards from the now-personalized symbols response. Alert Center uses the personalized server response without client-side leakage. Feed drawers and metrics remain inaccessible for symbols absent from the current list.

- [ ] **Step 7: Add responsive styles and run tests**

Keep the existing visual language. Add `.asset-search`, `.asset-results`, `.watchlist-counter`, `.watchlist-company`, and `.watchlist-actions` styles with keyboard focus, mobile stacking below 720 px, and no horizontal overflow outside the existing table scroller.

Run: `corepack pnpm --filter @marketpulse/web test && corepack pnpm --filter @marketpulse/web typecheck`

Expected: all web tests and typecheck pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat: add personal stock search workspace"
```

### Task 8: Migration, Compatibility Cleanup, and Documentation

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/models/watchlist.ts`
- Modify: `apps/web/src/admin/AdminPage.tsx`
- Modify: `apps/web/src/admin/WatchlistPanel.tsx`
- Modify: `README.md`
- Modify: `docs/operations.md`
- Test: `apps/api/src/bootstrap-attempt.test.ts`
- Test: `apps/web/src/admin/admin.test.tsx`

- [ ] **Step 1: Write failing migration and compatibility tests**

Assert startup initializes users lacking `watchlistInitializedAt`, retries safely after interruption, never repopulates an initialized empty list, and no longer exposes the global admin watchlist panel.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/api test -- bootstrap-attempt.test.ts && corepack pnpm --filter @marketpulse/web test -- admin.test.tsx`

Expected: FAIL until migration and admin cleanup are complete.

- [ ] **Step 3: Complete idempotent startup migration**

Batch users missing the marker in deterministic `_id` order. Call the same `initializeUser` service used by login. Do not drop or delete the old `watchlists` collection. Log counts only; never log emails, symbols by user, credentials, or MongoDB URIs.

- [ ] **Step 4: Remove global controls from runtime**

Remove `WatchlistPanel` from `AdminPage` and remove old global service/router construction from `server.ts` and `app.ts` after the personal router fully replaces it. Keep the legacy model file as a read-only compatibility artifact for this release, marked deprecated in its module comment.

- [ ] **Step 5: Update documentation**

Document the 25-symbol personal limit, starter list, asset-search source, IEX limitation, union subscription behavior, migration safety, free-tier scaling constraints, and verification commands. State clearly that old global collection data is retained but unused.

- [ ] **Step 6: Run focused tests and commit**

Run: `corepack pnpm --filter @marketpulse/api test -- bootstrap-attempt.test.ts && corepack pnpm --filter @marketpulse/web test -- admin.test.tsx`

Expected: focused tests pass.

```bash
git add apps/api/src apps/web/src/admin README.md docs/operations.md
git commit -m "chore: migrate global monitoring to personal watchlists"
```

### Task 9: Sign Out and Switch Google Account

**Files:**
- Modify: `apps/api/src/auth/google-provider.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/auth/auth.test.ts`
- Modify: `apps/api/src/auth/google-provider.test.ts`
- Modify: `apps/api/src/test-helpers/fake-google.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/auth/AuthGate.tsx`
- Modify: `apps/web/src/components/AppShell.test.tsx`
- Modify: `apps/web/src/auth/auth.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing backend account-switch tests**

Extend the identity-provider boundary to accept an account-choice option and verify it changes only the switch flow:

```ts
expect(provider.authorizationUrl('state', { selectAccount: false })).not.toContain('prompt=select_account');
expect(provider.authorizationUrl('state', { selectAccount: true })).toContain('prompt=select_account');
await agent.post('/api/auth/switch-account').set('Cookie', refreshCookie).expect(204);
expect(repository.revokeFamily).toHaveBeenCalledWith(familyId);
```

- [ ] **Step 2: Run backend auth tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/api test -- auth.test.ts google-provider.test.ts`

Expected: FAIL because the provider option and switch-account route do not exist.

- [ ] **Step 3: Implement explicit account selection**

Change the interface to:

```ts
authorizationUrl(state: string, options?: { selectAccount?: boolean }): string;
```

When `selectAccount` is true, set `prompt=select_account` on the Google authorization URL. Add `GET /api/auth/google?select_account=true` validation so only the literal `true` enables it. Add `POST /api/auth/switch-account` using the same refresh-family revocation and cookie clearing helper as logout; return `204` so the client controls the subsequent navigation.

- [ ] **Step 4: Write failing account-menu tests**

Render `AppShell` with an authenticated user. Open the profile menu and assert `Switch account` and `Sign out` are keyboard-accessible. For sign out, assert the logout mutation runs, RTK Query state resets, and the login screen appears. For switch account, assert session cleanup completes before `location.assign('/api/auth/google?select_account=true')`.

- [ ] **Step 5: Run web auth tests and verify failure**

Run: `corepack pnpm --filter @marketpulse/web test -- AppShell.test.tsx auth.test.tsx`

Expected: FAIL because the profile is static and there is no logout mutation.

- [ ] **Step 6: Implement account menu and client cleanup**

Add a `logout` mutation to RTK Query and a reusable `clearClientSession` action sequence:

```ts
await logout().unwrap();
dispatch(api.util.resetApiState());
onSessionEnded?.();
```

Expose the profile as an ARIA menu button containing the name, email, role, `Switch account`, and `Sign out`. Disable actions while cleanup is pending and show an inline retry message on failure. `AuthGate` must return to `LoginPage` after cache reset. Socket teardown follows component unmount; never leave an authenticated socket running after logout.

- [ ] **Step 7: Run backend and web tests**

Run: `corepack pnpm --filter @marketpulse/api test -- auth.test.ts google-provider.test.ts && corepack pnpm --filter @marketpulse/web test -- AppShell.test.tsx auth.test.tsx`

Expected: all account-switch and logout tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth apps/api/src/routes/auth.ts apps/api/src/test-helpers/fake-google.ts apps/web/src
git commit -m "feat: add sign out and Google account switching"
```

### Task 10: Two-User E2E, Full Verification, and Deployment

**Files:**
- Modify: `apps/e2e/tests/harness.ts`
- Modify: `apps/e2e/tests/marketpulse.spec.ts`
- Modify: `docs/verification-2026-11-06.md`

- [ ] **Step 1: Add a failing two-user E2E scenario**

Create two fake Google identities and independent browser contexts. User A adds MSFT; user B adds TSLA; both follow AAPL. Emit AAPL, MSFT, and TSLA events. Assert shared AAPL appears for both, private symbols appear only for their owner, removals persist after reload, and unauthorized detail URLs return the not-found UI.

- [ ] **Step 2: Run E2E and verify failure before harness updates**

Run: `corepack pnpm --filter @marketpulse/e2e test`

Expected: FAIL because the harness supports one global user/watchlist.

- [ ] **Step 3: Update the harness and make E2E pass**

Expose identity selection per browser context, create/sync `UserWatchlistEntry`, inject deterministic provider assets, wire user-room dependencies, and retain direct fake-provider event emission without adding a production event-injection endpoint.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```bash
corepack pnpm --filter @marketpulse/contracts test
corepack pnpm --filter @marketpulse/api test
corepack pnpm --filter @marketpulse/web test
corepack pnpm --filter @marketpulse/e2e test
corepack pnpm typecheck
corepack pnpm build
docker build -t marketpulse:personal-watchlists .
```

Expected: every test, typecheck, build, and Docker image build succeeds.

- [ ] **Step 5: Run a clean production-container smoke test**

Start the image with non-production test credentials and an isolated MongoDB replica set. Verify `/health/live`, `/health/ready`, authenticated search, add/remove persistence, and static SPA delivery. Stop only the containers created for this verification.

- [ ] **Step 6: Update verification evidence and commit**

Record exact test counts, commands, controlled-vs-live boundaries, migration behavior, and remaining free-tier limitations in the verification document.

```bash
git add apps/e2e docs/verification-2026-11-06.md
git commit -m "test: verify personal watchlist isolation"
```

- [ ] **Step 7: Push, review, merge, and deploy**

Push the feature branch, create a pull request, review the complete diff and CI results, merge only with a clean review, then allow the Render Blueprint to deploy `master`. This step changes GitHub and production state, so obtain action-time confirmation immediately before creating the pull request, merging, or triggering any manual deployment if those actions are performed through browser UI.

- [ ] **Step 8: Verify production behavior**

With two approved test users, verify Google login, deliberate account switching, sign out, personal search, add/remove persistence, ownership isolation, `/health/live`, `/health/ready`, and the Render logs. During market hours confirm real IEX events for a newly added eligible symbol; outside market hours confirm honest `market_closed` state. Never print or capture secret environment values.
