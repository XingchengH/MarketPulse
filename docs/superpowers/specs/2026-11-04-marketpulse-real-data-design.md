# MarketPulse Real-Data Application Design

## Purpose

MarketPulse will become a working market-data operations application for a portfolio project. It will ingest real US equity trades and quotes, measure the application's own stream health, persist operational state, authenticate users with Google, and enforce viewer, operator, and admin permissions on the server.

The application is an original project inspired by the responsibilities in the supplied resume. It does not reconstruct Bloomberg software, connect to Bloomberg systems, or claim access to proprietary exchange telemetry.

## Scope

The first complete version supports US equities through Alpaca's free IEX market-data feed. It replaces the prototype's fictional global exchange records with a configurable watchlist of US stock symbols.

The application displays two kinds of information and labels them distinctly:

1. Provider data: trades, quotes, prices, sizes, timestamps, and any other fields returned by Alpaca.
2. Application measurements: received messages per second, observed ingestion latency, last-event age, reconnect count, provider errors, and stale-symbol state.

The application will not display packet loss because the selected provider interface does not expose enough information to support that claim. It will not fabricate values when credentials are missing, the market is closed, or the provider is unavailable.

## Architecture

The system has three runtime parts:

- A React and Redux Toolkit client renders operational views, consumes REST resources, and receives live updates through Socket.IO.
- A Node.js, Express, and TypeScript API owns authentication, RBAC, validation, persistence, rule evaluation, provider connectivity, and realtime client fan-out.
- MongoDB stores users, refresh-token families, watchlists, rules and their versions, alerts, audit events, and time-bucketed metrics.

The API owns the single Alpaca WebSocket connection for the deployment. Browser clients never receive an Alpaca key and never connect directly to Alpaca. An isolated provider adapter converts Alpaca messages into internal market-event types so another provider can be added without changing rule evaluation or client contracts.

Docker Compose starts the client, API, and a local MongoDB instance for development. MongoDB Atlas free tier is the recommended remote database. Production hosting is outside this implementation phase because a target host and credentials have not been selected.

## Authentication and Authorization

Google OAuth 2.0 is the identity provider. The backend initiates authorization, validates the OAuth state parameter, handles the callback, and creates or updates a local user record keyed by Google's stable subject identifier.

New users receive the viewer role. The roles are:

- Viewer: read dashboards, feeds, alerts, rules, and audit history.
- Operator: viewer permissions plus alert acknowledgement and operational watchlist actions.
- Admin: operator permissions plus rule creation, editing, enablement, rollback, and user-role administration.

The server is the authorization boundary. Hiding a client control is supplementary and never substitutes for backend checks.

Successful login issues a short-lived signed access token in a secure, HTTP-only, SameSite cookie. A rotating refresh token is stored as a one-way hash in MongoDB and delivered only in a secure, HTTP-only cookie. Reuse of an invalidated refresh token revokes its token family. Logout revokes the active family and clears both cookies. Tokens never use browser local storage.

The API uses strict origin configuration, security headers, request-size limits, authentication rate limits, schema validation, sanitized errors, and production cookie settings. Secrets are loaded from environment variables and are never sent to the client or committed to source control.

## Real Market-Data Pipeline

The Alpaca adapter authenticates to the free IEX WebSocket and subscribes to symbols in the active watchlist. The initial watchlist is AAPL, MSFT, NVDA, AMZN, META, TSLA, JPM, and SPY so it fits the free-feed use case while spanning several liquid names.

Each incoming event is normalized with:

- provider and feed identifiers;
- symbol and event type;
- provider event timestamp;
- backend receive timestamp;
- trade or quote fields present in the source event.

An in-memory aggregator maintains current symbol state and one-second counters. It emits live snapshots to authenticated Socket.IO clients at a bounded interval rather than forwarding every provider event. A scheduled metric writer persists one-minute buckets to MongoDB with message counts, latency percentiles, latest price, latest quote, error count, reconnect count, and stale duration.

Observed ingestion latency is `backend receive timestamp - provider event timestamp`. It is labeled as observed latency because clock skew and provider timestamp semantics limit its interpretation. Throughput is the count of provider events received by this application, not total exchange volume.

The stale detector marks a symbol stale only when the US market session is expected to be open and the symbol has exceeded its configured event-age threshold. Outside market hours the UI shows “market closed” rather than an incident. Market-session state comes from Alpaca's clock endpoint and is cached with bounded refresh.

## Rules, Alerts, and Audit History

Rules target one symbol or all watched symbols. The first version supports these metrics:

- observed latency in milliseconds;
- messages per second;
- last-event age in seconds;
- provider error count over a rolling interval;
- reconnect count over a rolling interval.

Each rule includes its metric, comparison operator, threshold, duration, severity, enabled state, scope, version, creator, and update timestamp. Editing, enabling, disabling, or rolling back a rule creates an immutable version snapshot.

The evaluator runs against aggregated stream state. A sustained violation opens one alert per rule and symbol. Repeated evaluations update that alert rather than creating duplicates. Returning below the threshold changes the alert to recovered; it does not mark it acknowledged. An operator or admin can acknowledge an open or recovered alert, which records the user and timestamp.

Every privileged action writes an immutable audit event containing actor, action, resource type, resource ID, timestamp, request correlation ID, and redacted before/after data. Secret values and OAuth tokens never enter audit documents.

## Client Experience

The existing visual direction remains: a high-density analyst workspace with restrained health colors, compact tables, keyboard-accessible controls, responsive navigation, and light and dark themes.

The views become:

- Overview: provider connection state, market state, watched-symbol count, event throughput, observed latency, stale symbols, open alerts, live charts, and items needing attention.
- Live feeds: searchable and sortable watchlist showing symbol, venue/feed, latest price, spread, event rate, observed latency, last-event age, and health.
- Alert center: open, recovered, and acknowledged alerts with feed context and acknowledgement actions.
- Configuration: versioned monitoring rules and admin-only watchlist management.
- Audit trail: searchable user and system activity with redacted before/after diffs.
- Administration: admin-only user list and role changes.
- Setup: an explicit configuration state when Google, Alpaca, MongoDB, or token secrets are unavailable.

The current role selector is removed. The header shows the authenticated user's Google profile and server-provided role. A login page explains the requested Google identity scope before beginning OAuth.

When live data is unavailable, the client shows the precise state: credentials missing, provider authenticating, market closed, reconnecting, rate limited, provider unavailable, or no events received. It never falls back to synthetic market data.

## API and Realtime Boundaries

The REST API provides:

- authentication session, refresh, logout, and current-user resources;
- current overview and symbol snapshots;
- metric history queries with bounded time ranges;
- alert queries and acknowledgement;
- rule CRUD, enablement, version history, and rollback;
- watchlist reads and admin mutations;
- audit history queries;
- admin user and role management;
- liveness, readiness, and configuration-status endpoints.

Socket.IO sends authenticated room-scoped events for overview snapshots, symbol snapshots, alert changes, provider state, and rule changes. Connection authentication reads the same cookie-based session. The client treats realtime events as cache updates and refetches the affected REST resource after reconnecting.

REST and Socket.IO payloads share versioned TypeScript schemas from a dedicated contracts package. The server validates all inbound mutation payloads. Time values use ISO 8601 UTC strings at API boundaries.

## Failure Handling and Operations

Alpaca reconnects use capped exponential backoff with jitter. Connection attempts, authentication failures, subscription rejections, rate limits, parse failures, and disconnect reasons become structured operational events. A provider outage never terminates the API process.

MongoDB startup failure makes readiness fail and blocks authenticated application use while leaving liveness available. A temporary persistence failure prevents mutations and returns a correlation ID; live provider ingestion may continue in memory, but the UI labels metric history as degraded until persistence recovers.

The API exposes structured logs without secrets, request IDs, `/health/live`, `/health/ready`, and `/api/setup/status`. Readiness covers MongoDB, required configuration, and provider initialization. The provider can be disconnected outside market hours without failing API readiness.

## Testing

Unit tests cover provider-message normalization, aggregation, latency calculation, market-hours-aware stale detection, rule evaluation, alert deduplication, token rotation, and RBAC decisions.

API integration tests use an in-memory or containerized MongoDB and a fake provider adapter. They cover the OAuth callback boundary, current session, logout, permission failures, rule versioning and rollback, alert acknowledgement, audit redaction, setup status, health endpoints, and validation errors.

Socket.IO integration tests cover authenticated connection, snapshot delivery, authorization failure, reconnect resynchronization, and alert events.

React tests cover login/setup states, overview loading and failure states, live snapshot rendering, rule forms, alert acknowledgement, audit diffs, admin visibility, and access-denied behavior.

End-to-end smoke tests use fake OAuth and provider adapters in test mode. Production code cannot enable fake adapters unless `NODE_ENV=test`.

## Delivery Sequence

Implementation is divided into independently testable slices:

1. Monorepo structure, shared contracts, configuration validation, MongoDB connection, health endpoints, and Docker development environment.
2. Google OAuth, secure cookies, refresh-token rotation, user persistence, and server-enforced RBAC.
3. Alpaca provider adapter, real event normalization, aggregation, market clock, reconnection, and metric persistence.
4. Rules, version history, alert evaluation, acknowledgement, and audit events.
5. React data layer and replacement of every synthetic dashboard path with REST and Socket.IO data.
6. Administration, setup diagnostics, error states, testing, security checks, and deployment documentation.

Each slice must run and pass its focused tests before the next slice begins. Real Google and Alpaca integration verification requires credentials supplied through local environment variables. Automated tests use controlled adapters and never require or expose those credentials.

## Success Criteria

The first complete version is successful when:

- a user can sign in with Google and receives a persisted local account;
- the server enforces viewer, operator, and admin permissions;
- valid Alpaca credentials produce visible, real IEX trades and quotes for the watchlist;
- dashboard health metrics are derived from received events and clearly labeled;
- missing credentials or unavailable services produce explicit setup or error states with no synthetic fallback;
- rule violations create deduplicated alerts that operators can acknowledge;
- rule changes are versioned, admins can roll back, and privileged actions appear in the audit trail;
- reconnecting clients resynchronize through REST after Socket.IO reconnection;
- the application runs locally through documented commands and Docker Compose;
- the production build and automated test suites pass.

## Deferred Work

Kafka or Redpanda, Kubernetes, multi-provider failover, full SIP market coverage, global equities, options data, email notifications, enterprise SSO, and production deployment are deferred. They require infrastructure, paid data entitlements, or deployment decisions beyond the approved free-plan first version.
