# ADR-0002: Firestore as the default database provider

Status: Accepted (retroactive)
Date: 2026-07-18 (documentation date)

## Context

Given ADR-0001 (six pluggable backends), one had to be the default when `DB_PROVIDER` is unset. `NexusDB.ts` hardcodes this: `process.env.DB_PROVIDER ?? 'firestore'`. `DEPLOYMENT.md` independently confirms this is the intended path — it lists "Firebase project with Firestore & Auth enabled" as a hard prerequisite, and walks through Firebase Console setup, not Postgres setup. `firestore.rules` (376 lines of declarative security rules) and `firestore.indexes.json` further confirm real, non-trivial investment specifically in the Firestore path.

## Decision

Firestore is the production database backend. The other five (`DATABASE_SCHEMA.md`) exist for flexibility and future customers, not as equally-maintained parallel production paths today.

## Consequences

**Easier:**
- No self-hosted database ops burden for the primary deployment path (Firestore is fully managed).
- Real-time listeners are native to Firestore, which likely explains why `NexusWebSocket.ts` and the broader realtime layer feel natural on top of this choice.
- `firestore.rules` provides a genuine second layer of access control beneath the application-level `ABACEngine`/`TenantIsolation` (see `SYSTEM_SECURITY.md`) — defense in depth, not just one gate.

**Harder / costs:**
- Firestore's query model (no arbitrary joins, limited aggregate queries) constrains what `NexusDB`'s shared `find()` interface can efficiently express compared to what Postgres could do natively — worth keeping in mind before assuming feature parity across all six backends.
- Cost scales with reads/writes, not a flat instance cost — worth monitoring as usage grows (Prometheus/Grafana are already in `docker-compose.yml` for this).

## Note

This ADR should be revisited if/when a customer contract requires a specific backend (e.g., data residency requiring self-hosted Postgres) — at that point, promote that backend from "supported" to "co-primary" deliberately, with its own test coverage, rather than assuming it already works at the same maturity level as Firestore.
