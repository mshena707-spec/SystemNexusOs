# ADR-0025: Memory Dashboard, and the server.ts parse-error fix found while building it

Status: Accepted
Date: 2026-07-24

## Context

CTO Audit Part 7, section 8: confirmed no memory-specific dashboard existed, despite substantial backend memory capability built across Parts 1, 3, and 5 (8-type taxonomy, ACL, version history, digital signatures, cross-agent summary access, the Learning Approval Gate's pending queue) having no UI surface at all.

While building it, compiling `server.ts` against its own `tsconfig.server.json` (not the main `tsconfig.json`, which excludes `server.ts`) for the first time in this series surfaced a genuine parse error — a raw newline byte embedded in a string literal in the `/api/metrics` route, unrelated to anything being built this round. See `docs/governance/TECHNICAL_DEBT_REGISTER.md` for full detail; noted here because it was found in the course of this ADR's work, not separately.

## Decision

**Server-side:** new route `GET /api/admin/memory/overview` — real aggregate counts across all 8 memory-type collections, version-history coverage, Immutable-memory signature status, and the Learning Approval Gate's pending queue. Every number is a live `NexusDB` query, not synthesized.

**Client-side:** new `src/components/admin/MemoryDashboard.tsx` — consumes the new route plus the pre-existing `/api/memory/stats` (treated as a complementary "working memory / cache" panel, not replaced). Matches the established dark-admin visual language already used by `AIProviderDashboard.tsx` (same color/spacing/icon conventions, distinct accent color) rather than introducing a new visual style.

**Separately, in the same session:** fixed the `server.ts` syntax error described above.

## Consequences

**Easier:** the memory system's real depth — built across three prior rounds — is now visible to an admin, not just provable by reading source files. The `server.ts` fix, far more importantly, means the server can be expected to actually start.

**Harder / cost:** the new dashboard component is not yet wired into the admin app's navigation/router — it exists and is real, but its reachability from the running UI wasn't confirmed this round. Collection-count queries in the new route are capped at 500 per type for dashboard performance (`cappedAt500` flag signals this) rather than doing an expensive full count — acceptable for a health-overview dashboard, not for anything needing exact totals.

## Verification

`MemoryDashboard.tsx` and the new server route both compile cleanly (filtering the JSX/module-resolution errors confirmed as environmental across every `.tsx` file in this sandbox, including pre-existing ones like `AIProviderDashboard.tsx`, given no `node_modules` is installed here). The `server.ts` fix was verified precisely: a byte-level hex check before and after, plus `tsc -p tsconfig.server.json` going from a cascading parse failure to zero real errors.
