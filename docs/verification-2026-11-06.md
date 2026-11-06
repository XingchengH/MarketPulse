# Verification record — 2026-11-06

Environment: local macOS development host, Node 22, pnpm 11.25, MongoDB 7.0.20 system binary used by `MongoMemoryReplSet`, and Playwright Chromium 156.

The required gate completed successfully with `CI=true` where specified:

- `CI=true pnpm install --frozen-lockfile` — exit 0, frozen lockfile accepted.
- `CI=true pnpm typecheck` — exit 0 across contracts, API, web, and E2E.
- `CI=true pnpm test` — exit 0; 140 tests passed (4 contracts, 107 API, 29 web).
- `CI=true pnpm build` — exit 0 across contracts, API, web, and E2E.
- `docker compose config` — exit 0; API port 3000 and replica-set MongoDB configuration rendered successfully.
- `CI=true pnpm --filter @marketpulse/e2e test` — exit 0; 1 integrated Playwright smoke test passed.

The controlled E2E starts the real API, HTTP server, Socket.IO server, MongoDB replica set, OAuth state/callback and session flow, RBAC routes, monitoring evaluator, alert persistence, audit transaction, and browser UI. Google identity and Alpaca IEX transport are the only test doubles. The AAPL trade is emitted directly through the in-process fake-provider handle; there is no event-injection HTTP or socket endpoint.

Live verification remains pending and is not implied by this record: a callback using user-owned Google credentials and an authenticated Alpaca connection/market event using approved live credentials and entitlements must be verified separately.
