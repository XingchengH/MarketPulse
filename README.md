# MarketPulse

MarketPulse is a real-data operations dashboard for an Alpaca IEX market stream. It provides Google OAuth sign-in, server-enforced roles, a live symbol monitor, threshold rules, alert acknowledgement, audit history, and MongoDB persistence. It never substitutes fabricated market data when Alpaca is unavailable.

## Local setup

Requirements: Node 22+, pnpm 11.25, and MongoDB 8 configured as a replica set (transactions require it).

1. Copy `.env.example` to `.env` and create unique token secrets of at least 32 characters.
2. Follow [Google OAuth setup](docs/google-oauth-setup.md) and [Alpaca setup](docs/alpaca-setup.md).
3. Start a local replica-set MongoDB with `docker compose up -d mongodb`. The local URI is `mongodb://localhost:27017/marketpulse?replicaSet=rs0`.
4. Run `pnpm install --frozen-lockfile`, then `pnpm dev`.
5. Open `http://localhost:5173`. The API listens on `http://localhost:3000`; Google must redirect exactly to `http://localhost:3000/api/auth/google/callback`.

Secrets belong only in the untracked `.env` file or a server-side secret manager. Never place Google or Alpaca secrets in `apps/web`, a `VITE_*` variable, client JavaScript, source control, or images.

## Validation

```sh
CI=true pnpm install --frozen-lockfile
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
docker compose config
CI=true pnpm --filter @marketpulse/e2e test
```

The E2E smoke test composes the production Express routes, HTTP, Socket.IO, authentication/RBAC, monitoring services, models, and a MongoDB replica set around `NODE_ENV=test` Google and Alpaca adapters. It supplies a small readiness/market-data façade instead of executing `server.ts`, so production bootstrap, watchlist bootstrap, and minute-bucket writing remain covered by their API tests rather than this browser smoke. Its trade enters through the in-process fake-provider handle, never a public injection endpoint. It does not prove live Google OAuth, Alpaca authorization, exchange coverage, or production networking; verify those separately with credentials in a deployment environment.

See [operations](docs/operations.md) for deployment, health checks, shutdown behavior, and the production checklist. Observed latency means `API receipt timestamp − provider event timestamp`; it includes provider publication, network transit, client/runtime scheduling, and clock alignment, so it is not a network-only measurement.

The latest local evidence is recorded in [verification record — 2026-11-06](docs/verification-2026-11-06.md).
