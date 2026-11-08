# Operations

## Runtime

The Compose stack exposes the web app on `5173`, API on `3000`, and binds MongoDB only to `127.0.0.1:27017`. MongoDB starts a single-node replica set for local transactional behavior. Production MongoDB must require authentication and must not be publicly exposed. Build images from the repository root; both application images use multi-stage builds, non-root runtime users, and health checks. `/health/live` is process liveness and `/health/ready` checks dependencies.

On SIGTERM or SIGINT the API stops accepting HTTP, closes Socket.IO, disconnects the market-data provider, stops monitoring, performs a bounded final minute-metric flush, and closes MongoDB. Each phase is time-bounded so orchestration can eventually terminate a stuck process.

Observed latency is `receivedAt − providerTimestamp` at the API. It is an end-to-end operational indicator, not a network-only probe. Alert and throughput interpretation must account for market-open state and IEX coverage.

## Personal watchlists and startup migration

Each user can hold at most 25 symbols, enforced transactionally even under concurrent requests. First-time initialization adds AAPL, MSFT, NVDA, AMZN, META, and TSLA and writes `watchlistInitializedAt` in the same transaction. The dashboard lets every signed-in role add and remove symbols, including the final symbol. The admin page has no global watchlist control.

Startup creates required indexes before selecting users whose marker is missing or null. It captures the highest pending `_id`, then traverses ascending `_id` batches of at most 100 users up to that boundary, retaining only one batch in memory. Each user goes through `PersonalWatchlistService.initializeUser`, also used by authentication. Persisted markers make retries safe after interruption: completed users are skipped, unfinished transactions retry, and initialized empty lists stay empty. Users created after the captured boundary are handled by sign-in initialization or the next startup attempt. The migration emits aggregate initialized-user and batch counts only; initialization failures use a generic log message without user IDs, email addresses, user-to-symbol mappings, secrets, or connection URIs.

Only after indexes, migration, and initial union setup succeed does startup expose the full API and attach Socket.IO. An index or initialization failure leaves `/health/live` available, `/health/ready` and protected API traffic at 503, and setup reporting not configured while startup retries. Provider connection state must also be ready before the readiness probe succeeds. Do not bypass these gates to accelerate deployment.

The legacy global MongoDB `watchlists` collection is retained as an unused compatibility artifact. Production imports and subscribes from personal `UserWatchlistEntry` memberships exclusively. Migration neither copies the old global list into personal lists nor drops, clears, or rewrites the old collection or migration records. Keep normal database backups and preserve this history during rollout.

Search uses Alpaca's trading asset directory at `/v2/assets?status=active&asset_class=us_equity`, retaining only active, tradable US equities and matching ticker or company name. Addition checks an exact normalized ticker in that directory. A cached search result means the asset is eligible for selection; it does not guarantee a current quote or market-wide data. The configured stream is IEX, not the consolidated SIP feed. SIP access depends on Alpaca entitlements and a compatible provider configuration; an entitlement alone does not switch this implementation's feed.

One provider connection subscribes to the deduplicated union of all personal memberships. Shared references keep a symbol subscribed until its final membership is removed. REST overview, symbol/detail/metrics, and alert reads are checked against the requesting user's current list. Socket.IO joins authorized symbol rooms and a private user room; watchlist changes update all of that user's tabs and refresh membership. Clients cannot request arbitrary symbol rooms or another user's watchlist. Operational/provider status remains shared.

## Preview capacity

Free Render services can sleep and restart, interrupting WebSocket sessions and live monitoring. Readiness may remain unavailable during cold start, migration, provider authentication, or subscription recovery. This deployment is a small demo, not continuous monitoring infrastructure. The per-user 25-symbol limit does not bound the global union: disjoint lists can require up to 25 times the user count in unique subscriptions. Verify current Alpaca account symbol/connection limits, IEX/SIP entitlements, and API rate limits before increasing usage. MongoDB storage, transaction load, metric retention, and Render memory/CPU also need capacity planning.

The subscription coordinator, aggregation, and Socket.IO rooms live in one API process. Running multiple replicas requires a deliberate shared subscription strategy and cross-process membership/event delivery; simply adding replicas can duplicate Alpaca connections and leave another process's socket memberships stale.

Realtime snapshot construction uses rotating batches of at most 500 distinct symbols per build (`maxSymbols` in the publisher). Ongoing market events request builds at the bounded publication cadence. For a stable union of N symbols, every symbol is selected within `ceil(N / 500)` successive builds; larger unions increase the refresh cycle without excluding symbols at the end of the list. A union of at most 500 symbols is included in every build. Symbol delivery remains volatile and room-scoped, and REST remains authoritative for personal membership and initial data.

## Verification

Run from the repository root with a local `mongod` available or permission for `mongodb-memory-server` to download its binary. API integration tests create disposable replica sets and require local socket access.

```sh
pnpm --filter @marketpulse/api exec vitest run src/bootstrap-personal-watchlists.test.ts src/monitoring/personal-watchlist-service.integration.test.ts src/health.test.ts
pnpm --filter @marketpulse/api test
pnpm --filter @marketpulse/web test
pnpm typecheck
pnpm build
pnpm e2e
docker compose config
```

The automated migration tests cover ordered bounded queries, retry after partial work, index failure, initialized empty lists, transaction rollback, and provider cleanup. Controlled test adapters do not verify live Google credentials, Alpaca account capacity/entitlements, free-tier availability, or production network behavior. During a deployment, confirm readiness recovery, aggregate migration counts, independent user lists, and that an intentionally emptied list remains empty after restart.

## Production checklist

- Use unique 32+ character access-token and refresh-token secrets from a secret manager; rotate them under an incident plan.
- Register the exact HTTPS Google origin and callback; verify a live sign-in and logout.
- Verify live Alpaca authentication, IEX/SIP entitlement, subscriptions, reconnect behavior, and market-clock behavior with approved credentials.
- Run a supported MongoDB replica set with authentication, encryption, backups, restore drills, monitoring, and capacity alerts.
- Terminate TLS at a trusted proxy, restrict origins, keep cookies secure, and expose only the web/API entrypoints.
- Configure centralized structured logs, request IDs, health probes, alert delivery, clock synchronization, and retention policies.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`, image scanning, and `docker compose config` in CI.
- Exercise graceful termination and confirm the final metric bucket and audit transaction are persisted.
- Confirm no `.env`, API key, OAuth secret, token secret, or database credential is in source, browser assets, logs, or container layers.
- Treat controlled E2E success separately from pending live-credential verification; never promote the fake adapters into a production escape hatch.
