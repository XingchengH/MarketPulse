# Verification record — 2026-11-06

Environment: local macOS development host, Node 22, pnpm 11.25, MongoDB 7.0.20 system binary used by `MongoMemoryReplSet`, and Playwright Chromium 156.

The required gate completed successfully with `CI=true` where specified:

- `CI=true pnpm install --frozen-lockfile` — exit 0, frozen lockfile accepted.
- `CI=true pnpm typecheck` — exit 0 across contracts, API, web, and E2E.
- `CI=true pnpm test` — exit 0; 141 tests passed (4 contracts, 108 API, 29 web).
- `CI=true pnpm build` — exit 0 across contracts, API, web, and E2E.
- `docker compose config` — exit 0; API port 3000 and replica-set MongoDB configuration rendered successfully.
- `CI=true pnpm --filter @marketpulse/e2e test` — exit 0; 1 integrated Playwright smoke test passed.

Clean-checkout reproducibility was checked by moving every ignored `apps/**/dist` and `packages/**/dist` directory out of the workspace, running the frozen install, and rerunning the exact gate. Root typecheck builds `@marketpulse/contracts` first, so downstream packages do not depend on stale generated declarations.

The controlled E2E composes the production Express routes, HTTP and Socket.IO servers, OAuth state/callback and session flow, RBAC services, monitoring evaluator, models, alert/audit transactions, and a MongoDB replica set. Google identity and Alpaca IEX transport are test doubles. A narrow readiness/market-data façade replaces `server.ts` bootstrap, so the smoke does not exercise watchlist bootstrapping or minute-bucket writing; those remain separately tested. The AAPL trade is emitted directly through the in-process fake-provider handle; there is no event-injection HTTP or socket endpoint.

Live verification remains pending and is not implied by this record: a callback using user-owned Google credentials and an authenticated Alpaca connection/market event using approved live credentials and entitlements must be verified separately.
