# ADR-0023: Coupon abuse / refund fraud detection, and competitor-aware pricing

Status: Accepted
Date: 2026-07-22

## Context

CTO Audit Part 6. Section 15 named 6 fraud types; checked against the 3 existing fraud engines (`FraudDetectionEngine`, `CODFraudDetector`, `RiderFraudDetector`), 4 were covered and 2 — Coupon Abuse, Refund Fraud — were confirmed completely absent, despite `CouponEngine.ts` (real coupon redemption logic) already existing to check against. Section 6 named 6 pricing factors; `DynamicPricingEngine.ts` (already real, not "static" as the audit framed it) covered 2 (Demand, Stock); Competition was confirmed missing despite `CompetitorAI.ts` (real, web-search-backed competitor pricing) already existing and already running as a background job.

## Decision

**Fraud:** `FraudDetectionEngine.assessCouponAbuse()` and `.assessRefundRisk()` — new methods, same signals-plus-riskScore-plus-decision pattern as the existing `assess()`. Coupon abuse: in-memory velocity tracking of distinct codes tried per user per hour (coupon-hunting signature), same pattern already used for order velocity in this class. Refund risk: refund-rate-over-recent-orders plus new-account-with-refunds signals, taking counts as parameters rather than querying the orders collection directly (keeps this class's existing scope — it previously only ever touched `fraud_flags`).

**Pricing:** wired `CompetitorAI.getAnalysisHistory()` into `DynamicPricingEngine.suggestForProduct()` as a new signal. Reads the cached analysis, not a live search — pricing needs to stay fast, and competitor data already refreshes on its own schedule via `TaskQueue`. Damped adjustment (half the price gap, not a full match) and gated on confidence/recency/gap-size, so a single cached data point can't cause an aggressive price swing.

Both fraud methods and the pricing signal are **not wired into their natural call sites** (`CouponEngine.validate()`, a refund-request handler) — deliberately available-but-unintegrated, so as not to modify already-working redemption/refund code in the same change that adds detection logic.

## Consequences

**Easier:** the specific fraud vectors and pricing factor the audit named are now real, callable capability, following the existing codebase's own established patterns rather than introducing new ones.

**Harder / cost:** without the integration step, none of this affects real behavior yet — it's built and correct but dormant until wired in. That's a deliberate scope boundary, not an oversight, but worth being explicit about: "built" here means "available to call," not "already protecting the system."

## Verification

Both changes type-check cleanly against the real compiler.
