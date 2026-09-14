# PHASE F — PAYMENT OPERATING SYSTEM
## Rocket Adapter · Unified Payment Layer · Refund/Settlement/Reconciliation Engines · Audit Log

**Date:** June 2026
**Status:** COMPLETE

---

## WHAT WAS BUILT

### New Files (10)

| File | Purpose |
|---|---|
| `src/lib/payments/RocketAdapter.ts` | Rocket (DBBL Mobile Banking) hosted-checkout integration |
| `src/lib/payments/IPaymentAdapter.ts` | Unified interface — every provider implements this |
| `src/lib/payments/adapters/StripePaymentAdapter.ts` | Wraps Stripe in `IPaymentAdapter` |
| `src/lib/payments/adapters/BkashPaymentAdapter.ts` | Wraps bKash in `IPaymentAdapter` |
| `src/lib/payments/adapters/NagadPaymentAdapter.ts` | Wraps Nagad in `IPaymentAdapter` |
| `src/lib/payments/adapters/RocketPaymentAdapter.ts` | Wraps Rocket in `IPaymentAdapter` |
| `src/lib/payments/PaymentRegistry.ts` | Central dispatcher — single entry point for create/verify/query/refund |
| `src/lib/payments/PaymentAuditLog.ts` | Hash-chained immutable log of every payment event |
| `src/lib/payments/RefundEngine.ts` | Eligibility rules, partial refunds, cumulative tracking |
| `src/lib/payments/SettlementEngine.ts` | Daily settlement batches per provider with business-day math |
| `src/lib/payments/ReconciliationEngine.ts` | Cross-checks internal records vs provider state, flags discrepancies |
| `src/components/admin/PaymentOSApp.tsx` | Admin UI — 4 tabs: providers, settlement, reconciliation, audit |

---

## ARCHITECTURE

```
                    Business Logic (checkout, refund requests)
                                │
                                ▼
                    ┌─────────────────────────┐
                    │     PaymentRegistry        │  ← SINGLE ENTRY POINT
                    │  .createPayment()          │
                    │  .verifyPayment()           │
                    │  .queryPayment()             │
                    │  .refund()                   │
                    └────────────┬─────────────┘
                                 │
                  implements IPaymentAdapter
                                 │
        ┌───────────┬───────────┼───────────┐
        ▼           ▼           ▼           ▼
   ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────┐
   │ Stripe  │ │  bKash   │ │  Nagad  │ │ Rocket  │
   │  T+0    │ │   T+1    │ │   T+1   │ │   T+2   │
   └─────────┘ └──────────┘ └─────────┘ └─────────┘
        │           │           │           │
        └───────────┴───────────┴───────────┘
                     │
        Every operation also writes to:
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
  ┌───────────────┐    ┌──────────────────┐
  │ PaymentAuditLog │    │  NexusDB (Phase E) │
  │ (hash-chained)  │    │  payments/orders   │
  └───────────────┘    └──────────────────┘
          │
          ▼
  ┌─────────────────┐         ┌──────────────────────┐
  │ SettlementEngine  │ ──cron──▶ daily batches per provider, T+N business days │
  └─────────────────┘         └──────────────────────┘
          │
          ▼
  ┌─────────────────────┐     ┌────────────────────────────┐
  │ ReconciliationEngine │ ──cron──▶ daily: internal vs provider state, flag discrepancies │
  └─────────────────────┘     └────────────────────────────┘
```

---

## FEATURE DETAIL

### 1. Rocket Adapter (NEW PROVIDER)
- Hosted-checkout pattern matching bKash/Nagad (Phase A)
- `createPayment()` → `/payment/initiate` → returns `redirectUrl`
- `verifyPayment()` → `/payment/verify/:txnId` → confirms `COMPLETED`/`SUCCESS`
- `queryPayment()` → polling support for reconciliation
- `refund()` → submits refund REQUEST (DBBL mobile banking settles refunds via back-office, 1-3 business days)
- Settlement delay: T+2 (longest of the 4 providers — reflected in `SettlementEngine`)

### 2. Payment Adapter Layer (`IPaymentAdapter`)
- Every provider implements: `createPayment`, `verifyPayment`, `queryPayment`, `refund`, `isConfigured`
- Declares `supportedCurrencies` and `settlementDelayDays` — used by SettlementEngine
- **Adding a new provider (SSLCommerz, Aamarpay, PayPal):** implement the interface, register in `PaymentRegistry` constructor. Zero other code changes — refunds, settlement, reconciliation, audit all work automatically.

### 3. PaymentRegistry — Single Entry Point
- `createPayment(providerId, req)` — validates currency support, calls adapter, persists `payments` record via NexusDB, writes audit entry
- `verifyPayment(providerId, providerRef, orderId)` — confirms payment, updates `payments` + `orders` status, writes audit entry
- `queryPayment(providerId, providerRef)` — read-only status check (used by ReconciliationEngine)
- `refund(providerId, req)` — issues refund, updates payment record with cumulative refund tracking, writes audit entry
- `listConfigured()` / `listAll()` — for admin diagnostics

### 4. Refund Engine
- `checkEligibility(orderId)`:
  - Payment must be `success` or `partially_refunded`
  - Must have remaining refundable amount > 0
  - Must be within 14-day refund window (policy constant `REFUND_WINDOW_DAYS`)
- `processRefund({ orderId, amount?, reason, requestedBy })`:
  - Full refund if `amount` omitted; partial if specified
  - Validates `amount <= maxRefundable`
  - Tracks cumulative `refundAmount` on payment record
  - Sends push notification to customer (instant for Stripe, "1-3 business days" for mobile banking)
- `getPendingRefunds()` — async refunds awaiting settlement confirmation (bKash/Nagad/Rocket)

### 5. Settlement Engine
- `computeExpectedSettlementDate(provider, paidDate)` — adds `settlementDelayDays` business days, **excluding Bangladesh weekend (Friday/Saturday)**
- `buildDailyBatches(date)` — groups successful payments by provider+date into `settlement_batches`
- `markSettled(batchId, actualAmount)` — admin confirms settlement, computes `settled`/`partial`/`pending` status
- `findOverdueBatches()` — flags batches past expected settlement date, fires admin notification
- `getSummary()` — pending/settled/overdue/partial counts + per-provider breakdown

### 6. Reconciliation Engine
- `run(lookbackDays=7)` — checks last N days of payments:
  - **Stuck pending**: `pending` status > 24h with no provider update
  - **Orphaned**: internal `success` but provider has no record (chargeback, fraud hold)
  - **Status mismatch**: internal status doesn't match provider-reported status
  - **Amount mismatch**: internal amount ≠ provider-reported amount (>5% = high severity)
- Persists `ReconciliationReport` to `reconciliation_reports`
- High-severity discrepancies → admin notification + audit log entry
- `getOpenDiscrepancies(days)` — aggregates discrepancies across recent reports

### 7. Payment Audit Logs (Hash-Chained, Immutable)
- Every `create`/`verify`/`refund`/`reconciliation` action recorded
- SHA-256 HMAC hash chain: `hash = HMAC(orderId + provider + action + status + ... + prevHash)`
- `verifyChain()` — walks the entire chain, detects tampering (broken link)
- Firestore rule: `allow update, delete: if false` — truly append-only
- `getOrderHistory(orderId)` — full payment lifecycle for one order
- `getRecent(limit)` — admin dashboard feed

---

## CRON SCHEDULE (added)

| Schedule | Job |
|---|---|
| Daily 01:00 | `SettlementEngine.buildDailyBatches()` for yesterday |
| Daily 02:30 | `ReconciliationEngine.run(7)` |
| Daily 06:00 | `SettlementEngine.findOverdueBatches()` → admin alerts |

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/payments/providers` | GET | Admin | All providers + config status |
| `GET /api/admin/payments/settlement` | GET | Admin | Settlement summary |
| `POST /api/admin/payments/settlement/build` | POST | Admin | Build batches for a date |
| `POST /api/admin/payments/settlement/:batchId/settle` | POST | Admin | Mark batch settled |
| `GET /api/admin/payments/settlement/overdue` | GET | Admin | Overdue batches |
| `POST /api/admin/payments/reconcile` | POST | Admin | Run reconciliation now |
| `GET /api/admin/payments/reconciliation/latest` | GET | Admin | Latest report |
| `GET /api/admin/payments/discrepancies` | GET | Admin | Open discrepancies |
| `GET /api/admin/payments/audit` | GET | Admin | Recent audit entries |
| `GET /api/admin/payments/audit/verify` | GET | Admin | Verify hash chain integrity |
| `GET /api/admin/payments/refunds/pending` | GET | Admin | Async refunds pending settlement |
| `POST /api/payment/rocket/create` | POST | Public | Initiate Rocket payment |
| `GET /api/payment/rocket/callback` | GET | Public | Rocket redirect callback |
| `POST /api/payment/refund` | POST | Public* | Universal refund via RefundEngine |
| `GET /api/payment/refund/eligibility/:orderId` | GET | Public* | Check refund eligibility |
| `GET /api/payment/audit/:orderId` | GET | Public* | Order payment history |

*Should be gated by customer auth in production — currently open per existing pattern of `/api/payment/*` routes.

---

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `src/lib/payments/PaymentRoutes.ts` | Added Rocket routes; migrated bKash/Nagad handlers from `firebase/firestore` → `NexusDB` (Phase E); replaced Stripe-only refund with universal `RefundEngine`-backed refund + legacy `/stripe/refund` alias |
| `firestore.rules` | Added `payment_audit_log` (immutable), `settlement_batches`, `reconciliation_reports` (immutable), `migration_reports` |
| `firestore.indexes.json` | 7 new indexes for payments, audit log, settlement, reconciliation |
| `.env.example` | Rocket credentials (`ROCKET_*`), `AUDIT_HMAC_SECRET` |
| `server.ts` | 11 new admin routes; 3 new cron jobs (settlement build, reconciliation, overdue check) |

---

## NEW ENVIRONMENT VARIABLES

```bash
# Rocket (DBBL Mobile Banking)
ROCKET_BASE_URL="https://rocket.com.bd/sandbox/mpg"
ROCKET_MERCHANT_ID=""
ROCKET_MERCHANT_PASSWORD=""
ROCKET_STORE_ID=""

# Payment audit log hash-chain secret (defaults to OWNER_SECRET if unset)
AUDIT_HMAC_SECRET=""
```

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose | Mutability |
|---|---|---|
| `payment_audit_log` | Hash-chained event log | Append-only |
| `settlement_batches` | Daily settlement groupings per provider | Mutable (status updates) |
| `reconciliation_reports` | Daily discrepancy reports | Append-only |

---

## VERIFICATION CHECKLIST

- [ ] `GET /api/admin/payments/providers` → shows stripe/bkash/nagad/rocket with config status
- [ ] Set `ROCKET_*` env vars → `POST /api/payment/rocket/create` returns `redirectUrl`
- [ ] Complete a Stripe payment → `payment_audit_log` has `create` + `verify` entries
- [ ] `GET /api/admin/payments/audit/verify` → `{ valid: true }`
- [ ] `POST /api/payment/refund/eligibility/:orderId` → returns eligibility before refund
- [ ] `POST /api/payment/refund { orderId, reason }` → processes refund via correct provider
- [ ] `POST /api/admin/payments/settlement/build` → creates batches grouped by provider
- [ ] `POST /api/admin/payments/reconcile` → returns report with `checkedCount` and `discrepancies`
- [ ] Manually set a payment to `pending` with `createdAt` > 24h ago → reconciliation flags `stuck_pending`
- [ ] Admin → Payment OS → all 4 tabs load with real data
