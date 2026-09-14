# ADR-0026: NexusDB.runTransaction() — real atomicity for Firestore, honest best-effort elsewhere

Status: Accepted
Date: 2026-07-25

## Context

CTO Audit Part 8, section 9: "Order → Inventory → Payment → Delivery... All must be Atomic. Rollback Support Must be there." Independently, `InventoryReservationService.ts` was already calling `NexusDB.runTransaction(...)` — confirmed by `tsc` in Part 3 to not exist on the class, left on the technical debt backlog pending the right context to fix it properly rather than guessed at.

## Decision

Added `runTransaction<T>(callback)` to `NexusDBClient`, with a minimal `NexusDBTransaction` interface (`get`/`update` only — matching exactly what the real caller needs, not the full adapter surface). For the Firestore backend (confirmed production default, `docs/adr/0002`), delegates to Firestore's own native `runTransaction` API — real, ACID-equivalent atomicity. For every other `DB_PROVIDER`, runs the callback's operations sequentially with **no** cross-operation atomicity, and logs a warning every time that path executes.

The non-Firestore path is a deliberate, honestly-limited choice, not a placeholder pretending to be complete: building real transactions for Postgres (a single connection with `BEGIN`/`COMMIT`), MongoDB (sessions), and the other three supported backends is real, separate work per backend, not a single mechanical addition — attempting all of it in one pass risked shipping something that looks uniformly safe but isn't.

## Consequences

**Easier:** the confirmed-broken call site (`InventoryReservationService.ts`'s stock-confirmation logic) now works, with real atomicity on the backend that's actually in production use.

**Harder / cost — stated as prominently as the fix itself:** a deployment running on any `DB_PROVIDER` other than `firestore` gets a *working* but *not atomic* transaction — a partial failure partway through will not roll back earlier writes. The warning log is the current safeguard against this being silently relied upon; it is not a substitute for building real per-backend transaction support before a non-Firestore deployment handles real financial operations at scale.

## Follow-up

Build real transaction support for Postgres next (single-connection `BEGIN`/`COMMIT`/`ROLLBACK`) — it's the only other backend with a running service in `docker-compose.yml`, matching the same prioritization logic used in `docs/architecture/DATABASE_SCHEMA.md` (Part 1) for which backend to keep tested.

## Verification

Type-checks cleanly against the real compiler, including `InventoryReservationService.ts`'s call site, which was confirmed broken by `tsc` before this fix and confirmed clean after.
