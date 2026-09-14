# PHASE E — DATABASE INDEPENDENCE
## NexusDB Abstraction Layer — Firestore, PostgreSQL, Supabase, MongoDB

**Date:** June 2026
**Status:** ABSTRACTION LAYER COMPLETE — INCREMENTAL MIGRATION IN PROGRESS

---

## WHAT WAS BUILT

### New Files (5)

| File | Purpose |
|---|---|
| `src/lib/database/NexusDB.ts` | Single entry point — 5 adapters (Firestore, PostgreSQL, Supabase, MongoDB, InMemory) with auto-failover |
| `src/lib/database/MigrationTool.ts` | Copies all collections between providers, with parity verification |
| `src/lib/database/repositories/OrderRepository.ts` | Order data access — zero Firestore imports |
| `src/lib/database/repositories/ProductRepository.ts` | Product data access — zero Firestore imports |
| `src/lib/database/repositories/UserRepository.ts` | User/profile data access — zero Firestore imports |
| `src/components/admin/DatabaseProviderApp.tsx` | Admin UI — status, provider list, migration tool, parity verification |

---

## ARCHITECTURE

```
                    ┌─────────────────────────┐
                    │   Business Logic Code    │
                    │  (repositories, engines)  │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │         NexusDB           │  ← SINGLE ENTRY POINT
                    │  .get() .add() .set()     │
                    │  .update() .delete()      │
                    │  .find() .batch()         │
                    └────────────┬─────────────┘
                                 │
              DB_PROVIDER env var selects adapter
                                 │
        ┌───────────┬───────────┼───────────┬───────────┐
        ▼           ▼           ▼           ▼           ▼
   ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │Firestore│ │PostgreSQL│ │Supabase │ │ MongoDB │ │InMemory │
   │(default)│ │   (pg)   │ │(REST API)│ │(driver) │ │(testing)│
   └─────────┘ └──────────┘ └─────────┘ └─────────┘ └─────────┘
```

---

## HOW SWITCHING WORKS

```bash
# Switch from Firestore to PostgreSQL — zero code changes
DB_PROVIDER=postgres
POSTGRES_URL=postgresql://user:pass@host:5432/nexus
```

On next server start:
1. `NexusDB.initialize()` reads `DB_PROVIDER`
2. Connects `PostgreSQLAdapter`, auto-creates `nexus_documents` table (generic JSONB store)
3. Registers `FirestoreAdapter` as automatic fallback
4. If PostgreSQL goes down mid-operation → `NexusDB` auto-fails-over to Firestore, logs warning

**All `NexusDB.get/add/set/update/delete/find/batch` calls work identically regardless of provider.**

---

## ADAPTER IMPLEMENTATION DETAIL

### FirestoreAdapter (default)
- Wraps existing `firebase/firestore` SDK calls
- `find()` translates `WhereClause[]` → Firestore `where()` constraints
- `batch()` uses native `writeBatch()`

### PostgreSQLAdapter
- Generic `nexus_documents` table: `(collection TEXT, id TEXT, data JSONB, created_at, updated_at)`
- Auto-creates table + GIN index on `data` on first connect
- `find()` translates `WhereClause[]` → `data->>'field' = $1` JSONB queries
- `set(merge=true)` uses `data || $jsonb` for partial updates
- `batch()` wrapped in `BEGIN`/`COMMIT`/`ROLLBACK` transaction

### SupabaseAdapter
- Same `nexus_documents` table pattern via Supabase REST client
- Uses `@supabase/supabase-js` with service role key (server-side only)

### MongoDBAdapter
- Native collections — `_id` mapped to NexusDB's `id` field
- `batch()` wrapped in MongoDB transaction session
- Full operator support: `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`

### InMemoryAdapter
- Pure JS `Map<collection, Map<id, doc>>`
- Used for `DB_PROVIDER=memory` (testing/standalone mode)
- Implements full `WhereClause` filtering and sorting in-process

---

## REPOSITORIES (NEW PATTERN FOR ALL FUTURE CODE)

```typescript
// ❌ OLD (Firestore-locked):
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
const snap = await getDocs(query(collection(db, 'orders'), where('userId', '==', uid)));

// ✅ NEW (Phase E — provider-agnostic):
import { OrderRepository } from '@/lib/database/repositories/OrderRepository';
const orders = await OrderRepository.findByUser(uid);
```

Three repositories ship with Phase E: `OrderRepository`, `ProductRepository`, `UserRepository`.
Additional repositories follow the same pattern — wrap `NexusDB.find/get/add/update/delete/batch`.

---

## MIGRATED IN THIS PHASE

| File | Change |
|---|---|
| `src/lib/delivery/RiderLocationService.ts` | `assignOrder()` now uses `NexusDB.batch()` instead of direct `firebase/firestore` `writeBatch` — flagship demonstration of the pattern on the most business-critical write path (rider dispatch) |
| `src/lib/core/health/HealthMonitor.ts` | New `checkNexusDB()` health check reports active provider + latency; added to `/api/health` |

---

## MIGRATION PLAYBOOK FOR REMAINING 44 FILES

**Current state:** 496 direct Firestore call sites across 45 files. Migrating all of them in one pass risks breaking working production code. Phase E ships the abstraction layer + tooling + the pattern proven on the highest-risk path (order assignment). Remaining files migrate incrementally, file-by-file, using this checklist:

### Step-by-step for each file:
1. Identify all `collection(db, 'X')`, `doc(db, 'X', id)` calls
2. Map each to `NexusDB.find/get/add/set/update/delete/batch`
3. Replace `where('field', '==', value)` → `{ field, op: '==', value }`
4. Replace `orderBy('field', 'desc')` → `{ orderBy: 'field', orderDir: 'desc' }`
5. Replace `serverTimestamp()` calls — `NexusDB` adapters handle timestamps internally on write
6. Test against `DB_PROVIDER=memory` first (fast, no external deps)
7. Test against `DB_PROVIDER=firestore` (regression check — must match old behavior)

### Priority order (by business risk, highest first):
1. ✅ `RiderLocationService.ts` (assignOrder) — DONE
2. `OrderManagerApp.tsx` — order status updates (admin-facing, high write volume)
3. `Marketplace.tsx` — order creation, checkout (customer-facing, revenue path)
4. `PaymentRoutes.ts` — payment status writes (financial integrity)
5. `OrderBatchingEngine.ts` — batch writes (Phase B)
6. `DeliveryTimeline.ts` — immutable event log (Phase B)
7. `SLAMonitor.ts` — alert writes (Phase B)
8. `MemoryBrain.ts` / `ConversationMemory.ts` — memory writes (Phase C)
9. Remaining admin dashboards (read-only, lower risk — can stay on Firestore SDK longer)

### Read-heavy admin dashboards (FleetManagerApp, AnalyticsDashboardApp, etc.)
These use `onSnapshot()` for real-time UI updates. `NexusDB` does not yet expose a real-time subscription API (Phase E scope: CRUD + find). These components can remain on direct Firestore `onSnapshot` for now — when `DB_PROVIDER != firestore`, real-time updates degrade to polling (acceptable for admin dashboards, not for core business writes).

**Future Phase E.1 (optional):** Add `NexusDB.subscribe(collection, options, callback)` with Firestore `onSnapshot` / PostgreSQL `LISTEN/NOTIFY` / MongoDB Change Streams / Supabase Realtime — unifying real-time too.

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/db/status` | GET | Admin | Active provider + health + latency |
| `GET /api/admin/db/providers` | GET | Admin | List all providers + configuration status |
| `POST /api/admin/db/migrate` | POST | Admin | Copy all/selected collections between providers |
| `POST /api/admin/db/verify` | POST | Admin | Compare document counts between providers |

---

## NEW DEPENDENCIES

```json
"pg": "^8.12.0"               // already present
"mongodb": "^6.10.0"          // NEW
"@supabase/supabase-js": "^2.45.4"  // NEW
```

---

## NEW ENVIRONMENT VARIABLES

```bash
# Choose primary database: firestore | postgres | supabase | mongodb | memory
DB_PROVIDER="firestore"

# PostgreSQL
POSTGRES_URL="postgresql://user:password@localhost:5432/nexus"

# Supabase
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""

# MongoDB
MONGODB_URI=""
MONGODB_DB="nexus"
```

---

## VENDOR LOCK-IN STATUS (BEFORE vs AFTER)

| Aspect | Before Phase E | After Phase E |
|---|---|---|
| New code DB calls | Direct `firebase/firestore` imports | `NexusDB` / repositories |
| Switching providers | Rewrite every file (months) | Set `DB_PROVIDER` env var (minutes, for migrated paths) |
| Order assignment (highest-risk path) | Firestore-locked | Provider-agnostic ✅ |
| Health monitoring | Firestore-only | Reports active `NexusDB` provider |
| Data portability | None | `MigrationTool` copies + verifies any provider → any provider |
| Remaining legacy files | 45 files / 496 call sites | 44 files / ~490 call sites (incremental) |

---

## VERIFICATION CHECKLIST

- [ ] `DB_PROVIDER=memory npm run dev` → server starts, `NexusDB.healthCheck()` returns `{ provider: 'InMemory', healthy: true }`
- [ ] `GET /api/admin/db/status` → shows active provider
- [ ] `GET /api/admin/db/providers` → lists 5 providers with configuration status
- [ ] Set `POSTGRES_URL`, `DB_PROVIDER=postgres` → server connects, `nexus_documents` table auto-created
- [ ] `POST /api/admin/db/migrate { source: "firestore", destination: "postgres" }` → copies data, returns report
- [ ] `POST /api/admin/db/verify { source: "firestore", destination: "postgres" }` → document counts match
- [ ] Place an order → `RiderLocationService.assignOrder()` writes via `NexusDB.batch()` — works on any configured provider
- [ ] `GET /api/health` → includes "Primary Database (NexusDB) [ProviderName]" check
