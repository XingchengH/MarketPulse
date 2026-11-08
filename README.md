# MarketPulse

MarketPulse is a real-data operations dashboard for an Alpaca IEX market stream. It provides Google OAuth sign-in, personal watchlists, server-enforced roles, a live symbol monitor, threshold rules, alert acknowledgement, audit history, and MongoDB persistence. It never substitutes fabricated market data when Alpaca is unavailable.

## Personal watchlists

Every signed-in user, including viewers, can manage up to **25 symbols**. A new watchlist starts with **AAPL, MSFT, NVDA, AMZN, META, and TSLA**. Removing every symbol leaves the list empty across sign-ins and restarts. The admin page manages users and rules; watchlists are managed from the dashboard.

Search matches ticker symbols and company names from Alpaca's active, tradable US-equity asset directory (`GET /v2/assets?status=active&asset_class=us_equity`, filtered for `tradable: true`). Adding a symbol requires an exact normalized ticker match. Search availability does not imply consolidated market coverage: the current stream uses **IEX**, which covers IEX activity rather than the full US market; **SIP** requires the appropriate Alpaca entitlement and provider configuration.

The API streams the deduplicated union of all personal lists through one provider connection. REST market data, symbol metrics, and alert reads are scoped to the signed-in user's current list; Socket.IO rooms and watchlist-change notifications enforce the same private membership. Sharing an upstream subscription never grants access to another user's list or symbols.

At startup, users without a `watchlistInitializedAt` marker receive the six starters through the same transactional initializer used at sign-in. Migration runs in bounded batches, can safely resume after interruption, and preserves initialized empty lists. The legacy global `watchlists` collection and migration history are retained and unused by production; no collection is dropped or cleared. See [operations](docs/operations.md) for rollout and capacity details.

## Local setup

Requirements: Node 22+, pnpm 11.25, and MongoDB 8 configured as a replica set (transactions require it).

1. Copy `.env.example` to `.env` and create unique token secrets of at least 32 characters.
2. Follow [Google OAuth setup](docs/google-oauth-setup.md) and [Alpaca setup](docs/alpaca-setup.md).
3. Start a local replica-set MongoDB with `docker compose up -d mongodb`. For a host-run API, use `mongodb://localhost:27017/marketpulse?replicaSet=rs0&directConnection=true` so the driver does not try to resolve the Compose-only `mongodb` hostname.
4. Run `pnpm install --frozen-lockfile`, then `pnpm dev`.
5. Open `http://localhost:5173`. The API listens on `http://localhost:3000`; Google must redirect exactly to `http://localhost:3000/api/auth/google/callback`.

`pnpm dev` builds the shared contracts before starting the API and web development servers, then watches contracts alongside both servers so edits to the shared package are rebuilt automatically.

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

The E2E smoke test composes the production Express routes, HTTP, Socket.IO, authentication/RBAC, monitoring services, models, and a MongoDB replica set around `NODE_ENV=test` Google and Alpaca adapters. It supplies a small readiness/market-data façade instead of executing `server.ts`, so production bootstrap, personal-watchlist migration, and minute-bucket writing remain covered by their API tests rather than this browser smoke. Its trade enters through the in-process fake-provider handle, never a public injection endpoint. It does not prove live Google OAuth, Alpaca authorization, exchange coverage, or production networking; verify those separately with credentials in a deployment environment.

See [operations](docs/operations.md) for deployment, health checks, shutdown behavior, and the production checklist. Observed latency means `API receipt timestamp − provider event timestamp`; it includes provider publication, network transit, client/runtime scheduling, and clock alignment, so it is not a network-only measurement.

## Free preview deployment

GitHub Pages cannot run the API, OAuth callback, MongoDB transactions, or WebSockets. The included `render.yaml` deploys one same-origin Docker web service on Render; use a MongoDB Atlas Free connection string for `MONGODB_URI`. Render generates the token secrets, while Google and Alpaca credentials are entered in Render's secret prompts. Free Render services spin down when idle, so this configuration is intended for demos and portfolio previews rather than production workloads. A 25-symbol per-user limit does not cap the shared subscription union; verify current Alpaca symbol/connection limits and entitlements, and provision compute/database capacity before expanding beyond a small preview.

The latest local evidence is recorded in [verification record — 2026-11-06](docs/verification-2026-11-06.md).
