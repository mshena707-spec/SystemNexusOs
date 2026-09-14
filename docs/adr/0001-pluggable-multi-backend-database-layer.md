# ADR-0001: Pluggable multi-backend database layer (NexusDB)

Status: Accepted (retroactive — documented as part of CTO Audit Part 1 response)
Date: 2026-07-18 (documentation date; original implementation predates this)

## Context

`package.json` lists `pg`, `mongodb`, `@supabase/supabase-js`, `firebase`/`firebase-admin`, `better-sqlite3`, and `@libsql/client` as dependencies — six different database technologies. Read without context, this looks like the project couldn't settle on a database. Read against the actual code (`src/lib/database/NexusDB.ts`, 978 lines), it's the opposite: a single deliberate interface, `NexusDB`, with each of the six as a lazily-loaded, swappable backend selected by the `DB_PROVIDER` environment variable.

## Decision

All application code accesses data exclusively through `NexusDB.get/add/update/find` (enforced by a comment in the source: *"Business logic must NEVER import from `firebase/firestore` or any database SDK directly"*). The active backend is chosen per-deployment via `DB_PROVIDER`, not per-feature — the whole application runs against one backend at a time.

Rationale for supporting six, rather than one:
- **Firestore** — fast to build on, generous free tier, matches the project's Google AI Studio origin (see `GEMINI_API_KEY` in `.env.example`).
- **Postgres** — the backend with an actual running service in `docker-compose.yml`; the self-hostable, compliance-friendly option.
- **Supabase, MongoDB, Turso, SQLite** — additional options that widen who this product can be sold to (a customer with an existing Postgres/Mongo investment, or a pilot deployment needing zero external infra).

## Consequences

**Easier:**
- Sales/deployment flexibility — a prospective customer's existing infra requirement doesn't force a rewrite.
- Testing against a lightweight backend (`sqlite`/`memory`) without needing cloud credentials.

**Harder / costs:**
- Six code paths through the same query-translation logic means six places a bug can hide, and (as of this audit) zero automated tests cover any of them (see `docs/governance/FEATURE_STATUS.md`).
- New engineers need to know this pattern exists before they instinctively `npm install` a seventh database client for a "quick fix."

## Follow-up (see `docs/architecture/DATABASE_SCHEMA.md` for detail)

Only Firestore is confirmed as the actual production default. Formally mark the other five as "supported, contract-tested" (pick at least Postgres, since it's the one with a running service) vs. "supported, unverified" until each has test coverage.
