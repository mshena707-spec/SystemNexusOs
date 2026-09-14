# Scaling Guide

**Status of this document:** ✅ Generated from real code (`src/lib/scalability/`, `src/lib/queue/`, `src/lib/realtime/NexusWebSocket.ts`, `docker-compose.yml`). Status of the underlying capability: 🟡 Beta — real primitives exist; one concrete duplication needs resolving (below).

## Why this doc exists

"Can this handle growth" is a question investors and enterprise customers will ask directly. This doc is the honest, evidence-based answer as of this audit, plus the one fix that matters most.

## What exists

| Component | Lines | Purpose |
|---|---|---|
| `scalability/DistributedCounter.ts` | 131 | Counters safe across multiple server instances (e.g., inventory decrements) |
| `scalability/DistributedRateLimiter.ts` | 100 | Rate limiting that works across instances, not just per-process |
| `scalability/Geohash.ts` | 107 | Geospatial indexing primitive |
| `scalability/RiderSpatialIndex.ts` | 155 | Uses Geohash to find nearby delivery riders efficiently — real, domain-specific engineering for the logistics side of the product |
| `realtime/NexusWebSocket.ts` (Redis adapter) | — | Graceful upgrade path: single-instance in-memory WebSocket by default, auto-upgrades to Redis-backed horizontal scaling when `REDIS_URL` or `UPSTASH_REDIS_URL` is set. **This is genuinely good engineering** — it works with zero config for a solo developer and scales out without a rewrite when traffic requires it. |
| `docker-compose.yml` healthchecks | 4 | Prerequisite for automated recovery under load |

`RiderSpatialIndex.ts` in particular is worth highlighting outside this doc too (e.g., in investor materials) — geospatial rider-matching is a real, non-trivial capability that's specific to logistics/delivery businesses, not a generic CRUD feature.

## One concrete issue found: two task queues, both actually live

**Correction (added during CTO Audit Part 2 response):** this section originally reported `RedisTaskQueue.ts` as having "0 files found this round" importing it, and read that as likely-abandoned. That was wrong — the grep used at the time didn't account for a renamed import binding. `server.ts` imports it directly (`import { taskQueue as redisTaskQueue } from "./src/lib/queue/RedisTaskQueue"`) and uses it for real: registering `send_notification`, `csat_request`, `learning_record`, and `financial_report` workers, starting concurrent workers across three named queues, and scheduling real delayed jobs (a CSAT request 30 minutes after delivery). See `docs/governance/TECHNICAL_DEBT_REGISTER.md` for the corrected, fuller finding — including a boot-blocking bug found and fixed in this file (a broken logger import) and the specific job-type overlap between the two queue systems. The recommendation below is superseded by that document; kept here, struck through in spirit, so the correction is traceable rather than silently overwritten.

Two separate, non-trivial task queue implementations exist, **both actively used, for different (and one overlapping) job type**:

- **`queue/TaskQueue.ts`** (405 lines) — its own header claims Redis Streams as primary storage, in-process Map as fallback.
- **`queue/RedisTaskQueue.ts`** (340 lines) — its header explicitly frames itself as replacing `TaskQueue.ts`'s in-memory Map with Redis Lists, and separately implements priority handling, dead-letter queues, and scheduled jobs.

Import check: `TaskQueue.ts` is imported in 1 file; `RedisTaskQueue.ts` is imported in 0 files found this round (it exists and is wired to `NexusEventBus`, but nothing in the sampled code currently constructs/uses it). This is the clearest concrete example in the whole codebase of the CTO Audit's core Part 1 finding — two real, well-built implementations of the same job, built at different points, neither one deprecated, and no note anywhere saying which one is current. This is exactly what "Documentation Consistency" (audit section 4) is warning about, just found in code instead of docs.

**This matters for scaling specifically** because if `RedisTaskQueue.ts` (the more explicitly distributed-by-design one) isn't actually the one in use, then whatever currently processes async work may not survive a multi-instance deployment the way the docs would imply.

## Recommendation

1. **~~Resolve the queue duplication first, pick one, delete the other~~ — superseded.** Both are live in production (see the correction above); deleting either would break real functionality. See `docs/governance/TECHNICAL_DEBT_REGISTER.md` for the corrected recommendation: assign job-type ownership per system (which types belong to `TaskQueue`, which to `RedisTaskQueue`), fix the specific overlap on `send_notification`, and fix the two broken `NotificationEngine` method calls found in `TaskQueue.ts` while you're in there.
2. **Confirm `REDIS_URL` is actually set in the production environment**, not just supported in code — several components (`NexusWebSocket`, the task queue, `DistributedRateLimiter`) silently degrade to single-instance behavior without it. A silent degradation is worse than a loud failure here, because everything *looks* fine until you scale to a second instance and state stops being shared.
3. **Horizontal scaling readiness, by component:**

   | Component | Multi-instance safe? |
   |---|---|
   | WebSockets | ✅ Yes, if `REDIS_URL` set |
   | Rate limiting | ✅ Yes (`DistributedRateLimiter`) |
   | Counters (inventory, etc.) | ✅ Yes (`DistributedCounter`) |
   | Task queue | 🟡 Depends which implementation is actually active (see above) |
   | Database | Depends entirely on `DB_PROVIDER` — Firestore/Supabase/Postgres are natively multi-instance safe; `sqlite`/`memory` providers are explicitly single-instance (see `DATABASE_SCHEMA.md`) |

4. Add Prometheus/Grafana dashboards (both already run in `docker-compose.yml`) tracking queue depth and dead-letter count specifically — that's the earliest, clearest signal of a scaling problem before it becomes an outage.
