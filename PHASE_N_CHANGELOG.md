# PHASE N — SCALABILITY
## Geohash Spatial Indexing · Distributed Rate Limiting · Distributed Cost/Quota Counters

**Date:** June 2026
**Status:** COMPLETE (core correctness fixes — see "What Was Deliberately Left Alone" for documented future work)

---

## WHAT WAS BUILT

### New Files (4)

| File | Purpose |
|---|---|
| `src/lib/scalability/Geohash.ts` | Pure-function geohash encode/decode/neighbor/search-ring/distance — zero dependencies |
| `src/lib/scalability/RiderSpatialIndex.ts` | Replaces O(n) full-table rider scan with geohash 9-cell ring query |
| `src/lib/scalability/DistributedRateLimiter.ts` | Redis sorted-set sliding-window counter, atomic across all server instances |
| `src/lib/scalability/DistributedCounter.ts` | Redis `INCRBYFLOAT`-based atomic cumulative counters (spend, quotas) |

---

## THE CORE PROBLEM THIS PHASE FIXES

Phase B/E's own audit had already flagged two specific gaps in writing: the rider-matching algorithm does a full Haversine scan over every live rider on every single order assignment ("breaks at ~100 concurrent users"), and several modules track rate limits, AI spend, and tenant quotas in **process-local `Map` objects**. That second category is a correctness bug, not just a performance one: if Nexus OS is ever deployed behind a load balancer with more than one server instance, each instance has its own independent copy of "how many requests has this user made this minute" or "how much has this user spent on AI today." A user's traffic gets spread across instances, and **none of them individually ever see enough requests to trigger the limit** — the security/budget guard is silently bypassed by the very horizontal scaling that was supposed to make the system more robust.

This phase fixes both: a real spatial-indexing redesign for rider matching, and a real distributed-state redesign for every quota/rate-limit/spend Map that was previously instance-local.

---

## ARCHITECTURE

### 1. Geohash Spatial Index (rider matching)

```
Before (O(n) per assignment):
  findNearestRider(lat, lng)
    → getLiveRiders()  // fetches EVERY rider, regardless of distance
    → Haversine(pickup, rider) for ALL of them
    → sort, take min

After (Phase N):
  findNearestRider(lat, lng)
    → RiderSpatialIndex.findNearest(lat, lng)
        → Geohash.searchRing(lat, lng, precision=5)   // 9 cells, ~4.9km each
        → NexusDB.find('riders', { where: geohash IN [9 cells] })  // indexed query
        → Haversine only across the small candidate set inside the ring
        → sort, take min
    → falls back to legacy full-scan (findNearestRiderFullScan) if the
      spatial index import throws, or to a coarser 39km ring if the
      9-cell ring returns zero riders (sparse-area safety net)
```

Every rider GPS heartbeat write (`RiderLocationService._persistToFirestore`) now also writes `geohash` (precision 5, ~4.9km cells) and `geohashCoarse` (precision 4, ~39km cells) fields alongside the existing `lat`/`lng`. Pre-Phase-N rider documents without these fields are handled by the documented fallback path — `backfillExistingRiders()` is provided to migrate them in bulk, or they simply keep using the full-scan fallback indefinitely (correct, just not faster) until their next GPS update naturally adds the fields.

### 2. Distributed Rate Limiting

```
Before:                                    After:
  Map<string, number[]>                      Redis ZADD + ZREMRANGEBYSCORE + ZCARD
  (per server instance)                       (atomic pipeline, shared across
                                                ALL instances via SharedStateStore)
  Instance A: user X = 50 req/min            Instance A ─┐
  Instance B: user X = 50 req/min            Instance B ─┼─→ Redis: user X = 150 req/min
  Instance C: user X = 50 req/min            Instance C ─┘   (threshold correctly triggers)
  (load balancer spread 150 req/min          
   across 3 instances; threshold of 120       
   never triggers on ANY single instance)     
```

`DistributedRateLimiter.hit(key, windowMs)` uses a Redis sorted set per key: each call `ZADD`s the current timestamp with a unique member, `ZREMRANGEBYSCORE`s anything older than the window, and `ZCARD`s the remainder — all in one `MULTI` pipeline, so the count is exact and race-free regardless of which instance handles which request. Falls back to the original in-process sliding window when Redis isn't configured (matching `SharedStateStore`'s existing Redis→memory failover pattern from Phase A, so single-instance/dev behavior is unchanged).

### 3. Distributed Cumulative Counters

Same pattern, for running totals rather than sliding windows: `DistributedCounter.increment(key, amount, ttl)` uses Redis `INCRBYFLOAT` (atomic by definition — no read-modify-write race window at all, stronger than the sorted-set approach even).

---

## WHAT WAS MIGRATED

| Module | Before | After | Bug class fixed |
|---|---|---|---|
| `AnomalyDetectionEngine.checkRequestRate()` | in-process `requestTimestamps` Map | `DistributedRateLimiter` | Rate-limit bypass via load-balancer spread |
| `AnomalyDetectionEngine.recordFailedLogin()` / `clearFailedLogins()` | in-process `failedLoginAttempts` Map | `DistributedRateLimiter` | Brute-force detection bypass — an attacker hitting different instances could exceed the 8-attempts/15min threshold by up to (N instances ×) before being locked out |
| `AIProviderOrchestrator` budget guard | in-process `userSpend` Map | `DistributedCounter` | **Real financial risk**: a user load-balanced across N instances could spend up to N × `DAILY_COST_LIMIT` on AI calls before the cap was enforced anywhere |
| `TenantIsolation.usageTracker` | in-process `Map` (comment falsely claimed "Redis in Phase 4" — it was never actually wired up) | `DistributedCounter` | Tenant AI-call/order quota bypass, same class as above |
| `RiderLocationServer.findNearestRider()` | O(n) full Haversine scan | `RiderSpatialIndex` geohash ring query | Performance/scale ceiling (documented in Phase B/E as breaking at ~100 riders) |

**Newly wired enforcement:** `TenantIsolation.checkAIQuota()` was defined since the original security phase but **never actually called from any request path** — a dead quota check. Phase N wires it into the chat route (`server.ts`), so tenant AI-call quotas are now genuinely enforced, not just defined. `checkOrderQuota()` remains defined-but-uncalled — flagged below as a known gap, not in this phase's scope (it requires hooking into every order-creation path across Marketplace/admin routes, a larger change than this phase's focus).

---

## WHAT WAS DELIBERATELY LEFT ALONE (AND WHY)

Not every in-process `Map` in the codebase is a correctness bug. Many are pure local performance caches whose source of truth lives elsewhere (Firestore/NexusDB), making staleness safe — migrating them to Redis would add latency and complexity for no correctness benefit. Left unchanged in this phase:

- **`Embeddings.cache`, `AIProviderOrchestrator.latencyBuffers`, `BIEngine.cache`, `LocalModelAdapter.responseCache`** — read-heavy local caches with an async source of truth already in NexusDB/the provider APIs. Worst case on a cache miss across instances: one extra recomputation, never incorrect data.
- **`ProviderRegistry.providers` / `roleOverrides`** — provider configuration, loaded once at boot from env/config, not user-input-driven state. No cross-instance consistency requirement.
- **`ConversationMemory.SESSION_CACHE` / `PREFERENCE_CACHE`, `MemoryBrain.sessionSTM`** — short-term conversation caches backed by Firestore as source of truth (Phase C). An instance that hasn't seen a customer's latest message yet will reload from Firestore on next access; this is a minor latency cost, not a correctness bug, and migrating to Redis would meaningfully complicate the STM→LTM→KB pipeline for limited benefit.
- **`ToolRegistry.rateLimitState`** — tool-call rate limiting is lower-stakes than user/IP/tenant rate limiting (internal orchestration safety valve, not a user-facing security boundary) and was not flagged in any prior audit; left as a candidate for a future pass if tool abuse becomes a real incident.
- **`FraudDetectionEngine.recentOrdersByUser` / `recentOrdersByIP`** — order-velocity fraud signals. **Flagged here as a known follow-up**: this is the same bug class as the ones fixed in this phase (a fraudulent user spread across instances could place more rapid orders than the velocity check would normally allow before triggering). Not migrated in this pass because `FraudDetectionEngine` already has a much larger surface area (the Phase B audit treated it as a major standalone module) and deserves its own focused review rather than a drive-by Map swap; tracked as the top candidate for a Phase N.1 follow-up.
- **`SharedStateStore.memStore`, `TaskQueue.processingJobs/workers`, `NexusEventBus.subscriptions`, `AgentRegistry.agents`, `KnowledgeGraph.nodes/edges`** — these are either explicitly the documented in-process fallback tier of an existing distributed system (`SharedStateStore`), or genuinely process-local concerns by design (active job handles, event listeners, in-process agent instances) that don't have a meaningful "shared across instances" semantics to begin with.

---

## NEW FIRESTORE INDEXES

| Collection | Fields | Purpose |
|---|---|---|
| `riders` | `geohash` (ASC) | Spatial ring query for nearest-rider lookup |
| `riders` | `geohashCoarse` (ASC) | Sparse-area fallback ring (39km cells) |

No new Firestore *collections* were introduced — geohash data lives as new fields on the existing `riders` documents. No new environment variables either; Phase N reuses `REDIS_URL` from Phase A's `SharedStateStore`, with the same automatic in-process fallback when Redis isn't configured.

---

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `src/lib/delivery/RiderLocationService.ts` | GPS writes now include `geohash`/`geohashCoarse`; `findNearestRider()` delegates to `RiderSpatialIndex` with fallback to renamed `findNearestRiderFullScan()` (old logic preserved, not deleted) |
| `src/lib/core/SharedStateStore.ts` | New public `getRedisClient()` accessor so other modules can perform true atomic Redis operations (INCR, sorted sets) beyond the existing get/set pair |
| `src/lib/security/auth/AnomalyDetectionEngine.ts` | `checkRequestRate()` now async via `DistributedRateLimiter`; `recordFailedLogin()`/`clearFailedLogins()` migrated; in-process Maps removed |
| `src/lib/ai/providers/AIProviderOrchestrator.ts` | Budget check/write, `getSpendSummary()`, `resetDailySpend()` all migrated to `DistributedCounter`; `userSpend` Map removed |
| `src/lib/security/audit/TenantIsolation.ts` | `TenantUsageTracker` rewritten on `DistributedCounter`; `checkAIQuota()`/`checkOrderQuota()`/`getUsageStats()` now async |
| `server.ts` | `anomalyGuard` middleware made async; login route awaits `clearFailedLogins`; AI spend route awaits `getSpendSummary`; midnight cron awaits `resetDailySpend`; tenant usage route made async; **`checkAIQuota` newly wired into the chat route** (previously defined but never called) |
| `firestore.indexes.json` | 2 new indexes for `riders.geohash` / `riders.geohashCoarse` |

---

## VERIFICATION CHECKLIST

- [ ] Create 150 mock riders spread across a city, call `findNearestRider()` — confirm it returns the correct nearest rider without scanning all 150 (check logs/timing, not just correctness)
- [ ] Run `RiderSpatialIndex.backfillExistingRiders()` against pre-Phase-N rider documents lacking `geohash` — confirm they're updated and subsequent lookups use the indexed path
- [ ] Temporarily rename/break the `RiderSpatialIndex` import path — confirm `findNearestRider()` falls back to `findNearestRiderFullScan()` and order assignment still succeeds
- [ ] With `REDIS_URL` configured: open two server processes (simulating two instances), hammer requests for one user split across both — confirm the 429 anomalous-rate response triggers based on the COMBINED count, not each instance's local count
- [ ] With `REDIS_URL` configured: set `DAILY_COST_LIMIT` low, make AI calls from two simulated instances for the same user — confirm the budget cap is enforced correctly using the combined spend, not 2× the limit
- [ ] Trigger 8 failed logins for one identifier split across two instances within 15 minutes — confirm brute-force lockout triggers correctly
- [ ] `GET /api/admin/tenant/:tenantId/usage` returns correct combined `aiCalls`/`orders` counts when traffic was split across multiple instances
- [ ] Without `REDIS_URL` configured (single dev instance) — confirm all of the above still works via the in-process fallback paths (no regression for local development)
- [ ] Send chat requests until a tenant's daily AI quota is exceeded — confirm `429` response with the new quota-exceeded message (previously this check existed in code but was never reachable)
