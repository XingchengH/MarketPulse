# Verification record — 2026-11-06

Updated for personal watchlists on **2026-11-07**. This file retains its original path so existing links remain valid.

Local environment: macOS, Node **24.11.1**, pnpm **11.25.0**, Playwright **1.64.1**, and the system MongoDB **7.0.20** binary used by `MongoMemoryReplSet`. Mongo-memory-server requests 7.0.24 and explicitly reports that it is using the installed 7.0.20 system binary. Docker builds use Node 22 Alpine; the disposable container smoke uses MongoDB 8.

## Current verification gate

All commands below exited 0:

| Command | Evidence |
| --- | --- |
| `CI=true pnpm install --frozen-lockfile` | Frozen lockfile accepted; 401 packages restored without changing dependency versions. |
| `CI=true pnpm test` | **269 tests passed**: 9 contracts, 204 API, 56 web; 42 test files. |
| `CI=true pnpm --filter @marketpulse/e2e test` | **2 integrated Playwright tests passed**, using one worker. |
| `CI=true pnpm typecheck` | Contracts, API, web, and E2E passed. |
| `CI=true pnpm build` | Contracts, API, web production bundle, and E2E passed. |
| `docker compose config --quiet` | Compose configuration validated. |
| `docker build -f apps/api/Dockerfile -t marketpulse-personal-watchlist-verification:2026-11-07 .` | API image built. |
| `docker build -t marketpulse-personal-watchlist-preview-verification:2026-11-07 .` | Complete same-origin preview image built. |
| `node /private/tmp/marketpulse-container-smoke-2026-11-07.mjs` | Disposable production-image smoke passed; details below. The script is a local verification artifact, not an application entry point. |
| `git diff --check` | No whitespace errors. |

The sandbox initially blocked registry resolution and loopback binding (`ENOTFOUND` / `listen EPERM: operation not permitted 127.0.0.1`). Dependency installation and tests requiring local servers were rerun with the required sandbox escalation. Docker also required daemon-socket access. These were environment restrictions, not weakened or skipped checks.

The new two-user test was first run before harness implementation: the original smoke passed and the new test failed with `TypeError: harness.selectIdentity is not a function`. After implementing the harness, both passed. The final run includes explicit forbidden-room checks and removal-room checks. Readiness uses bounded polling for authenticated WebSocket upgrade and symbol memberships; browser assertions wait for rendered/API results. The old fixed sleep and duplicate trade emission were removed. Browser contexts, HTTP/Socket.IO servers, provider, Mongoose connection, and Mongo replica set are closed after each scenario.

## Controlled browser coverage

The harness composes the production Express routes, OAuth state/callback and cookie flow, authentication/RBAC, HTTP and Socket.IO servers, personal-watchlist service, subscription coordinator, asset directory, monitoring evaluator, alert/audit transactions, and real models/indexes on an isolated MongoDB replica set. It creates and syncs `UserWatchlistEntry`, including its unique ownership/symbol index. Google identities and Alpaca transport/assets are deterministic test doubles restricted to `NODE_ENV=test`.

Identity selection changes only the fake provider's authorization code through browser-context interception of the real OAuth-start redirect. The real callback still checks its state cookie. Each user has an independent browser context and cookie jar. Trades enter through the in-process fake-provider handle. There is no production identity selector or HTTP/socket event-injection route.

The browser scenarios verify:

- Admin OAuth login, a controlled AAPL trade displaying 40 ms observed latency, alert acknowledgement, and persisted acknowledgement after reload.
- Independent Alpha/Beta logins with different user IDs and AAPL present in both starter lists.
- Company-name search for Advanced Micro Devices and ticker search for GOOG; UI addition of AMD to Alpha and GOOG to Beta. Both symbols are deterministic eligible nonstarters.
- Exactly one initial provider subscription union and one replacement per private-symbol change; AAPL and every other shared starter occur once in each union.
- Controlled AAPL/AMD/GOOG events: Alpha renders and receives AAPL + AMD, Beta renders and receives AAPL + GOOG. Raw browser WebSocket frames and server symbol-room membership are checked, including forbidden rooms.
- Cross-user detail API requests and direct browser navigation to the detail API URL return 404 / `Symbol not found`; cross-user metrics return 404. REST symbol lists exclude the other user's private symbol. The application's visual detail surface is a drawer rather than a separate SPA detail URL.
- UI confirmation/removal of AMD, absence after reload and authenticated watchlist reread, provider-union removal while GOOG stays subscribed, and revoked AMD room membership.
- UI sign-out returns Alpha to Google login and makes its session API return 401 while Beta remains signed in. Deliberate Switch account performs the real cleanup and `select_account=true` flow, authenticates Beta's context as Alpha, and renders Alpha's persisted list without Beta's GOOG or the removed AMD.

The harness replaces `server.ts` bootstrap and minute-bucket writing with a narrow readiness/market-data façade. Those production paths have separate API coverage; the container smoke below additionally exercises real startup/migration. Passing browser tests do not establish live Google credentials, Alpaca authorization, exchange coverage, market-open events, or production network behavior.

## Migration and container evidence

The production preview image was run with fake credentials on a new **internal Docker network**, a disposable MongoDB 8 replica set, and a legacy viewer inserted before startup. No host ports or persistent volumes were published, and the network prevented external provider calls. Only those test containers and their network were removed afterward.

Observed results: `/health/live` **200**; static SPA `/` **200**; authenticated `/api/watchlist` **200** with six starter entries including AAPL; database `watchlistInitializedAt` present and exactly six owned entries after production bootstrap. `/health/ready` correctly returned **503**, with MongoDB/configuration ready and Alpaca `connecting`; authenticated offline asset search returned **503**, without fabricated search results. This proves startup, migration, static packaging, and honest dependency failure behavior. It does not prove successful container live-provider search or add/remove; those successful controlled flows are covered by the browser suite.

Migration API tests cover bounded/ordered iteration, index failure, partial-work retry, transaction rollback, provider cleanup, and preservation of already initialized empty lists. Startup creates personal indexes and initializes users before exposing the full API/socket server. The old global watchlist collection is retained but unused; no legacy global membership is copied into a user's personal list. Initialized users are not reseeded on login/restart. Privacy is enforced by authenticated ownership at API boundaries and personal symbol/user rooms; admin status does not grant access to another user's private watchlist data.

## Previously confirmed live deployment

On **2026-11-07**, the existing deployment at [MarketPulse](https://marketpulse-xingchengh.onrender.com) was verified separately: `/health/live` **200**; `/health/ready` **200** with MongoDB/configuration ready and Alpaca `market_closed`; `/api/setup/status` configured **true** with MongoDB/Google OAuth/tokens ready and Alpaca `market_closed`; static SPA **200**. The production Google callback configuration was saved and an actual Google sign-in reached the dashboard as the existing viewer. Secrets remain in Render environment configuration and persistence uses MongoDB Atlas.

Those live checks are baseline evidence from the earlier deployment, not evidence that this personal-watchlist change has been deployed. No market-open real IEX event or new-symbol stream subscription was verified. Live two-user personal ownership, successful provider-backed search/add/remove persistence, account switching/sign-out, and market-open delivery for a newly added symbol still require verification after deployment with approved accounts. No production changes were made by this local verification task.

## Remaining operating limits

IEX is not consolidated SIP coverage. A directory match indicates an active/tradable US equity, not a current quote or guaranteed market event. Outside market hours, the UI must show honest market-closed/no-event state; these tests do not imply market-open data was observed.

The **25-symbol per-user** limit does not cap the global subscription union. Account symbol/connection limits, IEX/SIP entitlements, API rate limits, Render CPU/memory and cold starts, MongoDB capacity, and metric retention need separate capacity checks before scaling. Free Render services can sleep or restart and interrupt sockets/monitoring. The coordinator, aggregator, and socket memberships are process-local; additional replicas require a shared subscription and event-delivery design. Controlled success and market-closed baseline health do not establish continuous monitoring availability.
