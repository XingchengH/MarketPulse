# MarketPulse design

MarketPulse is a dense operations workspace built around measured data and explicit service state. The sidebar keeps overview, live feeds, alerts, rules, audit, and administration in a stable hierarchy. Tables favor scanning and exact numbers; evergreen, amber, and muted red communicate healthy, degraded, and critical states without relying on color alone.

The browser talks only to the Express API and authenticated Socket.IO connection. Express owns OAuth, JWT cookies, RBAC, watchlist changes, rules, alerts, and audit records. The API connects to Alpaca's IEX stream, normalizes events, aggregates current symbol snapshots, persists minute buckets, evaluates monitoring rules, and publishes invalidation events. MongoDB runs as a replica set because acknowledgement and audit mutations are transactional.

There is no demo-data or fabricated fallback in the running product. Missing credentials appear as setup state; provider outages and market closure remain visible. The test-only adapters are imported by the E2E package and are not selected by environment variables or mounted as event-injection routes.

Observed latency is calculated as the API receipt time minus the provider event timestamp. This is an end-to-end observation affected by clocks, provider handling, transit, and runtime scheduling—not a claim about network latency alone. Throughput is the API's trailing one-second receive count per visible symbol.
