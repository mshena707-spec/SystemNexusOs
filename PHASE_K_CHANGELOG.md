# PHASE K — FINANCIAL OS
## Real Profit (COGS-based) · Cash Flow (Settled vs Pending) · Expense Tracking · Product Profitability

**Date:** June 2026
**Status:** COMPLETE (with one honestly-documented gap — see "What Was NOT Built And Why")

---

## WHAT WAS BUILT

### New Files (3)

| File | Purpose |
|---|---|
| `src/lib/finance/ExpenseTracker.ts` | Records operating expenses by category — did not exist anywhere before this phase |
| `src/lib/finance/ProfitEngine.ts` | Real gross/net profit from actual order line items × product cost price, not an assumed margin |
| `src/lib/finance/CashFlowEngine.ts` | Distinguishes settled cash (Phase F settlement batches) from pending/recognized revenue |
| `src/components/admin/FinancialOSApp.tsx` | Admin UI — Profit, Cash Flow, Product Profitability, Expenses tabs |

---

## THE CORE PROBLEM THIS PHASE FIXES

Every prior phase's `BIEngine` (`getRevenueMetrics`, `forecastRevenue`) tracked **revenue only**. There was no cost-of-goods field on the `Product` model, no expense-tracking collection, and no concept anywhere in the codebase that revenue minus cost equals profit. Any "profit" number a dashboard might have displayed before this phase would, by construction, have just been revenue relabeled — a business owner reading it could believe they were profitable while actually operating at a loss, because nothing in the system was capable of telling the difference.

Separately, Phase F's `SettlementEngine` already tracked the real-world delay between "a customer paid" (revenue recognized) and "the money is actually in the merchant's bank account" (T+0 for Stripe, T+1/T+2 for mobile banking) — but that distinction lived entirely inside payment-ops internals and was never surfaced as a business-level cash-flow metric. A business could show strong "revenue" while genuinely running low on usable cash, with no warning anywhere.

---

## ARCHITECTURE

```
                         ProductRepository.costPrice (NEW field)
                                      │
                                      ▼
  OrderRepository.findRecent() ──▶ ProfitEngine.computeCOGS()
                                      │  (line items × costPrice, NOT assumed %)
                                      ▼
                              ProfitEngine.getProfitReport()
                                      │
                    Revenue − COGS = Gross Profit
                    Gross Profit − ExpenseTracker totals = Net Profit
                                      │
                                      ▼
                         FinancialOSApp → Profit tab


  SettlementEngine.settlement_batches (Phase F)        ExpenseTracker.expenses (NEW)
       settled vs pending per provider                  category-tagged operating costs
                    │                                            │
                    └──────────────┬─────────────────────────────┘
                                   ▼
                        CashFlowEngine.getCashFlowReport()
                    Cash In (settled only) − Cash Out (expenses+refunds)
                                   │
                                   ▼
                      FinancialOSApp → Cash Flow tab
                      + risk flags (overdue settlement, pending-cash ratio)
```

---

## FEATURE DETAIL

### 1. Cost-of-Goods Tracking (Product model extension)
- `Product.costPrice` — new optional field, the actual wholesale/manufacturing cost per unit
- `ProfitEngine.computeCOGS()` looks up each order line item's product and multiplies `costPrice × quantity` — this is **real COGS from real sales data**, not an assumed gross-margin percentage applied to revenue
- **Data-quality safeguard**: orders referencing products with no `costPrice` set still count in revenue but contribute $0 to COGS, and are counted in `ordersWithMissingCostPrice`. The admin UI surfaces this as a warning banner rather than silently understating costs — an owner who hasn't entered cost prices yet sees an honest "your margin numbers are incomplete" message instead of a falsely rosy number.

### 2. Expense Tracking
- `ExpenseTracker` — 10 categories (`cogs`, `rider_payout`, `marketing`, `software`, `rent`, `salaries`, `payment_processing_fees`, `refunds`, `utilities`, `other`)
- Manual entry via admin UI (`POST /api/admin/finance/expenses`) for rent, salaries, marketing spend, etc.
- Two categories are **auto-recordable** from existing Phase F/B data:
  - `recordProcessingFee()` — hooked into the existing Phase F settlement cron (01:00 daily), records the provider's processing fee as an expense **if and only if** the owner has set a real fee-rate env var (`STRIPE_FEE_RATE`, `BKASH_FEE_RATE`, etc.) — defaults to 0/unrecorded rather than guessing a percentage, since processing fees are merchant-contract-specific and vary by negotiated agreement
  - `recordRiderPayout()` — exposed via `POST /api/admin/finance/rider-payout` for manual/admin-driven entry (see honest gap below for why this isn't auto-calculated)

### 3. Profit Engine
- `getProfitReport(fromISO, toISO, label)`: Revenue (from paid/delivered orders) − COGS = Gross Profit; Gross Profit − Operating Expenses = Net Profit
- `getMonthOverMonth()`: this month vs last month comparison for the dashboard
- `getProductProfitability()`: ranks every product by actual gross profit (revenue − COGS), not just units sold — surfaces which products are loss leaders vs. real margin drivers

### 4. Cash Flow Engine
- `getCashFlowReport()`: Cash In = **only settled** settlement batches (real money received); Pending Cash In = paid-but-not-yet-settled (revenue recognized, not yet liquid) — tracked as a separate line so it's never confused with cash-in-hand
- Cash Out = completed refunds + recorded expenses
- `getRiskFlags()`: flags if settlement batches are overdue (from Phase F's `findOverdueBatches`), or if the pending-cash ratio exceeds 40% of recent volume — an early warning for settlement backlogs before they become a liquidity problem
- `getDailySeries()`: daily settled/pending/expenses breakdown for charting

---

## WHAT WAS NOT BUILT AND WHY (honest gap)

**Rider payout amounts are not auto-calculated.** `RiderPerformanceEngine` (Phase B) tracks delivery counts, on-time rate, and success rate per rider — but there is no per-delivery pay rate, commission structure, or payout formula anywhere in the existing codebase. Auto-generating a payout expense would have required inventing a number (e.g. "$X per delivery") with no basis in the actual business's rider compensation structure. Rather than fabricate a plausible-looking but made-up rate that would silently corrupt every profit and cash-flow report downstream, `ExpenseTracker.recordRiderPayout()` is built and exposed via the admin API, but is **not auto-wired into any cron** — it's a tool for the owner (or a future Phase K.1, once a real payout-rate model exists) to record actual payouts as they're paid. This is flagged here explicitly rather than silently shipped as a guessed default.

The same reasoning applies to payment processing fee rates: `STRIPE_FEE_RATE` etc. default to `"0"` in `.env.example`, meaning **no fee is recorded until the owner enters their actual negotiated rate** with each provider.

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/finance/profit?from=&to=&label=` | GET | Admin | Profit report for a date range |
| `GET /api/admin/finance/profit/month-over-month` | GET | Admin | This month vs last month |
| `GET /api/admin/finance/products/profitability` | GET | Admin | Per-product profit ranking |
| `GET /api/admin/finance/cashflow?from=&to=&label=` | GET | Admin | Cash flow report for a date range |
| `GET /api/admin/finance/cashflow/month-over-month` | GET | Admin | This month vs last month |
| `GET /api/admin/finance/cashflow/daily?days=` | GET | Admin | Daily series for charting |
| `GET /api/admin/finance/cashflow/risk` | GET | Admin | Settlement/liquidity risk flags |
| `POST /api/admin/finance/expenses` | POST | Admin | Record an expense |
| `GET /api/admin/finance/expenses?from=&to=` | GET | Admin | List expenses in range |
| `PUT /api/admin/finance/expenses/:id` | PUT | Admin | Update an expense |
| `DELETE /api/admin/finance/expenses/:id` | DELETE | Admin | Delete an expense |
| `POST /api/admin/finance/rider-payout` | POST | Admin | Manually record a rider payout |

---

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `src/lib/database/repositories/ProductRepository.ts` | Added `costPrice?: number` to `Product` interface |
| `server.ts` | 12 new Financial OS routes; settlement cron (01:00) now also auto-records processing fees if rates are configured |
| `firestore.rules` | Added `expenses` collection (admin read/write) |
| `firestore.indexes.json` | 2 new indexes for expense queries by date/category |
| `.env.example` | `STRIPE_FEE_RATE`, `BKASH_FEE_RATE`, `NAGAD_FEE_RATE`, `ROCKET_FEE_RATE` (all default `"0"`) |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose | Mutability |
|---|---|---|
| `expenses` | Operating expenses by category, manual or auto-recorded | Mutable (admin can correct/delete entries) |

---

## VERIFICATION CHECKLIST

- [ ] Set `costPrice` on a few products, place test orders, run `GET /api/admin/finance/profit/month-over-month` — confirm COGS reflects real line-item costs, not a percentage assumption
- [ ] Leave a product's `costPrice` unset, order it — confirm `ordersWithMissingCostPrice` increments and the admin UI shows the data-quality warning banner
- [ ] `POST /api/admin/finance/expenses` with category `marketing` — confirm it appears in the next profit report's `operatingExpensesByCategory`
- [ ] Set `STRIPE_FEE_RATE=0.029` in env, wait for the 01:00 settlement cron (or trigger `buildDailyBatches` manually) — confirm a `payment_processing_fees` expense is auto-recorded for that day's Stripe batch
- [ ] With `STRIPE_FEE_RATE` unset (default "0") — confirm no fee expense is recorded (no fabricated number)
- [ ] `GET /api/admin/finance/cashflow/month-over-month` — confirm `cashIn` only counts settled batches, and `pendingCashIn` separately shows paid-but-unsettled amounts
- [ ] Manually mark a settlement batch overdue (or wait for Phase F's overdue cron) — confirm `GET /api/admin/finance/cashflow/risk` returns a high-severity flag
- [ ] `GET /api/admin/finance/products/profitability` — confirm products are ranked by actual gross profit (revenue − COGS), not just revenue or units sold
- [ ] Admin → Financial OS → all 4 tabs load with real data, no placeholder/mock numbers
