# MarketPulse

MarketPulse is a real-data operations dashboard for an Alpaca IEX market stream. It provides Google OAuth sign-in, server-enforced roles, a live symbol monitor, threshold rules, alert acknowledgement, audit history, and MongoDB persistence. It never substitutes fabricated market data when Alpaca is unavailable.

## Local setup

Requirements: Node 22+, pnpm 11.25, and MongoDB 8 configured as a replica set (transactions require it).

1. Copy `.env.example` to `.env` and create unique token secrets of at least 32 characters.
2. Follow [Google OAuth setup](docs/google-oauth-setup.md) and [Alpaca setup](docs/alpaca-setup.md).
3. Start a local replica-set MongoDB with `docker compose up -d mongodb`. The local URI is `mongodb://localhost:27017/marketpulse?replicaSet=rs0`.
4. Run `pnpm install --frozen-lockfile`, then `pnpm dev`.
5. Open `http://localhost:5173`. The API listens on `http://localhost:4000`; Google must redirect exactly to `http://localhost:4000/api/auth/google/callback`.

Secrets belong only in the untracked `.env` file or a server-side secret manager. Never place Google or Alpaca secrets in `apps/web`, a `VITE_*` variable, client JavaScript, source control, or images.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
docker compose config
```

`pnpm e2e` is a controlled browser smoke test. It runs only in Playwright with in-process fake Google and Alpaca adapters and an in-memory test store; its trade enters through the fake provider handle, not a public injection endpoint. It proves the UI contract without external credentials. It does not prove live Google OAuth, Alpaca authorization, exchange coverage, or production networking; verify those separately with credentials in a deployment environment.

See [operations](docs/operations.md) for deployment, health checks, shutdown behavior, and the production checklist. Observed latency means `API receipt timestamp − provider event timestamp`; it includes provider publication, network transit, client/runtime scheduling, and clock alignment, so it is not a network-only measurement.
