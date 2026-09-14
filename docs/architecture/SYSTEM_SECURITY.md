# System Security

**Status of this document:** ✅ Generated from a real inventory of `src/lib/security/` (15 files, ~1,169 lines sampled) plus `firestore.rules` (376 lines). Status of the underlying system: 🟡 Beta — the design surface is genuinely broad; independent verification (pen testing, ACL fuzzing) has not been done as part of this documentation pass.

## Why this doc exists

An AI agent that can act on procurement, finance, and payments (see `API_SPECIFICATION.md` — those are the three biggest admin route categories) is, by definition, a high-value attack target. Nobody had written down what the security layer actually consists of. This is that inventory, plus an honest gap list.

## What exists

| Layer | File(s) | Lines | Purpose |
|---|---|---|---|
| Access control (ABAC) | `security/abac/ABACEngine.ts` | 378 | Attribute-based access control — finer-grained than simple role checks |
| Tenant isolation | `security/audit/TenantIsolation.ts` | 144 | Prevents cross-tenant data access in a multi-tenant deployment |
| Audit trail | `security/audit/ImmutableAuditLog.ts` | 285 | Write-once audit log — pairs with `ImmutableMemory` in the memory system |
| Fraud detection (general) | `security/FraudDetectionEngine.ts` | — | General-purpose fraud signals |
| Fraud detection (COD-specific) | `security/fraud/CODFraudDetector.ts` | 119 | Cash-on-delivery fraud — relevant for markets where COD is the dominant payment method |
| Anomaly detection | `security/auth/AnomalyDetectionEngine.ts` | — | Behavioral auth anomalies |
| Device fingerprinting | `security/auth/DeviceFingerprint.ts` | — | Device-level identity signal |
| JWT handling | `security/auth/JWTService.ts` | — | Token issuance/verification |
| 2FA (TOTP) | `security/2fa/TOTPService.ts` | 243 | Time-based one-time-password 2FA (`speakeasy` + `qrcode`) |
| Mode isolation | `security/ModeIsolationGuard.ts` | — | Guards against test-mode/live-mode data crossing (name suggests this — confirm scope before relying on it) |
| Enterprise-tier controls | `security/EnterpriseSecurity.ts`, `security/AdvancedSecurity.ts` | — | Named for enterprise-tier customers; scope not independently verified this round |
| Request-level middleware | `security/middleware/SecurityMiddleware.ts` | — | Uses Redis (`createClient`) — likely for rate-limit counters/session state |
| Declarative DB rules | `firestore.rules` (repo root) | 376 | Firestore-native security rules — this is the actual last line of defense for the default (Firestore) database backend |

All of the above are wired into `NexusEventBus` for `fraud.detected`, `fraud.blocked`, `security.breach_attempt`, `auth.login.failed/success` events (see `EVENT_BUS.md`) — meaning security events are structurally positioned to trigger downstream automation (alerts, agent escalation to `SECURITY_AI` per `AGENT_PROTOCOL.md`'s hierarchy), not just logged silently.

## The COD fraud detector is worth calling out specifically

A dedicated Cash-on-Delivery fraud module, alongside SSLCommerz/bKash/Nagad/Rocket payment references elsewhere in the docs, is a strong, specific signal this system is built for a market where COD and local mobile financial services dominate over card payments — that's a real, defensible product decision, not generic boilerplate. Worth stating explicitly in product/investor-facing docs as a differentiator, since most off-the-shelf commerce platforms (Shopify, etc.) treat COD as an afterthought.

## Honest gaps

1. **No independent verification.** Every item above is confirmed to *exist* and be *wired up*. None has been confirmed *correct* under adversarial conditions, because there is no test suite in this repo (see `FEATURE_STATUS.md`). `src/lib/testing/SecurityPenTestEngine.ts` exists and is presumably meant to cover this — but as a runtime engine, not a CI-enforced regression test, it doesn't catch a regression introduced by tomorrow's commit the way a test suite would.
2. **Secrets handling.** `.env.example` correctly keeps secrets out of the repo, and `OWNER_SECRET`/`JWT_SECRET` are treated as required env vars per `DEPLOYMENT.md`. Not verified this round: rotation policy, and whether any of the 3 backend-specific connection strings (Postgres, Supabase, MongoDB — see `DATABASE_SCHEMA.md`) that aren't the active `DB_PROVIDER` are still loaded/validated at boot even when unused (unnecessary attack surface if so).
3. **Rate limiting scope.** `express-rate-limit` is referenced only twice in `server.ts` against 196 routes (see `API_SPECIFICATION.md`) — confirm it specifically covers `/api/auth/*` (12 routes) and any public-facing routes, not just a global default.
4. **`requireAuth` usage (2 occurrences) vs `requireAdmin` (202 occurrences).** Worth an explicit pass to confirm every customer-facing (non-admin) route that touches personal data is actually behind an auth check — this wasn't traced route-by-route this round.

## Recommendation

Prioritize in this order: (1) confirm auth coverage on all non-admin routes touching personal/financial data, (2) confirm rate limiting on `/api/auth/*`, (3) add one automated test that asserts `TenantIsolation` actually blocks a cross-tenant read — this is the single test most worth writing before onboarding a second tenant, because it's the one failure mode that turns into a data-breach headline instead of a bug ticket.
