# 🧠 NEXUS OS — সম্পূর্ণ সিস্টেম ডকুমেন্টেশন
**Version: 3.0 FINAL | Last Updated: 2026**

---

## 📋 সিস্টেম কী?

Nexus OS একটি AI-চালিত সর্বজনীন ব্যবসায়িক প্ল্যাটফর্ম। এটি একইসাথে:
- **E-Commerce Storefront** — পণ্য বিক্রি, কার্ট, পেমেন্ট
- **Admin Command Center** — সম্পূর্ণ ব্যবসা পরিচালনা
- **Omnichannel Hub** — সব social media থেকে customer support
- **AI Orchestration Layer** — একাধিক AI model auto-routing
- **Delivery & Logistics** — rider tracking, route optimization
- **Self-Healing Infrastructure** — নিজে সমস্যা ধরে নিজে ঠিক করে

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACES                       │
│  Landing Page │ Storefront │ Admin OS │ Rider │ CEO Vault │
└──────────────────────┬──────────────────────────────────┘
                       │ React + Vite (TypeScript)
┌──────────────────────▼──────────────────────────────────┐
│               EXPRESS SERVER (server.ts)                 │
│  REST API │ Webhooks │ SSE Streaming │ Static Files      │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │AI Engine │  │ Storage  │  │  Omnichannel │
  │ Registry │  │ Firestore│  │    Hub       │
  │ 7 models │  │+IndexedDB│  │ 7 platforms  │
  └──────────┘  └──────────┘  └──────────────┘
        │
  ┌─────▼──────────────────────────────────┐
  │         AUTOMATION LAYER               │
  │  AutomationEngine + NotificationEngine │
  │  SelfHealingEngine + FraudDetection   │
  └────────────────────────────────────────┘
```

---

## 📁 Folder Structure

```
Genius-2-FINAL/
├── server.ts                    ← Express server (entry point)
├── src/
│   ├── App.tsx                  ← React router & persona switcher
│   ├── main.tsx                 ← React mount + system boot
│   ├── firebase.ts              ← Firebase SDK init
│   ├── contexts/
│   │   ├── AuthContext.tsx      ← Firebase Auth + role management
│   │   └── FeatureContext.tsx   ← Feature flags
│   ├── pages/
│   │   ├── LandingPage.tsx      ← Public homepage
│   │   ├── Marketplace.tsx      ← Storefront (/store/:storeId)
│   │   ├── AdminOS.tsx          ← Admin command center (/admin)
│   │   ├── RiderDashboard.tsx   ← Delivery agent (/rider)
│   │   ├── RepDashboard.tsx     ← Support rep (/rep)
│   │   └── LogisticsTrackingPage.tsx ← Batch logistics (/logistics)
│   ├── components/
│   │   ├── admin/               ← 30+ admin panel components
│   │   └── dashboard/CEODashboard.tsx
│   ├── apps/
│   │   └── control-center/DesktopShell.tsx ← Windowed OS (/os)
│   └── lib/
│       ├── ai/
│       │   ├── providers/ProviderRegistry.ts  ← Dynamic AI model registry
│       │   └── Orchestrator.ts               ← AI request routing
│       ├── core/
│       │   ├── SystemBoot.ts                 ← Startup: register all adapters
│       │   ├── NexusUnifiedCore.ts           ← Central AI processing
│       │   ├── SelfHealingEngine.ts          ← ← NEW: Auto-diagnosis & repair
│       │   ├── CostDominationEngine.ts       ← Task→tier selection
│       │   ├── MemoryCore.ts                 ← Firestore-backed memory
│       │   └── adapters/
│       │       ├── GeminiAdapter.ts          ← Google Gemini
│       │       ├── GroqAdapter.ts            ← Groq (real streaming)
│       │       ├── OpenAIAdapter.ts          ← OpenAI (real streaming)
│       │       └── HuggingFaceAdapter.ts     ← HuggingFace
│       ├── integrations/
│       │   ├── OmniConnector.ts              ← Central omnichannel hub
│       │   └── adapters/
│       │       ├── WhatsAppAdapter.ts        ← WhatsApp Business API
│       │       ├── facebook.ts               ← Messenger + Instagram
│       │       ├── telegram.ts               ← Telegram Bot
│       │       ├── discord.ts                ← Discord Bot
│       │       ├── email.ts                  ← SMTP + inbound webhook
│       │       └── WebChatAdapter.ts         ← Built-in web chat
│       ├── notifications/
│       │   └── NotificationEngine.ts         ← FCM Push + Twilio SMS + Email
│       ├── automation/
│       │   └── AutomationEngine.ts           ← Event-driven automation
│       ├── security/
│       │   └── FraudDetectionEngine.ts       ← Velocity + IP fraud checks
│       ├── business/
│       │   ├── OrderEngine.ts                ← Order lifecycle
│       │   └── PaymentEngine.ts              ← Stripe integration
│       └── storage/
│           ├── StorageRegistry.ts            ← Primary/fallback storage
│           ├── adapters/FirebaseAdapter.ts   ← Firestore
│           └── adapters/IndexedDBAdapter.ts  ← Browser fallback
├── firestore.rules              ← Production security rules
├── firestore.indexes.json       ← All compound query indexes
├── Dockerfile                   ← Multi-stage Docker build
├── docker-compose.yml           ← Production deployment
├── .env.example                 ← All required env variables
└── DEPLOYMENT.md                ← Step-by-step deploy guide
```

---

## 🤖 AI Providers — কীভাবে কাজ করে

### Auto-Routing Logic
```
User Message → CostDominationEngine.classifyComplexity()
                      ↓
              simple / moderate / complex / expert
                      ↓
              ProviderRegistry.findBestProvider()
              (checks: tier, intelligence, speed, health, role override)
                      ↓
              Best available model → Response
```

### Registered Models (SystemBoot.ts)
| ID | Model | Tier | Speed | Intelligence |
|---|---|---|---|---|
| `gemini-flash` | Gemini 2.5 Flash | Free | Fast | Expert |
| `groq-llama-fast` | LLaMA 3.1 8B | Free | Instant | Intermediate |
| `groq-llama-pro` | LLaMA 3.3 70B | Low | Fast | Expert |
| `openai-gpt4o-mini` | GPT-4o-mini | Low | Fast | Advanced |
| `openai-gpt4o` | GPT-4o | High | Balanced | Expert |
| `huggingface-llama` | HF Open Models | Free | Slow | Intermediate |
| `local-offline` | Gemma (WebLLM) | Free | Slow | Basic |

### নতুন model যোগ করা
```typescript
// src/lib/core/SystemBoot.ts তে যোগ করো:
import { MyAdapter } from './adapters/MyAdapter';

GlobalProviderRegistry.register('my-model', new MyAdapter(), {
  costTier: 'low',        // free | low | medium | high | enterprise
  intelligence: 'advanced', // basic | intermediate | advanced | expert
  speed: 'fast',           // instant | fast | balanced | slow
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: false,
  contextWindowLength: 32768,
  description: 'My custom model',
});
// ব্যস! Auto-routing নিজেই বুঝে নেবে।
```

### Manual Role Override (Admin UI থেকে)
```
Admin OS → AI Config Panel → Role Overrides
→ "customer_support" → "groq-llama-fast"  (সস্তা + দ্রুত)
→ "ceo_reports"      → "openai-gpt4o"     (সবচেয়ে ভালো)
→ DELETE override    → ফিরে Auto-routing
```

---

## 📱 Omnichannel Hub — কীভাবে কাজ করে

```
WhatsApp/Telegram/Facebook/etc. → Webhook → OmniConnector
                                                  ↓
                                         routeToAI() 
                                         (NexusUnifiedCore)
                                                  ↓
                                         AI Response
                                                  ↓
                                   Same platform-এ reply পাঠানো
                                   + Admin log-এ সেভ
```

### Intent Detection
প্রতিটি message থেকে auto-detect:
- `new_order` — কিছু কিনতে চায়
- `order_inquiry` — অর্ডার status জানতে চায়
- `complaint` — সমস্যা জানাচ্ছে
- `price_inquiry` — দাম জানতে চায়
- `general` — সাধারণ কথা

### নতুন Platform যোগ করা
```typescript
// 1. src/lib/integrations/adapters/myplatform.ts বানাও
export class MyPlatformAdapter implements IOmniConnector {
  platform: PlatformType = 'myplatform';
  async connect() { ... }
  async sendMessage(userId, content) { ... }
  onMessage(handler) { ... }
  async handleWebhookPayload(payload) { ... }
}

// 2. SystemBoot.ts তে register করো
const myPlatform = new MyPlatformAdapter();
await myPlatform.connect();
OmniConnector.registerConnector(myPlatform);

// 3. server.ts তে webhook route যোগ করো
app.post("/api/webhooks/myplatform", async (req, res) => {
  const adapter = OmniConnector.getConnector("myplatform");
  await adapter?.handleWebhookPayload(req.body);
  res.sendStatus(200);
});
```

---

## 🔔 Notification System

```
AutomationEngine.triggerEvent('order.created', { orderId, userId })
        ↓
NotificationEngine.notify({
  channels: ['push', 'in_app', 'sms', 'email']
})
        ↓
  FCM Push → Firebase Cloud Messaging → User phone
  In-App  → Firestore notifications collection → UI bell
  SMS     → Twilio → User phone number
  Email   → SMTP → User email
```

---

## 🔐 Security Architecture

### Firestore Rules
- `users` — শুধু নিজের data, role change শুধু admin
- `orders` — owner / rider / admin / rep
- `products` — public read, admin write
- `fraud_flags` — শুধু admin
- `notifications` — শুধু নিজের

### API Security
- Admin routes → `requireAdminAuth` middleware (Bearer token)
- Facebook webhook → HMAC `X-Hub-Signature-256` verification
- Stripe webhook → signature verification
- Rate limiting → 100 req/15min per IP

### SelfHealingEngine — Intrusion Detection
- প্রতি 5 মিনিটে full scan
- কোনো IP যদি 5 মিনিটে >200 request করে → alert
- Admin endpoints এ >50 request/5min → alert
- OWNER_SECRET default value থাকলে → critical alert
- API key পরিবর্তন হলে → change alert

---

## 🏃 User Roles

| Role | Access | Path |
|---|---|---|
| `customer` | Storefront, orders | `/store/*` |
| `rider` | Delivery dashboard | `/rider` |
| `rep` | Customer support | `/rep` |
| `vendor` | Own store management | `/store/vendor-*` |
| `admin` | Full Admin OS | `/admin`, `/os` |
| `ceo` | CEO Vault + Admin | `/ceo`, `/admin` |

**Role assign করতে:** Firestore → `users/{uid}` → `{ role: "admin" }`

---

## 📊 API Endpoints Reference

### Public
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | System health (score + status) |
| POST | `/api/chat` | AI chat |
| POST | `/api/create-checkout-session` | Stripe checkout |

### Webhooks (Social Platforms)
| Method | Path | Platform |
|---|---|---|
| GET/POST | `/api/webhooks/whatsapp` | WhatsApp |
| GET/POST | `/api/webhooks/facebook` | Messenger |
| POST | `/api/webhooks/instagram` | Instagram DM |
| POST | `/api/webhooks/telegram` | Telegram |
| POST | `/api/webhooks/discord` | Discord |
| POST | `/api/webhooks/email` | Email (Mailgun) |
| POST | `/api/stripe-webhook` | Stripe payments |

### Admin (Bearer: OWNER_SECRET)
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/diagnostic` | Full system diagnostic |
| GET | `/api/admin/diagnostic/last` | Last snapshot |
| POST | `/api/admin/trigger-event` | Trigger automation event |
| POST | `/api/admin/run-daily-jobs` | Run daily jobs now |
| GET | `/api/omni/logs` | Message logs |
| GET | `/api/omni/stats` | Omnichannel stats |
| POST | `/api/omni/send` | Send manual message |
| GET | `/api/ai/providers` | AI provider health |
| POST | `/api/ai/providers/role-override` | Pin role to provider |

---

## 🚀 Quick Start

```bash
# 1. Setup
cp .env.example .env
# Fill in API keys in .env

# 2. Firebase — first admin
# Firestore → users/{your-uid} → { role: "admin" }

# 3. Deploy indexes & rules
firebase deploy --only firestore:rules,firestore:indexes

# 4. Development
npm install
npm run dev     # localhost:3000

# 5. Production
docker compose up -d --build
```

