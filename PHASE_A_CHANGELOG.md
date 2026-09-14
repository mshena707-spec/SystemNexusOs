# PHASE A — PRODUCTION READINESS COMPLETION
## Remove All Mocks & Simulations

**Date:** June 2026
**Status:** COMPLETE

---

## MOCKS REMOVED — 12 Total

### 1. `sharedMemory` In-Process Object → `SharedStateStore`
**File changed:** `server.ts`
**New file:** `src/lib/core/SharedStateStore.ts`
**Why it existed:** Convenience during development — all state in one JS object.
**Problem:** Single-process only. Multi-instance deployment causes split-brain: each instance has its own `pendingApprovals`, `riderStatus`, `apiLogs`. Load balancer breaks everything.
**Replacement:** `SharedStateStore` — Redis (primary) → Firestore (fallback) → in-memory (dev). All instances share the same state. Key-namespaced by `DEPLOY_ID`.

---

### 2. Fake GPS `{ x, y }` Random Drift → Real `navigator.geolocation`
**File changed:** `src/pages/RiderDashboard.tsx`
**New file:** `src/lib/delivery/RiderLocationService.ts`
**Why it existed:** GPS requires device permission and real coordinates. `{ x, y }` was a placeholder.
**Problem:** Not usable by real riders. `x/y` in pixels has no geographic meaning.
**Replacement:**
- `RiderGpsClient` — `watchPosition()` with `enableHighAccuracy: true` + 10s heartbeat fallback
- Writes real `{ lat, lng, accuracy, heading, speed }` to Firestore `riders/{uid}` + `rider_breadcrumbs`
- `RiderLocationServer.findNearestRider()` — Haversine distance formula for real dispatch
- `RiderLocationServer.getRouteReplay()` — Ordered breadcrumb history per order

---

### 3. Random Order Assignment (`setTimeout` + `Math.random`) → Real Firestore Listener
**File changed:** `src/pages/RiderDashboard.tsx`
**Why it existed:** No real dispatch system existed.
**Problem:** Generated fake order IDs that don't correspond to real Firestore orders. Riders never received real deliveries.
**Replacement:** `onSnapshot` on `orders` WHERE `riderId == user.uid AND status == 'Assigned'`. Real orders from server-side `RiderLocationServer.assignOrder()`.

---

### 4. Random Traffic in Route Optimization → Real GPS Coordinates
**File changed:** `src/pages/RiderDashboard.tsx`
**Why it existed:** No real GPS coordinates available (because GPS was also fake).
**Problem:** AI received made-up traffic strings. Output was meaningless.
**Replacement:** Real `location.lat/lng` from device fed into AI prompt. Result is now geographically grounded.

---

### 5. Deprecated FCM Legacy API → Firebase Admin SDK v12
**File changed:** `src/lib/notifications/NotificationEngine.ts`
**Why it existed:** Legacy `fcm.googleapis.com/fcm/send` was the only FCM API until 2023.
**Problem:** Shut down by Google in June 2024. All push notifications silently fail.
**Replacement:** Firebase Admin SDK `messaging.send()` using service account JSON. Includes stale token cleanup. Falls back to in-app Firestore notification when FCM token missing.

---

### 6. BKash Redirect to Dead Route → Real bKash PGW v1.2.0-beta
**New files:** `src/lib/payments/BkashAdapter.ts`, `src/lib/payments/PaymentRoutes.ts`
**Why it existed:** `/payment/bkash?orderId=...` redirect was written as a TODO placeholder.
**Problem:** No route existed in `server.ts`. All bKash payments silently failed with 404.
**Replacement:** Full tokenized checkout flow:
1. `POST /api/payment/bkash/create` → gets `bkashURL` from bKash API
2. User redirected to bKash checkout page
3. `GET /api/payment/bkash/callback` → executes payment, updates Firestore `orders` + `payments`

---

### 7. Nagad Redirect to Dead Route → Real Nagad Merchant Direct API
**New files:** `src/lib/payments/NagadAdapter.ts`, `src/lib/payments/PaymentRoutes.ts`
**Same pattern as BKash.** RSA-signed API calls to Nagad sandbox/production.

---

### 8. Stripe Refund (Missing) → Real `stripe.refunds.create()`
**New route:** `POST /api/payment/stripe/refund` in `PaymentRoutes.ts`
**Why it existed:** Refunds were never implemented.
**Replacement:** Fetches Stripe session → payment intent → creates refund. Updates Firestore `payments` and `orders` status.

---

### 9. Random Fleet Alerts (`Math.random() > 0.7`) → Real Firestore Order Events
**File changed:** `src/components/admin/FleetManagerApp.tsx`
**Why it existed:** No real SLA monitoring. Fake alerts made the UI look "live".
**Problem:** Random alerts have no relation to real orders. Fleet managers can't act on fake data.
**Replacement:** `onSnapshot` on `orders` from last 1 hour. Fires alert when: (a) order > 45 min old and not delivered (SLA breach), or (b) new order without rider assigned.

---

### 10. Hardcoded API Usage Chart → Real `SharedStateStore.getApiLogs()`
**File changed:** `src/components/admin/AnalyticsDashboardApp.tsx`
**New route:** `GET /api/admin/api-usage-by-day`
**Why it existed:** Static Monday–Sunday dummy data in component.
**Replacement:** Real API log entries from `SharedStateStore`, grouped by date string.

---

### 11. Random Token/Cost in TokenAnalyticsApp → Real Prometheus Metrics
**File changed:** `src/components/admin/TokenAnalyticsApp.tsx`
**Why it existed:** No token tracking existed. Random numbers gave the appearance of data.
**Replacement:** Fetches `/api/metrics` (Prometheus text format). Parses `nexus_ai_tokens_total{role=...}` and `nexus_ai_cost_usd_total{role=...}` counters that are incremented per-request in `server.ts`.

---

### 12. Random Embedding Fallbacks → Explicit `null` (Caller Handles)
**Files changed:** `src/lib/core/adapters/HuggingFaceAdapter.ts`, `GemmaOfflineAdapter.ts`, `LocalAIAdapter.ts`
**Why it existed:** `new Array(768).fill(Math.random())` was used as a fallback when embedding APIs fail.
**Problem:** Random 768-dimensional vectors have zero semantic meaning. Vector search using them returns garbage results silently.
**Replacement:** Returns `null`. Callers in `NexusMemoryEngine` and `VectorStore` must handle null gracefully (skip vector indexing, use text search fallback).

---

## NEW FILES ADDED

| File | Purpose |
|---|---|
| `src/lib/core/SharedStateStore.ts` | Distributed state: Redis → Firestore → in-memory |
| `src/lib/delivery/RiderLocationService.ts` | Real GPS client + server dispatch + route replay |
| `src/lib/notifications/NotificationEngine.ts` | Firebase Admin SDK FCM + Twilio SMS |
| `src/lib/payments/BkashAdapter.ts` | bKash PGW v1.2.0-beta tokenized checkout |
| `src/lib/payments/NagadAdapter.ts` | Nagad Merchant Direct API with RSA signing |
| `src/lib/payments/PaymentRoutes.ts` | Express router for BKash, Nagad, Stripe refund |

## EXISTING FILES MODIFIED

| File | Change |
|---|---|
| `server.ts` | Replaced `sharedMemory` with `SharedStateStore`; added payment routes, delivery routes, API usage route, token counters |
| `src/pages/RiderDashboard.tsx` | Real GPS, real order listener, real coordinates in AI prompt |
| `src/components/admin/FleetManagerApp.tsx` | Real Firestore order alerts |
| `src/components/admin/AnalyticsDashboardApp.tsx` | Real API usage from server |
| `src/components/admin/TokenAnalyticsApp.tsx` | Real Prometheus token metrics |
| `src/components/admin/NerveCenterApp.tsx` | Real `/api/health` poll |
| `src/apps/control-center/apps/SystemLogsPanel.tsx` | Real `/api/admin/logs` fetch |
| `src/components/admin/ProductManagerApp.tsx` | Deterministic 3D render progress |
| `src/components/admin/DatabaseManagerApp.tsx` | Deterministic compression test data |
| `src/pages/Marketplace.tsx` | Real product ratings from Firestore |
| `src/lib/core/adapters/HuggingFaceAdapter.ts` | Null instead of random embeddings |
| `src/lib/core/adapters/GemmaOfflineAdapter.ts` | Null instead of random embeddings |
| `src/lib/core/adapters/LocalAIAdapter.ts` | Null instead of random embeddings |
| `firestore.rules` | Added `shared_state`, `rider_breadcrumbs`, `payments` rules |
| `firestore.indexes.json` | Added indexes for `rider_breadcrumbs`, `riders.lastSeen` |
| `.env.example` | Added `FIREBASE_SERVICE_ACCOUNT_JSON`, `BKASH_*`, `NAGAD_*`, `DEPLOY_ID` |
| `package.json` | Added `firebase-admin: ^12.3.0` |

## NEW API ENDPOINTS

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/payment/bkash/create` | POST | Initiate bKash checkout |
| `/api/payment/bkash/callback` | GET | bKash redirect callback |
| `/api/payment/nagad/create` | POST | Initiate Nagad payment |
| `/api/payment/nagad/callback` | GET | Nagad redirect callback |
| `/api/payment/stripe/refund` | POST | Issue Stripe refund |
| `/api/delivery/assign` | POST | Assign nearest rider to order |
| `/api/delivery/riders/live` | GET | Live rider GPS positions |
| `/api/delivery/route-replay/:orderId` | GET | Breadcrumb history for order |
| `/api/admin/api-usage-by-day` | GET | API call counts grouped by date |
| `/api/admin/logs` | GET | Real server log stream |

## REQUIRED ENVIRONMENT VARIABLES (NEW)

```
# Firebase Admin (replaces FIREBASE_SERVER_KEY)
FIREBASE_SERVICE_ACCOUNT_JSON=<base64-encoded service account JSON>

# bKash
BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta
BKASH_APP_KEY=
BKASH_APP_SECRET=
BKASH_USERNAME=
BKASH_PASSWORD=

# Nagad
NAGAD_BASE_URL=http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0
NAGAD_MERCHANT_ID=
NAGAD_MERCHANT_NUMBER=
NAGAD_PUBLIC_KEY=
NAGAD_PRIVATE_KEY=

# Distributed state key namespace
DEPLOY_ID=nexus-prod
```

## VERIFICATION CHECKLIST

- [ ] `npm install` (adds `firebase-admin`)
- [ ] Set `FIREBASE_SERVICE_ACCOUNT_JSON` — push notifications work
- [ ] Set `BKASH_*` — bKash checkout appears and completes
- [ ] Set `NAGAD_*` — Nagad checkout appears and completes
- [ ] Set `REDIS_URL` — distributed state uses Redis (multi-instance safe)
- [ ] Open rider dashboard on mobile — browser requests GPS permission
- [ ] Accept GPS permission — coordinates appear in Firestore `riders` collection
- [ ] Place order — `POST /api/delivery/assign` assigns nearest rider
- [ ] Admin Fleet view — alerts fire from real delayed orders
- [ ] Analytics dashboard — API usage chart shows real counts
