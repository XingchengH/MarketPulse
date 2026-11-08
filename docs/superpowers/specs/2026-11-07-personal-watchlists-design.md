# Personal Watchlists and Asset Search Design

## Objective

MarketPulse will let every authenticated user search active, tradable US equities by ticker or company name and maintain a private watchlist. Each user may follow at most 25 symbols. The dashboard will show only that user's monitored symbols while the backend maintains one deduplicated Alpaca subscription for the union of all users' watchlists.

The feature must remain compatible with Alpaca's free IEX market-data feed and Render's free service tier. It must not fabricate prices, search results, or feed health when Alpaca is unavailable or the US market is closed.

## Scope

The first release includes:

- search for active, tradable US equities by symbol or company name;
- add and remove actions for every authenticated role;
- a maximum of 25 symbols per user;
- a six-symbol starter watchlist containing AAPL, MSFT, NVDA, AMZN, META, and TSLA;
- per-user filtering for overview, live feeds, symbol details, metrics, and alerts;
- deduplicated provider subscriptions across all users;
- realtime symbol delivery only to users who follow that symbol;
- persistence, audit events, migration, and automated tests.

The first release does not include multiple named watchlists, manual ordering, tags, sharing, public portfolios, non-US assets, options, cryptocurrency, paid SIP data, or portfolio holdings and profit calculations.

## Data Model

`UserWatchlistEntry` stores one document per followed symbol:

- `userId`: MongoDB ObjectId referencing the authenticated user;
- `symbol`: normalized uppercase provider symbol;
- `companyName`: the provider's display name at the time the symbol is added;
- `exchange`: provider exchange code when available;
- `assetClass`: provider asset class;
- `createdAt` and `updatedAt` timestamps.

A unique compound index on `{ userId: 1, symbol: 1 }` prevents duplicate additions under concurrent requests. An index on `{ symbol: 1 }` supports efficient union and reference-count queries.

The user record gains `watchlistInitializedAt`. New users receive the starter watchlist during first-login initialization. A migration initializes existing users once. An initialized user may remove every symbol without the application repopulating the starter list later.

The existing global watchlist collection is no longer the source of truth after migration. Production startup reads the deduplicated symbol union from `UserWatchlistEntry` records.

## Asset Search

The API exposes an authenticated search endpoint that accepts a trimmed query and returns at most ten matching assets. Results contain only the data needed by the client: symbol, company name, exchange, asset class, tradability, and whether the current user already follows the symbol.

The server obtains the asset directory through the Alpaca provider adapter and filters it to active, tradable US equities supported by the configured feed. Matching is case-insensitive and prioritizes exact symbol matches, then symbol prefixes, then company-name matches. The server keeps a bounded, short-lived cache of eligible assets so normal typeahead usage does not repeatedly download the provider directory. Cache refresh failures preserve a still-valid cache when possible; otherwise the endpoint returns a retryable provider-unavailable response.

The client starts searching after a short debounce and a minimum non-whitespace query length. It never invents local search results when the provider is unavailable.

## API and Authorization

All watchlist and search endpoints require an authenticated session.

- `GET /api/assets/search?q=apple` returns ranked eligible assets and per-user membership state.
- `GET /api/watchlist` returns only the current user's entries and limit metadata.
- `POST /api/watchlist` accepts one symbol and adds it to the current user's list.
- `DELETE /api/watchlist/:symbol` removes one symbol from the current user's list.

Add behavior validates the asset against Alpaca, rejects unsupported or inactive assets, enforces the 25-symbol limit transactionally, and treats duplicate concurrent additions as a stable conflict response. Remove behavior is idempotent at the service boundary and does not affect another user's entry.

Overview, symbol snapshots, metric history, and alert queries authorize the requested symbol against the current user's watchlist. Collection endpoints filter by the current user's symbols. Shared monitoring rules remain operational configuration, but users see rule outcomes only for symbols they follow.

Each mutation records an audit event with the authenticated actor, action, symbol, request correlation data, and before/after membership state. Secrets and provider credentials are never included.

## Subscription and Realtime Flow

The API owns one Alpaca connection. A subscription coordinator calculates the distinct union of all persisted user symbols and replaces the provider subscription only when that union changes.

Adding the first reference to a symbol subscribes the provider. Adding the same symbol for another user changes database membership but not the provider subscription. Removing a symbol unsubscribes only after its final user reference is removed.

Authenticated Socket.IO connections join rooms named for the current user's watchlist symbols. Symbol snapshots are published to the matching symbol room rather than broadcast to every client. When a user adds or removes a symbol, the server updates that user's active socket rooms and sends a personalized watchlist-change event. Reconnect always reloads room membership from MongoDB, so the database remains authoritative.

Global provider state may be broadcast to authenticated clients because it contains no user membership. Personalized overview counts are derived from authorized REST data and the user's room-scoped snapshots, not from the global subscription union.

## User Interface

The Live Feeds page becomes the main watchlist workspace.

At the top of the page, an asset-search field accepts ticker or company-name input and displays up to ten results. Each result shows symbol, company name, exchange when available, and one of these actions:

- `Add` when the symbol is available;
- `In watchlist` when already followed;
- `Limit reached` when the user has 25 entries.

The page displays a `used / 25` counter. Successful additions appear immediately in the personal feed table. Removal uses a lightweight confirmation because it changes the user's saved monitoring configuration. Errors distinguish no results, unsupported assets, duplicates, limit reached, and temporary provider failure.

The personal watchlist table preserves the current price, spread, throughput, latency, last-event, and health columns. It adds company name and a remove action. Overview cards, charts, drill-downs, and Alert Center use the same personal symbol scope. An empty watchlist shows a useful search prompt rather than an empty operational table.

The header continues to show the authenticated Google identity and role. Watchlist customization is available to viewer, operator, and admin roles because it affects only personal scope.

The profile area becomes an accessible account menu with two actions. `Sign out` revokes the current refresh-token family, clears authentication cookies and client caches, disconnects the realtime socket, and returns to the login screen. `Switch account` performs the same local session cleanup and then starts Google OAuth with `prompt=select_account`, ensuring Google shows its account chooser instead of silently reusing the previous identity. Ordinary login remains frictionless and does not force the chooser.

## Migration and Rollout

The migration creates starter entries for each existing user whose `watchlistInitializedAt` is absent, then records the initialization timestamp. The operation is idempotent and uses unique indexes so retries cannot create duplicates.

New-user initialization follows the same service path. Application startup must finish index synchronization and initialization before calculating the first provider union. A failure leaves readiness unavailable rather than starting with an incorrect subscription set.

The global watchlist model and admin-only watchlist controls remain unused after the new flow is active. Their removal can occur in the same implementation if no compatibility dependency remains; no production data is deleted as part of the migration.

## Failure Handling

- Search/provider unavailable: show a retryable message and retain the user's persisted watchlist.
- Market closed: show the existing market-closed state without treating symbols as stale.
- Database mutation failure: do not update provider subscriptions or optimistic membership permanently; return a correlation ID.
- Provider subscription failure: retain persisted membership, surface degraded provider state, and retry through the existing reconnect strategy.
- Duplicate mutation: return a deterministic conflict without duplicate documents or duplicate subscriptions.
- Limit race: enforce the 25-item maximum inside the database transaction, not only in the client.
- Socket reconnect: rebuild room membership from the database and refetch personalized REST state.

## Testing

Contract tests cover asset results, watchlist entries, limit metadata, and realtime membership events.

API unit and integration tests cover search ranking and filtering, authentication, ownership isolation, starter initialization, idempotent migration, add/remove audit events, unsupported assets, duplicate races, the transactional 25-item limit, union reference counting, and rollback behavior.

Realtime tests connect two users with overlapping and non-overlapping lists and prove that each receives only authorized symbol snapshots. Reconnect tests prove that room membership reloads from MongoDB.

React tests cover debounced search, result states, add/remove behavior, the counter, limit messaging, provider errors, empty state, and filtering across overview, feeds, metrics, and alerts.

Authentication tests cover the account menu, logout cache cleanup, refresh-token-family revocation, socket teardown, and the `prompt=select_account` authorization URL used only by the switch-account flow.

The controlled end-to-end scenario creates two authenticated users, customizes their lists, verifies persistence across reloads, emits provider events for shared and private symbols, and asserts UI and socket isolation. Production verification confirms real asset search, a persisted add/remove cycle, Google-authenticated ownership, and real Alpaca IEX behavior when the market is open.

## Acceptance Criteria

- Every authenticated user can search eligible US equities by ticker or company name.
- Every user can persistently add or remove symbols without changing another user's list.
- No user can hold more than 25 watchlist entries, including under concurrent requests.
- New and existing users receive the starter list exactly once.
- The provider subscribes to the distinct union of user symbols and avoids redundant subscriptions.
- REST and Socket.IO responses do not expose another user's watchlist membership or symbol data outside the current user's scope.
- Overview, Live Feeds, metrics, symbol details, and alerts reflect the current user's watchlist.
- Search and monitoring report honest provider, market, and persistence failures without synthetic data.
- Users can sign out or deliberately switch Google accounts from the authenticated profile menu.
- Automated tests and production health checks pass before deployment.
