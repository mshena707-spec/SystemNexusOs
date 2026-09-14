# API Specification

**Status of this document:** ✅ Generated from a real inventory of `server.ts` (3,724 lines, 196 route definitions). Status of the underlying API: 🟡 Beta (mixed — see `FEATURE_STATUS.md` for why a single label doesn't fit 196 routes).

## Why this doc exists

There was no API reference anywhere in the 40 existing markdown files. An integration partner, a frontend engineer joining the team, or an AI coding agent extending this API previously had one option: read all 3,724 lines of `server.ts`. This doc is the map.

## Route inventory by domain

| Prefix | Route count | Share |
|---|---|---|
| `/api/admin/*` | 125 | 64% |
| `/api/delivery/*` | 17 | 9% |
| `/api/auth/*` | 12 | 6% |
| `/api/memory/*` | 7 | 4% |
| `/api/reviews/*`, `/api/loyalty/*` | 4 each | 4% |
| `/api/referral/*`, `/api/products/*`, `/api/orders/*`, `/api/inventory/*` | 3 each | 6% |
| `/api/tax/*`, `/api/store/*`, `/api/features/*`, `/api/csat/*`, `/api/commerce/*`, `/api/chat/*`, `/api/channels/*` | 2 each | 7% |
| `/api/campaigns/*` | 1 | <1% |

**The honest read of this table:** almost two-thirds of the entire API surface is `/api/admin/*`. This is not a customer-facing e-commerce API with an admin panel bolted on — it is, structurally, an **operations control plane** with a thin customer-facing layer. That matches the audit's own framing ("AI-Native Business Operating System," not an e-commerce site) better than the routing would suggest if you assumed a typical storefront.

### `/api/admin/*` breakdown (top areas)

| Area | Routes |
|---|---|
| procurement | 13 |
| finance | 12 |
| payments | 11 |
| marketing | 8 |
| ai | 7 |
| automation-rules | 6 |
| pricing, omni(channel), control, backup | 5 each |
| db, audit, alerts | 4 each |
| security, fraud, forecast, coupons, ceo | 3 each |

## HTTP method distribution

| Method | Count |
|---|---|
| GET | 100 |
| POST | 80 |
| DELETE | 8 |
| PUT | 5 |
| PATCH | 3 |

Heavily read/write balanced toward GET+POST, which is typical for an admin/ops surface (lots of dashboards pulling data, lots of triggered actions). Comparatively few PUT/PATCH — worth checking whether "update" operations are being done via POST-as-update rather than proper PUT/PATCH, which is a minor but real REST-convention drift.

## Auth & security posture (as found)

- `requireAdmin` guard: 202 occurrences — broad coverage, appropriate given 125 of 196 routes are admin routes.
- `requireAuth` guard: 2 occurrences — worth double-checking that every non-admin, non-public route (e.g. `/api/orders`, `/api/reviews`) is actually behind one of these two guards and not accidentally open. This audit round didn't trace every route individually; that's a recommended follow-up, not a confirmed problem.
- `InputValidator.ts` exists (`src/api/middleware/`) — real input validation middleware, good practice.
- `express-rate-limit` is a dependency and is referenced twice in `server.ts` — likely applied globally or to a small number of routes rather than per-route. Worth confirming rate limiting covers the public/auth routes specifically (login, signup, password reset), since those are the highest-value targets for abuse.

## What's missing (future-proofing gaps)

1. **No API versioning.** Zero routes matched `/api/v1/*` or `/api/v2/*` — every route is unversioned `/api/*`. This is fine at prototype stage and becomes a real liability the moment an external partner or a mobile app build depends on a route you need to change. **Recommendation:** introduce `/api/v1/` prefix now, before any external consumer exists, so the migration cost is paid once, early, instead of never (breaking changes) or expensively (dual-running versions under time pressure later).
2. **No machine-readable spec.** No OpenAPI/Swagger file was found. With 196 routes, hand-written docs will drift immediately. **Recommendation:** at minimum, annotate route handlers with JSDoc and generate an OpenAPI doc from it — even a partial, admin-routes-only spec is more valuable than none, because it's the one artifact both a human frontend engineer and an AI coding agent can consume without reading `server.ts` end to end.
3. **Single 3,724-line file.** This is a maintainability point that belongs more to Part 2 (Core Architecture Audit) than this documentation pass, but it's worth flagging here because it's the direct reason this API previously had no reference doc — nobody wants to read a 3,724-line file to find one route.

## How to use this doc

Treat the tables above as the *current, honest* map. When a new route is added, add one line to the relevant table in the same PR — this is cheaper than letting the doc drift and someone re-deriving it from `server.ts` again in six months.
