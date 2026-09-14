# PHASE G — OMNICHANNEL OS
## Cross-Channel Identity · Persistent History · Unified Timeline · Customer Journey View · Plugin Architecture

**Date:** June 2026
**Status:** COMPLETE

---

## WHAT WAS BUILT

### New Files (5)

| File | Purpose |
|---|---|
| `src/lib/omnichannel/CustomerIdentityService.ts` | Resolves a customer's identity across all channels into one canonical `customerId` |
| `src/lib/omnichannel/MessageHistoryService.ts` | Persistent message history via NexusDB — replaces in-memory `messageLogs` (max 500, lost on restart) |
| `src/lib/omnichannel/CustomerJourneyService.ts` | 360° customer view — identity + timeline + orders + payments + preferences |
| `src/lib/integrations/adapters/tiktok.ts` | TikTok Business Messaging adapter — new channel, plugin architecture demo |
| `src/components/admin/OmnichannelHubApp.tsx` (rewritten) | Channels tab (real status + live pipeline test) + Customer Journey tab |

---

## ARCHITECTURE

```
                  Inbound message from ANY channel
            (WhatsApp, Telegram, TikTok, web, email, ...)
                              │
                              ▼
              ┌─────────────────────────────────┐
              │  CustomerIdentityService.resolve() │
              │  Strategy: exact channel match     │
              │           → phone match            │
              │           → email match            │
              │           → new customer           │
              └─────────────────┬─────────────────┘
                                 │  canonical customerId
                                 ▼
              ┌─────────────────────────────────┐
              │  ConversationMemory (Phase C)      │
              │  session = omni_<customerId>       │
              │  shared across ALL channels        │
              └─────────────────┬─────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────┐
              │  NexusUnifiedCore.process()        │
              │  (Phase D orchestrated AI call)    │
              └─────────────────┬─────────────────┘
                                 │
                  reply sent back through SAME channel
                                 │
                                 ▼
              ┌─────────────────────────────────┐
              │  MessageHistoryService             │
              │  .recordExchange() -> NexusDB      │
              │  omni_messages collection          │
              └─────────────────┬─────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────┐
              │  CustomerJourneyService             │
              │  Admin: search + 360° timeline      │
              │  (messages + orders + payments       │
              │   + preferences, chronological)      │
              └─────────────────────────────────┘
```

---

## FEATURE DETAIL

### 1. Cross-Channel Customer Identity
- `CustomerIdentityService.resolve({ platform, channelId, displayName, phone, email })`
- **4 resolution strategies, in priority order:**
  1. Exact channel ID match (returning customer, same channel)
  2. Phone number match — normalizes Bangladeshi local `01XXXXXXXXX` → `+8801XXXXXXXXX` for matching across WhatsApp/Rocket/bKash/Nagad
  3. Email match — web account, Facebook, email channel
  4. New customer — generates canonical `cust_<id>`, links first channel
- A customer messaging on WhatsApp, then later Telegram with the same phone, then logging into the web app with the same email — all three resolve to **one** `customerId`
- `merge(keepId, mergeId)` — admin tool for manual deduplication; re-points `conversation_sessions`, merges channel lists

### 2. Message History Persistence (critical gap fix)
- **Before:** `OmniConnectorManager.messageLogs` — in-process array, max 500 entries, **lost on every server restart**
- **After:** `MessageHistoryService` persists every inbound + outbound message to `omni_messages` via NexusDB (Phase E — works on any `DB_PROVIDER`)
- `record()` — single message; `recordExchange()` — inbound+outbound pair in one atomic batch
- `OmniConnectorManager.getMessageLogs()` / `getStats()` are now **async**, read from NexusDB, with a tiny (20-entry) in-memory fallback only if the DB write fails

### 3. Unified Conversation Timeline
- `MessageHistoryService.getTimeline(customerId)` — ALL messages across ALL channels for one customer, chronologically ordered
- This is the "Unified Conversation Timeline" requirement — a support agent sees the full cross-channel conversation history in one feed

### 4. Customer Journey View (360°)
- `CustomerJourneyService.getJourney(customerId)` aggregates:
  - **Identity**: all linked channels, primary phone/email, first/last seen
  - **Timeline**: messages (Phase G) + orders (Phase E `OrderRepository`) + payments (Phase F `payments` collection)
  - **Preferences**: from Phase C `ConversationMemory.getPreferences()`
  - **Summary stats**: order count, total spend
- `CustomerJourneyService.search(query)` — admin searches by phone, email, name, or any channel ID across all customers
- New Admin UI tab: **Omnichannel Hub → Customer Journey** — search + select + view full 360° timeline

### 5. Plugin Architecture (formalized)
- `OmniConnector.ts` header now documents the **zero-change** plugin contract:
  1. Implement `IOmniConnector` in `src/lib/integrations/adapters/<name>.ts`
  2. Register: `OmniConnector.registerConnector(new YourAdapter())`
  3. Add webhook route: `POST /api/webhooks/<name>`
  4. **No changes to OmniConnector, identity resolution, memory, or persistence** — they are channel-agnostic by construction
- **TikTok adapter** ships as the proof: implements `IOmniConnector`, HMAC-SHA256 webhook signature verification (`TIKTOK_APP_SECRET`), registered in `SystemBoot._connectOmni()`, webhook at `POST /api/webhooks/tiktok`

### 6. routeToAI — Identity-Aware Routing (rewritten)
- **Before:** `routeToAI()` called `NexusUnifiedCore.process()` directly with `userId: message.senderId` (raw per-channel ID — no cross-channel memory)
- **After:**
  1. Resolve canonical `customerId` via `CustomerIdentityService`
  2. Load/create `ConversationMemory` session `omni_<customerId>` — shared across channels
  3. Inject conversation context into the AI prompt
  4. Process via `NexusUnifiedCore` (Phase D orchestrated)
  5. Append turns to shared memory
  6. Persist exchange via `MessageHistoryService` keyed by `customerId`

### 7. Admin UI — Live Pipeline Test (replaces mock simulation)
- **Before:** `OmnichannelHubApp` simulation panel wrote directly to `omnichannel_messages` Firestore collection and called `NexusUnifiedCore.process()` with a hardcoded 600-word "Elite Sales Rep" system prompt — bypassing identity resolution, shared memory, and persistent history entirely
- **After:** "Live Pipeline Test" panel calls `POST /api/omni/test-message` → `OmniConnector.processTestMessage()` → the exact same `routeToAI()` path as a real webhook. Messages immediately appear in Customer Journey under the resolved customer
- Channel cards now show **real registered platform status** from `OmniConnector.getRegisteredPlatforms()` instead of a hardcoded mock array

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/omni/customers/search?q=` | GET | Admin | Search customers by phone/email/name/channel ID |
| `GET /api/admin/omni/customers/:customerId/journey` | GET | Admin | Full 360° journey |
| `GET /api/admin/omni/customers/:customerId` | GET | Admin | Raw identity record |
| `POST /api/admin/omni/customers/merge` | POST | Admin | Merge two customer identities |
| `GET /api/admin/omni/customers/:customerId/timeline` | GET | Admin | Unified conversation timeline |
| `POST /api/omni/test-message` | POST | Admin | Live pipeline test (real routing, no mocks) |
| `POST /api/webhooks/tiktok` | POST | Public | TikTok Business Messaging webhook (HMAC verified) |

`GET /api/omni/logs` and `GET /api/omni/stats` are now **async**, reading from `MessageHistoryService`.

---

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `src/lib/integrations/OmniConnector.ts` | Header docs rewritten (plugin architecture + Phase G); added `'tiktok'` to `PlatformType`; `OmniConnectorManager` rewritten — removed `messageLogs`, added `fallbackLogs` (cap 20); `routeToAI()` now identity-aware; `getMessageLogs()`/`getStats()` now async; new `processTestMessage()` |
| `src/lib/core/SystemBoot.ts` | Imports + registers `TikTokAdapter` in `_connectOmni()` |
| `server.ts` | `/api/omni/logs` and `/api/omni/stats` now async; added TikTok webhook route; added 5 Phase G admin routes; added `/api/omni/test-message` |
| `firestore.rules` | Added `customer_identities`, `omni_messages` (append-only) |
| `firestore.indexes.json` | 5 new indexes for identity lookup (phone/email) and message timeline queries |
| `.env.example` | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_BUSINESS_ID`, `TIKTOK_APP_SECRET` |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose | Mutability |
|---|---|---|
| `customer_identities` | Canonical customer ID → linked channels, phone, email | Mutable (channel linking, merge) |
| `omni_messages` | Every inbound/outbound message, keyed by `customerId` | Append-only |

---

## "NO CHANNEL-SPECIFIC BUSINESS LOGIC" — VERIFICATION

`OmniConnector.ts` contains zero `if (platform === 'whatsapp')`-style branches in the routing path. All channel-specific behavior (auth, payload parsing, send formatting) lives entirely inside each platform's adapter file, behind the `IOmniConnector` interface. `routeToAI()`, identity resolution, memory, and persistence operate purely on the `UnifiedMessage` shape — proven by `processTestMessage()` working identically for any `PlatformType` without per-platform code.

---

## VERIFICATION CHECKLIST

- [ ] Admin → Omnichannel Hub → Channels tab shows real connected platforms (not hardcoded mock list)
- [ ] Send a "Live Pipeline Test" message on WhatsApp → appears in `omni_messages` with a resolved `customerId`
- [ ] Send another test message on Telegram using the same phone number (via `metadata.phone`) → resolves to the **same** `customerId`
- [ ] Admin → Customer Journey → search by phone → finds the customer, shows both channels linked
- [ ] Customer Journey timeline shows messages from both channels in one chronological feed
- [ ] Restart the server → `GET /api/omni/logs` still returns history (no longer lost — was in-memory before)
- [ ] Set `TIKTOK_*` env vars → TikTok appears as "connected" in Channels tab
- [ ] `POST /api/webhooks/tiktok` with valid HMAC signature → message routes through pipeline; invalid signature → 403
- [ ] `POST /api/admin/omni/customers/merge` → two duplicate identities become one, conversation sessions re-pointed
