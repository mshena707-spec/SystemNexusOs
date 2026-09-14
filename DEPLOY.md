# NexusOS — Production Deployment Guide

> **Status (verified):** Architecture clean · ADR-0001 compliant · Firebase Admin centralized

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | ≥ 20 LTS | `node -v` |
| npm | ≥ 10 | `npm -v` |
| Firebase project | Admin SDK enabled | console.firebase.google.com |
| At least one AI key | Gemini (free) or Groq (free) | ai.google.dev / console.groq.com |

---

## Quick Start (5 minutes)

```bash
# 1. Clone / extract the project
cd nexusos

# 2. Install dependencies
npm install

# 3. Create .env from template
npm run setup
# → opens .env — fill in your Firebase credentials and AI keys

# 4. Validate environment
npm run validate:env
# → must show 0 critical errors before proceeding

# 5. Start development server
npm run dev
# → http://localhost:3000

# 6. Check health
curl http://localhost:3000/api/health
```

---

## Environment Setup

### Minimum Required (.env)

```bash
# Security (REQUIRED)
OWNER_SECRET=<openssl rand -hex 32>
JWT_SECRET=<openssl rand -hex 64>

# Firebase (REQUIRED — server auth + database)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n"

# AI — minimum one of:
GEMINI_API_KEY=<free at ai.google.dev>
GROQ_API_KEY=<free at console.groq.com>
```

### Get Firebase Service Account

1. Firebase Console → Project Settings → Service Accounts
2. Click **Generate new private key** → download JSON
3. Copy values into `.env`:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (keep the `\n` escapes)

---

## Database Provider

| Provider | `DB_PROVIDER` | When to use |
|----------|--------------|-------------|
| Firestore | `firestore` (default) | Production, real-time |
| PostgreSQL | `postgres` | Data warehouse, heavy queries |
| Supabase | `supabase` | Postgres + REST + Realtime |
| MongoDB | `mongodb` | Document-heavy workloads |
| In-Memory | `memory` | Unit testing, CI/CD |

```bash
# PostgreSQL example
DB_PROVIDER=postgres
POSTGRES_URL=postgresql://user:pass@host:5432/nexusdb
```

---

## Production Deployment

### Option A — Node.js on VPS (Recommended)

```bash
# Install PM2 process manager
npm install -g pm2

# Start with PM2 (restarts on crash, logs to file)
pm2 start "npm run start" --name nexusos

# Enable startup on reboot
pm2 save && pm2 startup

# Monitor logs
pm2 logs nexusos

# Check health
curl https://yourdomain.com/api/health
```

### Option B — Docker

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start"]
```

```bash
docker build -t nexusos .
docker run -p 3000:3000 --env-file .env nexusos
```

### Option C — Railway / Render / Fly.io

```bash
# Set all .env vars in the platform dashboard, then:
railway up
# or:
render deploy
```

---

## Health Checks

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Full system health (DB, AI, memory) |
| `GET /api/health/live` | Kubernetes liveness probe |
| `GET /api/health/ready` | Kubernetes readiness probe |

```bash
# Example response
{
  "status": "healthy",
  "checks": {
    "database": { "status": "up", "provider": "Firestore", "latencyMs": 45 },
    "ai":       { "status": "up", "providers": 4 },
    "server":   { "status": "up", "memoryMB": 128 }
  }
}
```

---

## Payment Setup

### bKash (Bangladesh)

1. Create merchant account at [pg.bka.sh](https://pg.bka.sh)
2. Get `App Key`, `App Secret`, `Username`, `Password`
3. Set `BKASH_BASE_URL=https://tokenized.pay.bka.sh/v1.2.0-beta` (live)

### Stripe (International)

1. Dashboard → Developers → API Keys
2. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`

---

## Omnichannel Setup

### WhatsApp Business API

1. Meta Business → WhatsApp → Add phone number
2. Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`
3. Set webhook URL: `https://yourdomain.com/api/webhook/whatsapp`

### Telegram Bot

1. Message `@BotFather` → `/newbot`
2. Copy token → `TELEGRAM_BOT_TOKEN`
3. Set webhook: `curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://yourdomain.com/api/webhook/telegram"`

---

## Post-Deployment Checklist

- [ ] `npm run validate:env` shows 0 critical errors
- [ ] `GET /api/health` returns `"status": "healthy"`
- [ ] Admin login works via Firebase Auth
- [ ] Test order creation end-to-end
- [ ] Test payment flow (bKash sandbox)
- [ ] Monitor logs: `pm2 logs nexusos`
- [ ] Set up monitoring: `SENTRY_DSN` in .env

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `firebase-admin: no credentials` | Set `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PROJECT_ID` |
| `DB_PROVIDER=firestore` but offline | Check Firebase project billing (Firestore requires Blaze plan for production) |
| AI returns empty | Check `GEMINI_API_KEY` or `GROQ_API_KEY` |
| Port 3000 in use | `PORT=4000 npm run dev` |
| `OWNER_SECRET` mismatch | Regenerate: `openssl rand -hex 32` |

---

*Last updated: Part 15 — ADR-0001 compliant, Firebase Admin centralized, health endpoints production-grade.*
