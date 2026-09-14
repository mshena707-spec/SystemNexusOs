# Database Architecture

**Status of this document:** ✅ Describes real, verified code (`src/lib/database/NexusDB.ts`, 978 lines). This was previously undocumented — the pattern existed in code but nowhere in the 40+ markdown files did it have a reference doc. This file closes that gap.

## Why this doc exists

A new engineer (or an AI coding agent) opening this repo sees `pg`, `mongodb`, `@supabase/supabase-js`, `firebase`/`firebase-admin`, `better-sqlite3`, and `@libsql/client` all listed in `package.json`, plus a `postgres` service in `docker-compose.yml`. Without this doc, the natural — and wrong — conclusion is "this project can't decide on a database." The real answer is more specific and worth writing down once, here, instead of re-discovering it every time someone reads the code.

## The actual pattern: one interface, six pluggable backends

**Rule, enforced by comment in the source file itself:**
> Business logic must NEVER import from `firebase/firestore` or any database SDK directly. All DB access goes through NexusDB.

```
import { NexusDB } from '@/lib/database/NexusDB';

const order = await NexusDB.get('orders', orderId);
const id    = await NexusDB.add('orders', { ... });
await NexusDB.update('orders', id, { status: 'Delivered' });
const list  = await NexusDB.find('orders', {
  where: [{ field: 'userId', op: '==', value: uid }],
  orderBy: 'createdAt', orderDir: 'desc', limit: 20
});
```

This is a real Dependency Inversion implementation — the exact pattern CTO Audit Part 1 (section 7) asked for, already built, just not documented until now.

### Backend selection

Controlled entirely by the `DB_PROVIDER` environment variable (see `.env.example`):

| `DB_PROVIDER` value | Backend | Client library | Loaded via |
|---|---|---|---|
| `firestore` (default) | Google Cloud Firestore | `firebase` / `firebase-admin` | dynamic `import('../../firebase')` |
| `postgres` | PostgreSQL | `pg` (`Pool`) | dynamic `import('pg')`, line 267 |
| `supabase` | Supabase (Postgres-backed) | `@supabase/supabase-js` | dynamic `import('@supabase/supabase-js')`, line 432 |
| `mongodb` | MongoDB | `mongodb` (`MongoClient`) | dynamic `import('mongodb')`, line 522 |
| `turso` | Turso / libSQL (edge SQLite) | `@libsql/client` | dynamic `import('@libsql/client')`, line 777 |
| `sqlite` | Local SQLite file | `better-sqlite3` | dynamic `import('better-sqlite3')`, line 878 |
| `memory` | In-process object store | none | for tests / standalone runs |

Every backend implements the same `where`/`orderBy`/`limit` query shape — e.g. Postgres translates `where` clauses into parameterized SQL over JSON columns, MongoDB translates them into native filter operators (`$ne`, `$gt`, `$in`, ...). The abstraction is real, not cosmetic.

## What this means operationally

- **Only one backend is live in production at a time**, selected by `DB_PROVIDER`. The default is `firestore`, and `DEPLOYMENT.md` assumes Firestore (it lists "Firebase project with Firestore & Auth enabled" as a prerequisite). Treat Firestore as the supported production backend unless your deployment explicitly overrides `DB_PROVIDER`.
- **The other five backends are real code paths, not dead weight** — but because there is no automated test suite in this repo (see `docs/governance/FEATURE_STATUS.md`), nothing currently proves the Postgres/Mongo/Supabase/Turso/SQLite paths still work after a change to the shared query-translation logic. They can silently rot.
- **This is a genuine market advantage if maintained**: it means Nexus OS can be sold/deployed to a customer who requires Postgres for compliance reasons, or a customer who wants a zero-infra SQLite deployment for a small pilot, without a rewrite. That optionality is worth protecting deliberately rather than by accident.

## Recommendation (action item, not yet done)

1. Pick one **secondary** backend to actually keep tested (Postgres is the natural choice — it's the only one with a running service in `docker-compose.yml`). Add a minimal contract test that runs `NexusDB`'s core operations (`get`/`add`/`update`/`find`) against both Firestore-emulator and Postgres in CI.
2. Formally mark the rest (`supabase`, `mongodb`, `turso`, `sqlite`) as ⚪ *supported-but-unverified* in `docs/governance/FEATURE_STATUS.md` until they have equivalent coverage, rather than implying they're equally production-ready.
3. Resolve the two-Redis-client inconsistency noted in ADR-0003 — it's a smaller version of the same problem (two libraries doing the same job, only one exercised by tests-that-don't-exist-yet).

See `docs/adr/0001-pluggable-multi-backend-database-layer.md` and `docs/adr/0002-firestore-as-default-database-provider.md` for the decision record.
