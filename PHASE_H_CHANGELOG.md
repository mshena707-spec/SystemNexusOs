# PHASE H — OWNER GOD MODE / BUSINESS COMMAND CENTER
## Real Emergency Shutdown Enforcement · Real Command Center Data · Real Data Export

**Date:** June 2026
**Status:** COMPLETE — this phase is primarily a REMEDIATION, not new construction

---

## WHAT THIS PHASE ACTUALLY WAS

Before writing any new code, the codebase was audited for existing "owner control" / "command center" infrastructure, since building a third competing dashboard on top of two already-half-built ones would have been wasteful and confusing. Two files already existed:

- `src/lib/control/OwnerControlEngine.ts`
- `src/components/admin/OwnerControlPanel.tsx`
- `src/components/admin/NerveCenterApp.tsx` (a separate, mostly-legitimate environment/health panel)

**`OwnerControlEngine` was almost entirely decorative:**
- `emergencyShutdownEngaged` was an in-process `boolean`. It did not persist across a restart, did not work across multiple server instances (exactly the class of bug fixed for other modules in Phase N), and — critically — **nothing in `server.ts` ever read it**. The "Emergency Kill Switch" button in the admin UI toggled a value that gated zero requests.
- `getOverrideStatus()` always returned `'none'` — the code comment literally said "Implementation for dynamic manual overrides from DB/Memory" where the implementation should have been.
- `blockUnauthorizedMutation()` always returned `false` regardless of its arguments — a no-op disguised as an access-control check.
- `exportTenantData()` returned hardcoded empty arrays (`conversations: []`, `memoryStore: []`) — a "data export" that exported nothing, despite logging a success message claiming "Zero Vendor Lock-in achieved."

**`OwnerControlPanel.tsx` was UI theater on top of that:**
- A hardcoded list of 4 fake agent names (`Owner AI`, `System AI`, `Customer AI`, `Security AI`) that don't correspond to anything in the real `AgentRegistry`/`SupervisorAgent` architecture used elsewhere in the codebase, each permanently displaying a green "ONLINE" badge regardless of actual system state.
- A static "Live Intercept Stream" panel with three made-up log lines that never changed, no connection to any real log source.
- A "VIEW FULL TRACE" button with no click handler.
- An "AI Decision Trace" panel showing a hardcoded fabricated confidence score (`0.92`) on a static "ExplanabilityEngine" line that doesn't query anything.

**`NerveCenterApp.tsx` was mostly legitimate** — it genuinely fetches `/api/health` and genuinely calls `NexusEnv.getMode()/setMode()` — but had one hardcoded line: a "Memory Engine: Online" status with a permanently-full green bar that never actually checked anything.

This phase's job was therefore: make the kill switch real, make the command center show real numbers, make the data export actually export data, and fix the one hardcoded line in the otherwise-legitimate panel — not invent a fourth dashboard.

---

## WHAT WAS REWRITTEN

### `OwnerControlEngine.ts` — rewritten in full
- `engageEmergencyShutdown(ownerId, reason)` / `disengageEmergencyShutdown(ownerId)` — state now persisted to `system_control/emergency_shutdown` via NexusDB (Phase E abstraction — correct across every server instance and every `DB_PROVIDER`, surviving restarts, exactly the Phase N pattern applied here)
- `getShutdownState()` / `isShutdown()` — real reads, fail-open if the DB itself is unreachable (a control-plane hiccup must never take down the whole business)
- Every engage is written to the Phase F `PaymentAuditLog` hash chain for a tamper-evident record of who pulled the switch and why
- `exportTenantData(tenantId)` now actually queries `orders`, `conversation_sessions`, and `customer_preferences` via NexusDB, filtered by the real `userId` field used by those collections (Phase C's `ConversationMemory`), and returns real record counts — not hardcoded empty arrays
- Removed: `getOverrideStatus()` (dead placeholder, zero other callers), `blockUnauthorizedMutation()` (dead placeholder, zero other callers), `canAccessMemory()` and `getEncryptedMemoryIndex()` (also zero other callers anywhere in the codebase — confirmed via full-codebase grep before removal)
- Kept and clarified: `validateAction()`, `canDeleteMemory()` (now role-based: `ceo`/`owner` only), `assertTenantBoundary()`

### Real enforcement — `shutdownGuard` middleware (NEW)
- Added to `server.ts`, applied to `POST /api/chat` — blocks new AI conversations while shutdown is engaged
- Added to `PaymentRoutes.ts`, applied to the three new-payment-creation routes (`bkash/create`, `nagad/create`, `rocket/create`) — blocks new payment initiation
- **Deliberately NOT applied to**: refund routes, payment callbacks/webhooks, audit-read routes, or admin routes themselves (so the owner can still disengage the shutdown, and customers already mid-transaction or mid-refund aren't stranded)
- This is a "stop taking new business" switch, not a process kill — riders already out on deliveries are not interrupted

### `OwnerControlPanel.tsx` — rewritten in full
- Renamed conceptually to "Business Command Center" (the UI title now matches what it actually shows)
- Real kill switch: calls `/api/admin/control/shutdown/engage|disengage`, shows a confirmation dialog explaining exactly what will and won't be affected, displays who engaged it and why when active
- Real summary tiles pulling from: Phase K (`ProfitEngine.getMonthOverMonth()`), Phase F (`SettlementEngine.getSummary()`), Phase M (`AnomalyDetectionEngine.getSummary(1)` for last-24h security events), Phase B (`RiderLocationServer.getLiveRiders()` for riders currently online) — no fabricated agent names, no fake log stream, no invented confidence scores
- Real data export: enter a tenant/customer ID, downloads actual JSON from `OwnerControlEngine.exportTenantData()`

### `NerveCenterApp.tsx` — one line fixed
- "Memory Engine: Online" hardcoded display replaced with the real `checkNexusDB` health-check result (Phase E) already present in `/api/health`'s `services` array — now genuinely reflects database reachability, with a red/unreachable state if the check fails

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/control/shutdown` | GET | Admin | Current emergency shutdown state |
| `POST /api/admin/control/shutdown/engage` | POST | Admin | Engage real shutdown (blocks new chat + new payments) |
| `POST /api/admin/control/shutdown/disengage` | POST | Admin | Resume normal operation |
| `GET /api/admin/control/export/:tenantId` | GET | Admin | Real data export (orders, conversations, preferences) as downloadable JSON |
| `GET /api/admin/control/command-center` | GET | Admin | Cross-cutting summary: profit, settlement, security, riders, shutdown state |

---

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `src/lib/control/OwnerControlEngine.ts` | Rewritten — see above |
| `src/components/admin/OwnerControlPanel.tsx` | Rewritten — see above |
| `src/components/admin/NerveCenterApp.tsx` | One hardcoded status line replaced with real health-check data |
| `server.ts` | New `shutdownGuard` middleware, applied to `/api/chat`; 5 new Phase H admin routes |
| `src/lib/payments/PaymentRoutes.ts` | New `shutdownGuard` helper applied to the 3 payment-creation routes |
| `firestore.rules` | Added `system_control` collection (read: any authenticated user; write: admin only) |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose | Mutability |
|---|---|---|
| `system_control` | Single document (`emergency_shutdown`) holding the persisted shutdown flag | Mutable, admin-only writes |

No new Firestore indexes were required — `system_control` is accessed by direct document ID (`NexusDB.get/set`), not a query.

---

## VERIFICATION CHECKLIST

- [ ] Engage the kill switch via the admin UI — confirm `system_control/emergency_shutdown` in the database now shows `engaged: true` with the correct `engagedBy`/`engagedAt`
- [ ] With shutdown engaged, `POST /api/chat` → `503 EMERGENCY_SHUTDOWN`
- [ ] With shutdown engaged, `POST /api/payment/bkash/create` (and nagad/rocket) → `503 EMERGENCY_SHUTDOWN`
- [ ] With shutdown engaged, `POST /api/payment/refund` still succeeds (refunds not blocked)
- [ ] With shutdown engaged, an in-progress rider delivery's status updates (`/api/delivery/*` heartbeat routes) are unaffected
- [ ] Restart the server process while shutdown is engaged — confirm it remains engaged after restart (persisted, not in-process)
- [ ] Disengage via the admin UI — confirm `/api/chat` and payment creation work again immediately
- [ ] `GET /api/admin/control/command-center` returns real, current numbers for profit/settlement/security/riders — not the old fixed "ONLINE" placeholders
- [ ] `GET /api/admin/control/export/:tenantId` for a tenant with real orders/conversations returns actual record counts > 0, not empty arrays
- [ ] Admin → Business Command Center → no fake agent list, no static log stream, no hardcoded confidence score anywhere on the page
- [ ] Admin → Nerve Center → database status row reflects real health-check state, including showing "Unreachable" if the database connection is actually broken (test by temporarily misconfiguring `DB_PROVIDER`)
