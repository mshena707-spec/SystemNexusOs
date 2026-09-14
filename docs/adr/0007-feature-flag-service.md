# ADR-0007: Persistent feature flag service

Status: Accepted
Date: 2026-07-18

## Context

CTO Audit Part 2, section 8, said "I did not find the Feature Flag System." A file matching that description did exist (`src/lib/core/FeatureFlagManager.ts`), but investigation found it was dead code in substance: a 20-line in-memory `Map` with 3 hardcoded flags, zero importers anywhere in the codebase, no persistence (resets every restart), and no cross-instance sharing (would silently diverge across a horizontally-scaled deployment — see `docs/architecture/SCALING_GUIDE.md`). The audit's underlying concern was correct even though a file technically existed.

## Decision

Replace it with `FeatureFlags` (`src/lib/core/flags/FeatureFlags.ts`), persisted via `NexusDB` (works across every `DB_PROVIDER` backend per `docs/adr/0001`), with a synchronous in-memory read path (`isEnabled()` must never block a hot path on a DB round-trip — load once at boot) and an async write path (`set()`) that emits `system.config.changed` on `NexusEventBus` so listeners react immediately instead of polling. Ships with the 5 flags the audit named (`ENABLE_LOCAL_AI`, `ENABLE_BACKUP_AGENT`, `ENABLE_SUPERVISOR`, `ENABLE_MARKETING_AI`, `ENABLE_MEMORY_V2`) plus the 3 real ones carried over from the old stub, plus one (`ENABLE_LOYALTY_ADVISOR`) gating the new example plugin (`docs/adr/0008`).

The old `FeatureFlagManager.ts` is left in place with a `@deprecated` notice rather than deleted, in case something outside this audited snapshot still references it.

## Consequences

**Easier:** a flag flip now survives a restart and is shared across every instance; new flags are declared in one place (`KNOWN_FLAGS`) that doubles as documentation of every kill-switch that exists; the plugin architecture (ADR-0008) depends on this being real, not a stub.

**Harder / cost:** every flag check now has a (cheap, in-memory-cached) dependency on `FeatureFlags.load()` having run at boot — if it hasn't, `isEnabled()` logs a warning and falls back to compiled-in defaults rather than throwing, so a missed `load()` call degrades gracefully instead of crashing.

## Verification

Confirmed to type-check cleanly against the real TypeScript compiler, including a genuine bug caught and fixed in the process — an initial version called `NexusDB.find<T>()` with a generic type argument, but `NexusDB.find()` isn't generic (it returns `Record<string, any>[]`); fixed to cast instead.
