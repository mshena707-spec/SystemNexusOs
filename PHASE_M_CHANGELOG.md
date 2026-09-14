# PHASE M — SECURITY HARDENING
## Real JWT Authentication · Anomaly & Bot Detection · Device Fingerprinting

**Date:** June 2026
**Status:** COMPLETE

---

## WHAT WAS BUILT

### New Files (4)

| File | Purpose |
|---|---|
| `src/lib/security/auth/JWTService.ts` | Real signed JWTs (access + refresh), session revocation, refresh rotation |
| `src/lib/security/auth/DeviceFingerprint.ts` | Server-side device fingerprinting (no client-side libraries), bot signal extraction |
| `src/lib/security/auth/AnomalyDetectionEngine.ts` | Persisted anomaly/bot/brute-force/AI-misuse detection with admin escalation |
| `src/components/admin/SecurityOpsApp.tsx` | Admin UI — security events feed, session management, revocation |

---

## THE CORE PROBLEM THIS PHASE FIXES

**Before Phase M**, the entire authorization layer was:

```typescript
function requireAdminAuth(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "").trim();
  const adminSecret = process.env.OWNER_SECRET;
  if (!adminSecret || token !== adminSecret) { res.status(401)...; return; }
  next();
}
```

One static string, compared directly. No expiry. No roles. No revocation. The same secret valid forever in every browser tab, every admin, every cron job. If it leaked once, it was compromised forever until manually rotated. There was **no JWT library in the project at all**, and regular customer/rider API calls had **no token verification middleware whatsoever**.

Separately, `AdvancedSecurity.ts` and `EnterpriseSecurity.ts` looked like real security modules but were stubs: hardcoded thresholds (`requestCount > 500`), `console.log`-only side effects, zero persistence, and `validateZeroTrustRequest()` literally just checked `!!token` — true for any non-empty string.

---

## ARCHITECTURE

```
Firebase Auth (existing identity provider — kept, not replaced)
        │
        ▼  client gets Firebase idToken
POST /api/auth/login { idToken }
        │
        ▼  verifyIdToken() via firebase-admin
        │  + role resolved from custom claims or users/{uid}.role
        ▼
┌─────────────────────────────┐
│        JWTService             │
│  issueTokenPair(uid, role)    │
│   → accessToken  (15 min)     │
│   → refreshToken (30 days,    │
│     hash stored in NexusDB    │
│     for revocation)           │
└──────────────┬───────────────┘
               │
               ▼ on this same login:
┌─────────────────────────────┐      ┌──────────────────────────┐
│  DeviceFingerprintService      │ ───▶ │  AnomalyDetectionEngine    │
│  extract() from headers        │      │  checkLogin():              │
│  (UA, Accept-Language,         │      │   - new device?              │
│   Sec-CH-UA-*, bot patterns)   │      │   - impossible travel?       │
└─────────────────────────────┘      │   - bot signal?              │
                                       └──────────────┬───────────┘
                                                      │ severity ≥ high
                                                      ▼
                                          notifications/{admin} +
                                          security_events/{id}

Every subsequent request:
  Authorization: Bearer <accessToken>
        │
        ▼
  requireAdminAuth / requireAuth
        │  JWTService.verify() — signature + expiry + role
        ▼
  anomalyGuard (global middleware)
        │  AnomalyDetectionEngine.checkRequestRate()
        │  429 if anomalous, else next()
        ▼
  route handler
```

---

## FEATURE DETAIL

### 1. Real JWT Authentication
- HMAC-SHA256 signed tokens, hand-rolled (zero new runtime dependency — uses Node's built-in `crypto`)
- **Access tokens**: 15-minute expiry, carry `{ uid, role, sessionId, type: 'access' }`
- **Refresh tokens**: 30-day expiry, hash persisted to `auth_sessions/{sessionId}` for revocation checking
- `JWTService.verify(token)` checks signature (timing-safe comparison) + expiry — returns `null` on any failure
- `refreshAccessToken(refreshToken)` validates against the stored hash; if the session was revoked or the hash doesn't match (stale/rotated token), refresh fails
- `revokeSession()` / `revokeAllSessions(uid)` — instant logout / incident response, checked on every refresh

### 2. Backward-Compatible Admin Auth
- `requireAdminAuth` now accepts **either**:
  (a) a valid JWT with role `admin` or `ceo`
  (b) the legacy static `OWNER_SECRET` (kept for cron/service-to-service calls — flagged as deprecated for browser use)
- No breaking change for existing automation that used the static secret; new browser sessions use real JWTs

### 3. Customer/Rider Authentication
- New `requireAuth` middleware — **did not exist before Phase M** for non-admin routes
- Verifies any valid JWT (any role), attaches `req.authUser = { uid, role, sessionId }`
- Used by `/api/auth/logout`; available for any future customer/rider-protected route

### 4. Device Fingerprinting
- **No third-party libraries, no canvas/WebGL probing** — purely server-side, derived from request headers
- Fingerprint = SHA-256 of `User-Agent + Accept-Language + Sec-CH-UA-Platform + mobile flag` (deliberately excludes IP so it survives network changes)
- Bot signal detection: known headless/automation UA patterns (Selenium, Puppeteer, Playwright, curl, python-requests, etc.), missing standard browser headers, known-good bots (Googlebot, Slackbot) whitelisted
- `recordAndCheck(uid, fp)` persists to `user_devices/{uid}_{fingerprint}`, returns whether this is a new device

### 5. Anomaly Detection Engine
Replaces `AdvancedSecurity`/`EnterpriseSecurity` stubs with real, persisted detection:

| Detection | Trigger | Severity |
|---|---|---|
| New device login | 2nd+ device fingerprint for a user | low |
| Bot traffic | UA/header signals from `DeviceFingerprintService` | medium |
| Impossible travel | IP network prefix changed + <5min since last login | high |
| Rate anomaly | >120 req/min/user or >300 req/min/IP (sliding window) | high |
| Brute force | ≥8 failed logins in 15 min for one identifier | critical |
| AI misuse | Prompt matches jailbreak/injection phrase list | medium |
| Token/device mismatch | JWT session used from a different fingerprint than issuance | high |

Every detection writes to `security_events` (append-only); `high`/`critical` severity also fires an admin notification via the existing `notifications` collection.

### 6. Global Anomaly Guard Middleware
- Mounted on the full Express app (`app.use(anomalyGuard)`), runs on every request
- Checks request-rate sliding windows per-user and per-IP
- **Fails open**: if the security module itself throws, the request proceeds — instrumentation must never become an outage vector
- Returns `429` only on confirmed rate anomaly; all other checks are detect-and-log, not block-by-default, to avoid false-positive lockouts

### 7. AI Misuse Detection (defense in depth)
- `PromptDefender` (existing `ABACEngine.promptDefenseMiddleware`) already blocks hard threats inline at the request layer
- Phase M adds `AnomalyDetectionEngine.checkAIMisuse()` as a **non-blocking, persisted** secondary check inside the chat route — captures the same pattern even on requests that don't hit the blocking middleware, and gives the admin dashboard a trend view over time instead of only console logs

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `POST /api/auth/login` | POST | Public | Exchange Firebase idToken for Nexus JWT pair |
| `POST /api/auth/refresh` | POST | Public | Exchange refresh token for new access token |
| `POST /api/auth/logout` | POST | JWT | Revoke current session |
| `POST /api/admin/auth/revoke-all/:uid` | POST | Admin | Revoke all sessions for a user |
| `GET /api/admin/security/events` | GET | Admin | Recent security events |
| `GET /api/admin/security/summary` | GET | Admin | Event counts by severity/type |
| `GET /api/admin/security/sessions` | GET | Admin | Active (non-revoked) sessions |

---

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `server.ts` | `requireAdminAuth` upgraded to verify real JWTs (legacy `OWNER_SECRET` kept as fallback); new `requireAuth` middleware; new `anomalyGuard` global middleware; 7 new auth/security routes; AI misuse check wired into chat route |
| `src/lib/security/AdvancedSecurity.ts` | Marked `@deprecated`, points to `AnomalyDetectionEngine` |
| `src/lib/security/EnterpriseSecurity.ts` | Marked `@deprecated`, `validateZeroTrustRequest` doc-flagged as placeholder; points to `JWTService.verify()` |
| `firestore.rules` | Added `auth_sessions`, `user_devices`, `user_last_login`, `security_events` (last two admin-only/append-only) |
| `firestore.indexes.json` | 4 new indexes for session and device lookups |
| `.env.example` | `JWT_SECRET` (falls back to `OWNER_SECRET` if unset) |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose | Mutability |
|---|---|---|
| `auth_sessions` | Refresh-token session records (hash, device binding, revocation flag) | Mutable |
| `user_devices` | Per-user device fingerprint history | Mutable (upsert) |
| `user_last_login` | Last known IP/timestamp per user (impossible-travel baseline) | Mutable |
| `security_events` | Every anomaly/bot/brute-force/AI-misuse detection | Append-only |

---

## WHAT THIS PHASE DELIBERATELY DOES NOT DO

- **No GeoIP database integration** — impossible-travel detection uses an IP-prefix heuristic, not a paid GeoIP lookup. Documented as a known limitation; upgrading to true geography requires a GeoIP provider (e.g. MaxMind), out of scope without that dependency being explicitly requested.
- **No CAPTCHA / browser challenge** — bot detection flags and logs; it does not yet block or challenge. Blocking is a product decision (false positives lock out real customers), left to the business owner to enable once event volume is reviewed in the dashboard.
- **No mTLS / hardware-key auth** — out of scope for this phase; JWT bearer tokens remain the auth mechanism, now done correctly instead of via a static secret.

---

## VERIFICATION CHECKLIST

- [ ] `POST /api/auth/login` with a valid Firebase idToken → returns `{ accessToken, refreshToken, role, uid }`
- [ ] Call any admin route with the new `accessToken` as Bearer → succeeds
- [ ] Wait 16 minutes, retry with the same `accessToken` → 401 (expired)
- [ ] `POST /api/auth/refresh` with the `refreshToken` → new `accessToken` issued
- [ ] `POST /api/auth/logout` → session revoked; subsequent `/api/auth/refresh` with that refresh token → 401
- [ ] Legacy `OWNER_SECRET` bearer token still works on admin routes (backward compatibility)
- [ ] Login from a second "device" (different User-Agent) for the same user → `security_events` gets a `new_device_login` entry
- [ ] Send >120 requests/minute as one user → subsequent requests return `429`
- [ ] Admin → Security Ops → Events tab shows real persisted events, not mock data
- [ ] Admin → Security Ops → Sessions tab → "Revoke" button actually invalidates that user's refresh tokens
