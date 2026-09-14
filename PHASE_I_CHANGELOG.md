# PHASE I — MARKETING INTELLIGENCE
## Real Segmentation · Real Campaign Attribution · Fabricated ROI Removal

**Date:** June 2026
**Status:** COMPLETE (with one honest note about segmentation scale — see below)

---

## PRE-WORK AUDIT — WHAT WAS FOUND

As with Phase H, Phase I began with a full audit of existing marketing infrastructure rather than blindly building on top of it. Three relevant files were found:

**`GrowthEngine.ts` — mixed: some real, some fabricated:**
- `suggestCampaign()` returned a hardcoded `expectedROI: '+14%'` regardless of audience, channel, or content. This is not a model output or a measurement — it is a string literal in the source code, presented as a data-driven insight.
- `suggestRetentionDiscount()` returned fixed `0.15` / `0.05` percentages with no basis in the business's actual margin structure or customer data.
- `triggerCartRecoverySequence()` calls `AutonomousBusinessEngine.recoverAbandonedCarts()`, which queries for `carts.status === 'abandoned'` — but **nothing in the codebase ever writes that status**. This function would always find zero carts to recover, silently doing nothing.
- `TrustEngine.detectChurnRisk(sentimentTrend[])` — the parameter is a sentiment array, but nothing in the codebase ever populates it from real data. The function could only ever be called with fabricated or empty input.
- **Kept real**: `calculateViralCoefficient()` (correct formula) and `generateFestivalCampaign()` (real AI call via NexusUnifiedCore).

**`BIEngine.scoreCustomer(userId)` — genuinely real, but severely under-used:**
Real formula: LTV from total spend + order count weighting, churn risk from recency, segment assignment from thresholds. This was only wired to a single `/api/admin/customers/:userId/score` route (single-customer-only). No bulk segmentation existed anywhere. Phase I's primary addition is making this production-quality function work at scale across all customers.

**`MarketingAgentApp.tsx` — mostly legitimate:**
The AI CMO chat tab genuinely calls `/api/chat` with real product context and a real system instruction. Kept entirely. No fabricated numbers were displayed in the UI — it was a legitimate AI chatbot that happened to lack the audience/campaign intelligence layer it was advertising.

---

## WHAT WAS BUILT

### New Files (3)

| File | Purpose |
|---|---|
| `src/lib/marketing/SegmentationEngine.ts` | Bulk scores all customers via `BIEngine.scoreCustomer()`, returns segment summaries |
| `src/lib/marketing/CampaignEngine.ts` | Real campaign creation/delivery (via NotificationEngine) + real attribution |
| `src/lib/marketing/ChurnPredictor.ts` | Churn risk ranking from real order + message-history signals |

### Remediated File (1)
| File | Change |
|---|---|
| `src/lib/business/GrowthEngine.ts` | Fabricated methods deprecated with explicit `@deprecated` docs pointing to real replacements; the `triggerCartRecoverySequence()` no-op is documented rather than silently kept |

---

## FEATURE DETAIL

### 1. Segmentation Engine
`SegmentationEngine.scoreAllCustomers(maxCustomers)` — bulk version of `BIEngine.scoreCustomer()`, applied to every customer who has placed at least one order (deduplicated from the orders collection). Returns segment assignments (`champion`, `vip`, `loyal`, `new`, `at_risk`, `dormant`) based on the same formula already tested in `BIEngine`:
- LTV score: `(totalSpend / 10) + (orderCount × 5)`, capped at 100
- Churn risk: inversely proportional to recency (days since last order)
- Segment: determined by LTV + churn risk thresholds

`getSegmentSummaries()` aggregates these into counts, total LTV, and average churn risk per segment — the dashboard's "audience overview."

**Scale note (honestly documented):** `scoreAllCustomers()` makes one DB + aggregation call per unique customer, in series. For stores up to ~500 customers this is fast enough for on-demand admin requests. Beyond that, this should move to a scheduled batch job writing pre-computed scores to a `customer_scores` collection — the same pattern used by `BIEngine`'s existing `cache` mechanism, extended to survive across requests. This is a deliberate Phase I.1 follow-up, flagged here rather than shipped as a silent performance problem.

### 2. Campaign Engine
`CampaignEngine.create(...)` — stores a draft with audience segment, channel, and message content (AI-generated via `generateFestivalCampaign()` or written manually).

`CampaignEngine.send(campaignId)`:
1. Builds the target audience from `SegmentationEngine.getSegmentMembers(segment)` — real scored customers, not a hardcoded list
2. For each recipient: calls `NotificationEngine.sendPush()` / `sendSMS()` / `sendEmail()` (Phase A's real notification implementation)
3. For SMS and email: resolves the customer's phone/email via `CustomerIdentityService.getById()` (Phase G) — the actual cross-channel identity a customer registered with
4. Records actual `sentCount`/`failedCount` from real delivery attempt results, not an assumed 100% success rate
5. Persists recipient userIds to `campaign_recipients` for attribution measurement later

`CampaignEngine.measureAttribution(campaignId)`:
- Reads the list of real recipients who received the campaign
- For each recipient, queries their actual orders placed after the campaign sent within the `attributionWindowDays` window
- Reports `ordersAttributed`, `revenueAttributed`, and `conversionRatePct` — real numbers from real order data
- **A campaign sent to 0 responsive customers will correctly show 0% conversion.** There is no floor, no minimum, no assumed engagement rate. This is the direct replacement for `GrowthEngine.suggestCampaign()`'s hardcoded `'+14%'`.

### 3. Churn Predictor
`ChurnPredictor.getAtRiskCustomers(riskThreshold, limit)`:
- Uses `BIEngine.scoreCustomer(userId).churnRisk` as the primary signal (real recency/frequency formula)
- Enriches with `MessageHistoryService.getTimeline(userId, 1)` (Phase G) — "how many days since this customer last messaged us on any channel?" — a real behavioral signal beyond order data
- Returns `recommendedAction` strings that describe general action categories (re-engagement push, win-back offer, channel-switching) without inventing a specific discount amount the business should offer
- `discountPctForRisk(risk)` provides a configurable suggestion table (20%/15%/10%/5% by risk tier) explicitly labeled as a default-that-should-be-reviewed, not a measurement — unlike `GrowthEngine.suggestRetentionDiscount()`'s hardcoded values which carried no such caveat

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/marketing/segments` | GET | Admin | All segments with count/LTV/churn-risk |
| `GET /api/admin/marketing/segments/:segment/members` | GET | Admin | Member list for one segment |
| `GET /api/admin/marketing/churn?threshold=50` | GET | Admin | At-risk customers above threshold |
| `POST /api/admin/marketing/campaigns` | POST | Admin | Create campaign draft |
| `GET /api/admin/marketing/campaigns` | GET | Admin | List campaigns |
| `POST /api/admin/marketing/campaigns/:id/send` | POST | Admin | Send to target audience |
| `POST /api/admin/marketing/campaigns/:id/attribution` | POST | Admin | Measure real post-campaign orders |
| `POST /api/admin/marketing/generate-copy` | POST | Admin | AI-generated campaign copy (festival/occasion) |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose |
|---|---|
| `campaigns` | Campaign drafts/sent records |
| `campaign_recipients` | Per-campaign recipient userIds (for attribution lookup) |
| `campaign_attribution` | Measured conversion rates and attributed revenue |

---

## VERIFICATION CHECKLIST

- [ ] `GET /api/admin/marketing/segments` — shows real customer counts per segment (not hardcoded)
- [ ] A customer with 5+ orders shows up in `champion` or `vip`; a customer who ordered once 6 months ago shows in `at_risk` or `dormant`
- [ ] `POST /api/admin/marketing/campaigns` with `segment: 'at_risk'` → campaign created; `audienceSize` matches the count from `/segments` for `at_risk`
- [ ] `POST /api/admin/marketing/campaigns/:id/send` → `sentCount` reflects real delivery results (push delivered, or skipped if user has no push token)
- [ ] Wait a few minutes, have a campaign recipient place a test order, then `POST /api/admin/marketing/campaigns/:id/attribution` → `ordersAttributed: 1`, real revenue shown
- [ ] Send a campaign with zero recipients (impossible segment combination) → `sentCount: 0`, and attribution shows `conversionRatePct: 0`, not an assumed rate
- [ ] `POST /api/admin/marketing/generate-copy { festivalName: "Eid" }` → real AI-generated copy returned, not a static string
- [ ] Admin → Marketing Intelligence → Audience tab shows real segment sizes, Campaigns tab tracks real sends, AI CMO chat still works
- [ ] `GrowthEngine.suggestCampaign()` logs a deprecation warning and returns an `expectedROI: 'UNMEASURED'` string — no longer a fabricated percentage
