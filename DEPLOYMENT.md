# Nexus OS — Deployment Guide

## Prerequisites
- Node.js 22+
- Docker & Docker Compose (for production)
- Firebase project with Firestore & Auth enabled
- Stripe account (for payments)
- Gemini API key (Google AI Studio)

---

## 1. Environment Setup

```bash
# Copy the example env file
cp .env.example .env

# Fill in your keys
nano .env
```

### Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google Gemini AI key (from aistudio.google.com) |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key (sk_live_... for production) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | From Stripe Dashboard → Webhooks |
| `APP_URL` | ✅ | Your public URL e.g. `https://nexusos.com` |
| `OWNER_SECRET` | ✅ | A strong random secret for admin memory writes |
| `OPENAI_API_KEY` | Optional | For OpenAI GPT fallback (server-side only) |
| `GROQ_API_KEY` | Optional | For Groq/LLaMA fallback (server-side only) |
| `HUGGINGFACE_API_KEY` | Optional | For HuggingFace models (server-side only) |
| `ALLOWED_ORIGINS` | Optional | CORS origins, comma-separated. Default: localhost |

---

## 2. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a project (or use existing)
3. Enable **Firestore Database** and **Authentication** (Google + Phone providers)
4. Update `firebase-applet-config.json` with your project credentials
5. Deploy Firestore rules: `firebase deploy --only firestore:rules`

### Set Admin Role
To give your account admin access, run in Firestore console:
```
Collection: users
Document ID: <your Firebase UID>
Fields: { role: "admin" }
```

---

## 3. Local Development

```bash
npm install
npm run dev
# App runs on http://localhost:3000
```

---

## 4. Production with Docker

```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

---

## 5. Stripe Webhook Setup

1. Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
2. For local testing: `stripe listen --forward-to localhost:3000/api/stripe-webhook`
3. For production: Add webhook endpoint in Stripe Dashboard:
   - URL: `https://your-domain.com/api/stripe-webhook`
   - Events: `checkout.session.completed`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET` in `.env`

---

## 6. Hosting Options

### Railway (Recommended — simplest)
```bash
railway login
railway new
railway up
railway variables set $(cat .env | xargs)
```

### Render
- Connect GitHub repo
- Set environment: `Docker`
- Add all env vars in dashboard

### VPS (DigitalOcean / Hetzner)
```bash
git clone <your-repo>
cd Genius-2
cp .env.example .env && nano .env
docker compose up -d --build
# Setup Nginx reverse proxy + SSL with Certbot
```

---

## 7. User Role Management

Roles are stored in Firestore `users/{uid}` document:
- `customer` — default for new sign-ups
- `rider` — delivery agents
- `rep` — customer support reps
- `vendor` — store vendors
- `admin` — full admin OS access
- `ceo` — CEO vault access

Set roles via Admin OS → User Manager, or directly in Firestore.

---

## 8. Omnichannel Setup (Social Media)

After deployment, set up each platform's webhook to point to your server:

### WhatsApp
1. Meta Developers → Your App → WhatsApp → Configuration
2. Webhook URL: `https://your-domain.com/api/webhooks/whatsapp`
3. Verify Token: (same value as `WHATSAPP_VERIFY_TOKEN` in .env)
4. Subscribe to: `messages`

### Facebook Messenger
1. Meta Developers → Your App → Messenger → Webhooks
2. Webhook URL: `https://your-domain.com/api/webhooks/facebook`
3. Verify Token: (same value as `FACEBOOK_VERIFY_TOKEN`)
4. Subscribe to: `messages`, `messaging_postbacks`

### Instagram DM
1. Same Meta App → Instagram → Webhooks
2. Webhook URL: `https://your-domain.com/api/webhooks/instagram`
3. Subscribe to: `messages`

### Telegram
After setting `TELEGRAM_BOT_TOKEN`, run once:
```
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-domain.com/api/webhooks/telegram"
```

### Discord
1. Discord Developer Portal → Your App → Interactions Endpoint URL:
   `https://your-domain.com/api/webhooks/discord`

### Email (Mailgun recommended)
1. Mailgun → Routes → Create Route
2. Match: all incoming to your domain
3. Forward to: `https://your-domain.com/api/webhooks/email`

---

## 9. Adding a New AI Model

```typescript
// In src/lib/core/SystemBoot.ts — add to AI providers section:
import { MyNewAdapter } from './adapters/MyNewAdapter';
const myModel = new MyNewAdapter();
GlobalProviderRegistry.register('my-model-id', myModel, {
  costTier: 'low',          // free | low | medium | high | enterprise
  intelligence: 'advanced', // basic | intermediate | advanced | expert
  speed: 'fast',            // instant | fast | balanced | slow
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: false,
  contextWindowLength: 32768,
  description: 'My custom model',
});
```

The routing system will automatically include it in model selection.
To manually pin a role to a model: Admin OS → AI Config → Role Overrides.

