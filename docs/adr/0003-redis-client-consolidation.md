# ADR-0003: Consolidate on one Redis client library

Status: Proposed (not yet decided or actioned)
Date: 2026-07-18

## Context

Two different npm packages talk to the same Redis instance:
- `redis` (node-redis, `createClient()` pattern) — used in `NexusDB.ts`, `NexusCache.ts`, `RedisTaskQueue.ts`, `NexusWebSocket.ts`, `SecurityMiddleware.ts` (5 files).
- `ioredis` (`new Redis()` pattern) — used in `SharedStateStore.ts` (1 file).

Both are real, working usages — this isn't dead code on either side. It's two libraries doing the same job because they were likely introduced at different times (`SharedStateStore.ts` reads like a later, separate addition) without anyone consolidating afterward. This is a smaller-scale version of the same pattern as the duplicate task queues (see `docs/architecture/SCALING_GUIDE.md`) — a real, recurring signature of this codebase's iterative, multi-session build history worth naming once here so it's watched for elsewhere too.

## Decision (proposed)

Standardize on **`ioredis`** going forward: it has broader adoption in the Node ecosystem for exactly the clustering/failover scenarios `DistributedCounter`/`DistributedRateLimiter` (`scalability/`) are built for, and its API surface is a closer match to what those modules likely need as usage grows. Migrate the 5 `redis`-package usages to `ioredis` opportunistically (next time each file is touched), not as an urgent dedicated sprint — both work correctly today.

## Consequences

**Easier:** one Redis connection-handling pattern to reason about, one library's failure modes to learn instead of two, smaller `node_modules`.

**Harder / cost:** the migration itself touches 5 files that are currently working — do it with the same care as any refactor of working code (see `CONTRIBUTING.md` testing rules), not as a drive-by change.

## Status

Left as **Proposed**, not **Accepted** — this is a judgment call (either library is defensible) that the project owner should confirm before it's treated as settled.
