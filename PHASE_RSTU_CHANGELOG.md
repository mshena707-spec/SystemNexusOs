# PHASE R / S / T / U CHANGELOG

---

## Phase R — Loyalty Points Engine + Real Abandoned Cart Recovery

### New Files
| File | Status |
|---|---|
| `src/lib/loyalty/LoyaltyEngine.ts` | ✅ NEW — fully absent before Phase R |
| `src/lib/marketing/AbandonedCartRecoveryEngine.ts` | ✅ NEW — replaces deprecated GrowthEngine stub |

### LoyaltyEngine
- Points earned per order: `floor(orderAmount × LOYALTY_POINTS_PER_UNIT)` — env-configurable (default 0.1 = 1pt per 10 units)
- Idempotent: `awardForOrder()` checks for duplicate orderId before writing
- Balance computed from transaction log (source of truth, not a mutable counter)
- Tiers: Bronze (0–999) / Silver (1000–4999) / Gold (5000–14999) / Platinum (15000+)
- Redeem: minimum 100 points, balance-validated, ImmutableAuditLog entry
- `awardBonus()`: for referral, campaign, admin manual adjustments
- NexusDB collections: `loyalty_transactions`

### AbandonedCartRecoveryEngine
- Replaces the `handleAbandonedCart()` fake "SAVE10" code reference (coupon that didn't exist)
- Strategy: Gold/Platinum → 500 loyalty bonus points; Silver → 10% CART-prefixed coupon; Bronze → 5% coupon
- Coupons issued via real `CouponEngine.create()` with `targetCustomerIds: [userId]` (single-use, expires 3 days)
- AI-generated personalised notification body (non-blocking, falls back to template message)
- Recovery attempts logged to `cart_recovery_log` collection for admin audit
- Duplicate guard: same cart will not trigger two recovery sequences

### Modified Files
- `src/lib/automation/AutomationEngine.ts`: `handleAbandonedCart()` now delegates to `AbandonedCartRecoveryEngine.recover()` instead of fake SAVE10 reference
- `src/lib/business/GrowthEngine.ts`: `triggerCartRecoverySequence()` deprecated no-op replaced with real delegation; direct cart params (customerId, cartId, cartTotal) now produce a real recovery action
- `src/lib/core/SystemBoot.ts`: `order.paid` EventBus subscription added → `LoyaltyEngine.awardForOrder()` called on every confirmed payment

### Server Routes (Phase R)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/loyalty/:customerId` | Balance + tier |
| GET | `/api/loyalty/:customerId/transactions` | Recent transactions |
| POST | `/api/loyalty/award` | Award points for order (idempotent) |
| POST | `/api/loyalty/redeem` | Redeem points against order |
| POST | `/api/admin/loyalty/award-bonus` | Manual admin bonus |
| GET | `/api/admin/cart-recovery-log` | Recovery audit log |

---

## Phase S — Dynamic Pricing Engine

### New Files
| File | Status |
|---|---|
| `src/lib/pricing/DynamicPricingEngine.ts` | ✅ NEW |

### What existed before
`AutonomousBusinessEngine.generateDynamicPricing()` accepted a caller-supplied `demandLevel: 'high'|'normal'|'low'` string with no mechanism to derive it from real data. It also applied a hardcoded `basePrice * 1.15` with no stock or trend signals.

### What Phase S built
Real demand signals from existing engines:
- `BIEngine.analyzeProductTrends()` → velocityScore (0-100), trend (rising/stable/declining), stockDaysLeft
- `StockAlertEngine.runAlerts()` → stock pressure, severity

Pricing rules (all env-configurable):
- High demand (velocity > 70) → +15%
- Rising trend → +5%
- Low stock < 5 days + non-low demand → +10%
- Low demand (velocity < 20) → -10%
- Declining trend → -5%
- Cap: ±25% of base price (guardrail)

AI psychological price rounding: optional enhancement via `NexusUnifiedCore` — rounds to nearest psychologically appealing price (e.g. 499 instead of 502). Accepted only if AI suggestion is within 5% of rule-based price; non-blocking.

**What-if simulation**: `simulate(productId, currentPrice, newPrice)` returns estimated demand change % and 30-day revenue delta. Uses price elasticity of -1.5 (industry rule-of-thumb). Clearly documented as directional guidance, not precise measurement.

**Apply price**: `applyPrice()` writes to `products` collection + audit log. Requires explicit `actorId`. Never called autonomously.

### Server Routes (Phase S)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/pricing/suggestions` | Suggestions for all active products |
| GET | `/api/admin/pricing/suggestions/:productId` | Suggestion for one product |
| POST | `/api/admin/pricing/simulate` | What-if simulation |
| POST | `/api/admin/pricing/apply` | Apply price (requires confirmation) |
| GET | `/api/admin/pricing/log` | Applied price audit log |

---

## Phase T — Admin Alerts UI + CheckoutModal Coupon/Loyalty Wiring

### New Files
| File | Status |
|---|---|
| `src/components/admin/AdminAlertsPanel.tsx` | ✅ NEW |

### AdminAlertsPanel
- Reads `admin_alerts` NexusDB collection written by `AutomationRuleEngine` (both `alert_admin` and `notify_supplier` actions)
- Before Phase T this collection was accumulating data with no UI to view it
- Features: unread/all filter, mark read, mark all read, dismiss
- Supplier alerts shown with Package icon; rule alerts with Zap icon
- Registered in DesktopShell: "Admin Alerts" button in Core Systems section

### CheckoutModal — coupon + loyalty wiring
- `src/components/CheckoutModal.tsx` replaced with Phase T version
- New optional prop: `userId?: string` — gracefully disabled if not supplied
- Coupon section: enter code → `/api/store/validate-coupon` → real-time discount display
- Loyalty section: loads balance from `/api/loyalty/:userId` → slider to choose points to redeem → discount shown
- Order summary: live subtotal / coupon discount / loyalty discount / final total
- Confirm button shows final total (e.g. "Confirm Payment ($47.50)")
- `onConfirmPayment()` now receives: `{ couponCode, couponDiscount, loyaltyPointsRedeemed, loyaltyDiscount, finalTotal }` — caller (Marketplace.tsx) can include these in the order document
- Post-confirm: calls `/api/store/redeem-coupon` and `/api/loyalty/redeem` server-side
- `src/pages/Marketplace.tsx`: `userId={user?.uid}` prop added to CheckoutModal

**Honest scope note (documented in file header):**
Orders remain client-side Firestore writes. The redeem calls happen after `onConfirmPayment()` — a small race window exists where payment confirms but a redeem call fails. Both endpoints are idempotent; failures log to console for reconciliation. Full atomicity requires server-side order creation (future phase).

### Server Routes (Phase T)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/alerts` | List alerts (desc order) |
| PATCH | `/api/admin/alerts/:id/read` | Mark single alert read |
| PATCH | `/api/admin/alerts/read-all` | Mark all alerts read |
| DELETE | `/api/admin/alerts/:id` | Dismiss alert |

---

## Phase U — Customer Identity Confidence Scoring + Marketplace.tsx Bug Fix

### Marketplace.tsx pre-existing syntax bug
- Lines 781-785 had a duplicated `toast.success()/catch()/};` block outside any function body
- Caused 3 TypeScript errors (TS1005, TS1128 × 2)
- Fixed by removing the duplicated block — zero TS errors in Marketplace.tsx now

### CustomerIdentityService — confidence scoring
`src/lib/omnichannel/CustomerIdentityService.ts` — Phase U adds two new methods (non-breaking, all existing methods unchanged):

**`CustomerIdentityService.scoreMatch(candidate, input)`** → 0.0–1.0
- Exact channel ID → 1.0 (returns immediately)
- Exact phone → 0.85 / Partial phone (last 8 digits) → 0.65
- Exact email → 0.80
- Name similarity bonus (Levenshtein-based) → +0.05 to +0.10
- Same platform bonus → +0.05
- Cap: 0.95 for any fuzzy match (1.0 only for exact)

**`CustomerIdentityService.findWithConfidence(input, opts)`** → ranked candidates
- Scans customer_identities (up to 2000), scores each, filters by minScore (default 0.5)
- Returns: `{ identity, score, reason }[]` sorted descending by score
- Use cases: admin deduplication UI, pre-merge confirmation, identity ambiguity review

Helper functions added at file level (not exported, not breaking):
- `_nameSimilarity(a, b)` — normalized Levenshtein
- `_levenshtein(a, b)` — DP Levenshtein distance
- `candidate_name_matches(a, b)` — threshold wrapper

---

## Zero TypeScript Errors in Phase R/S/T/U Files
Verified: `npx tsc --noEmit --skipLibCheck` — zero errors in all Phase R/S/T/U files.
Pre-existing errors in `SystemBoot.ts` (lines 192, 206, 223 — `await` in non-async `_registerAI()`) remain unchanged; they predate Phase R.

## NexusDB Collections Summary (all phases Q-U)
| Collection | Phase | Written By | Purpose |
|---|---|---|---|
| `coupons` | Q | CouponEngine | Coupon definitions |
| `coupon_redemptions` | Q | CouponEngine.redeem() | Redemption audit trail |
| `automation_rules` | Q | AutomationRuleEngine | Owner IF→THEN rules |
| `admin_alerts` | Q | AutomationRuleEngine | Alert + supplier notifications |
| `loyalty_transactions` | R | LoyaltyEngine | Points ledger |
| `cart_recovery_log` | R | AbandonedCartRecoveryEngine | Recovery audit |
| `pricing_suggestions` | S | DynamicPricingEngine | Applied price log |
