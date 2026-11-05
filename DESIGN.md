# MarketPulse UI concept

A local, interactive UI mockup based on the supplied market data platform responsibilities. This is an original portfolio concept, not a reconstruction of Bloomberg's proprietary interface. All feeds, alerts, people, metrics, and events are synthetic. No real Bloomberg integration or authentication is implemented.

## Design direction

An institutional data workspace for market data analysts and operators. Greenfield prototype; visual variance 4/10, motion 2/10, density 8/10, asset dependence 1/10, brand fidelity 2/10. The desktop layout prioritizes scanning feed health, comparing throughput, identifying incidents, and opening a specific exchange. Mobile preserves the same tasks with a compact navigation and horizontally scrollable tables.

The narrative is operational status, viewed at laptop distance, with a calm authoritative tone. The main viewport holds a summary strip, throughput chart, active alerts, and exchange table. The distinctive element is the precise exchange monitor, with venue identifiers, region, status, throughput, latency, packet loss, and miniature trends.

## Tokens

- Navigation: slate #141d24. Workspace: mist #f5f7f8. Surfaces: white #ffffff. Text: ink #202a32.
- Primary actions and healthy states: evergreen #168365. Brand accent and warnings: amber #f2aa54. Critical: muted red #d34f56.
- Typography: locally available Helvetica Neue / sans-serif for UI; SFMono-Regular / monospace for financial metrics and identifiers.
- Spacing: 4px unit, 24px main gutters, 20px panel padding. Panels 10px radius, controls 6px, status pills fully rounded.
- Hairline borders, almost no shadows. The navigation and workspace create the primary contrast.
- Motion only for interaction feedback, with reduced-motion support; demo stream can be paused.

## Reviewable workflows

1. Overview and live feeds: search, filter by region and health, sort, export CSV, change chart window, pause demo updates, open a feed.
2. Alerts: inspect and acknowledge incidents; acknowledgements enter audit history.
3. Rules: create and edit threshold rules, enable or disable, inspect version changes and roll back.
4. Audit: inspect changes with before/after values.
5. Preview viewer/operator/admin roles and light/dark themes. Role selection is demonstration only, not security enforcement.

## App implementation after design review

Keep this phase frontend-only. After review, replace mock state with Redux Toolkit and API adapters; add Node/Express services, MongoDB/Mongoose versioned rules and audit records, Socket.IO feed updates, server-enforced JWT/RBAC, and integration tests. Kafka ingestion, Bloomberg connectivity, and deployment follow once real integration contracts are available. Resume performance figures are goals to validate, not performance claims for this prototype.
