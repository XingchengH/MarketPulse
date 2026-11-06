# Operations

## Runtime

The Compose stack exposes the web app on `5173`, API on `3000`, and MongoDB on `27017`. MongoDB starts a single-node replica set for local transactional behavior. Build images from the repository root; both application images use multi-stage builds, non-root runtime users, and health checks. `/health/live` is process liveness and `/health/ready` checks dependencies.

On SIGTERM or SIGINT the API stops accepting HTTP, closes Socket.IO, disconnects the market-data provider, stops monitoring, performs a bounded final minute-metric flush, and closes MongoDB. Each phase is time-bounded so orchestration can eventually terminate a stuck process.

Observed latency is `receivedAt − providerTimestamp` at the API. It is an end-to-end operational indicator, not a network-only probe. Alert and throughput interpretation must account for market-open state and IEX coverage.

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
