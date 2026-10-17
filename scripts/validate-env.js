#!/usr/bin/env node
/**
 * scripts/validate-env.js
 * NexusOS — Pre-flight Environment Validator
 *
 * Runs automatically before the server starts (see "start" in package.json):
 *   node scripts/validate-env.js && tsx server.ts
 *
 * Exit code 0 = the server can start (it may still print warnings)
 * Exit code 1 = something is so wrong that starting would be unsafe or pointless
 *
 * Design rule: only block the start for things that make the server UNSAFE
 * (no admin secret / no signing key in production) or UNABLE to store data
 * (database chosen but its address is missing). Everything else — payment
 * gateways, AI keys, e-mail, Firebase service account — is reported clearly
 * but never prevents the shop from opening. The owner can add those later
 * from the Railway "Variables" tab without redeploying code.
 */

import dotenv from 'dotenv';

dotenv.config();

const COLORS = {
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
};

const c = (color, str) => `${COLORS[color]}${str}${COLORS.reset}`;
const isProd = process.env.NODE_ENV === 'production';

console.log(`\n${c('bold', '╔══════════════════════════════════════════════════╗')}`);
console.log(`${c('bold', '║  NexusOS — Pre-flight Environment Validator       ║')}`);
console.log(`${c('bold', '╚══════════════════════════════════════════════════╝')}\n`);
console.log(`Mode: ${isProd ? 'PRODUCTION' : 'development'}\n`);

const dbProvider = (process.env.DB_PROVIDER || 'firestore').toLowerCase();

// ── Variable definitions ──────────────────────────────────────────────────────
// [envKey, severity: 'critical'|'warning'|'info', description]
// "critical" means the server is unsafe/unusable without it.
const checks = [
  ['OWNER_SECRET',           isProd ? 'critical' : 'warning', 'Owner/admin secret (the master key for the admin panel) — generate: openssl rand -hex 32'],
  ['JWT_SECRET',             isProd ? 'critical' : 'warning', 'Login-token signing key — generate: openssl rand -hex 64'],

  // Firebase service account: the server needs it to read/write the SAME database the
  // storefront uses (orders, products, users) and to verify logins. Without it the shop
  // pages still open, but secure checkout / payment confirmation / admin APIs stay off.
  ['FIREBASE_PROJECT_ID',    'warning',  'Firebase project ID (service account) — needed for secure checkout & order confirmation'],
  ['FIREBASE_CLIENT_EMAIL',  'warning',  'Firebase service-account e-mail'],
  ['FIREBASE_PRIVATE_KEY',   'warning',  'Firebase service-account private key'],

  ['GEMINI_API_KEY',         'info',     'Gemini AI (free) — get at ai.google.dev'],
  ['GROQ_API_KEY',           'info',     'Groq AI (free) — get at console.groq.com'],

  ['STRIPE_SECRET_KEY',      'info',     'Stripe card payments (optional — Cash on Delivery works without it)'],
  ['STRIPE_WEBHOOK_SECRET',  'info',     'Stripe webhook signing secret (needed only if Stripe is enabled)'],
  ['BKASH_APP_KEY',          'info',     'bKash payment gateway (optional — manual bKash/Nagad number payment works without it)'],
  ['NAGAD_MERCHANT_ID',      'info',     'Nagad payment gateway (optional)'],

  ['WHATSAPP_TOKEN',         'info',     'WhatsApp Business API'],
  ['TELEGRAM_BOT_TOKEN',     'info',     'Telegram bot'],
  ['SMTP_HOST',              'info',     'E-mail (SMTP) host'],

  ['REDIS_URL',              'info',     'Redis cache (optional but recommended for speed with many users)'],
  ['APP_URL',                'warning',  'Public web address of the shop (e.g. https://yourshop.up.railway.app)'],
];

let criticalMissing = 0;
let warningMissing  = 0;
const results = { critical: [], warning: [], info: [], present: [] };

for (const [key, severity, desc] of checks) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    results[severity].push({ key, desc });
    if (severity === 'critical') criticalMissing++;
    if (severity === 'warning')  warningMissing++;
  } else {
    results.present.push({ key, severity });
  }
}

// ── Strength checks on the two secrets (production only) ──────────────────────
const weak = [];
for (const key of ['OWNER_SECRET', 'JWT_SECRET']) {
  const v = process.env[key];
  if (v && v.trim() !== '' && isProd && v.length < 24) weak.push(key);
}

// ── Print present vars ────────────────────────────────────────────────────────
if (results.present.length > 0) {
  console.log(c('green', `✅ Present (${results.present.length}):`));
  for (const { key, severity } of results.present) {
    const badge = severity === 'critical' ? c('red', '[CRITICAL]') : severity === 'warning' ? c('yellow', '[WARN]') : c('blue', '[INFO]');
    console.log(`   ${badge} ${key}`);
  }
  console.log('');
}

// ── Print critical missing ────────────────────────────────────────────────────
if (results.critical.length > 0) {
  console.log(c('red', `❌ CRITICAL — Missing (${results.critical.length}) — the server will NOT start:`));
  for (const { key, desc } of results.critical) {
    console.log(`   ${c('red', '●')} ${c('bold', key)}`);
    console.log(`     → ${desc}`);
  }
  console.log('');
}

if (weak.length > 0) {
  console.log(c('yellow', `⚠️  Weak secret(s): ${weak.join(', ')} — use at least 32 random characters in production.`));
  console.log('');
}

// ── Print warning missing ─────────────────────────────────────────────────────
if (results.warning.length > 0) {
  console.log(c('yellow', `⚠️  WARNING — Missing (${results.warning.length}) — the shop starts, but some features stay off:`));
  for (const { key, desc } of results.warning) {
    console.log(`   ${c('yellow', '●')} ${key}`);
    console.log(`     → ${desc}`);
  }
  console.log('');
}

// ── Print info missing ────────────────────────────────────────────────────────
if (results.info.length > 0) {
  console.log(c('blue', `ℹ️  INFO — Optional (${results.info.length}):`));
  for (const { key } of results.info) {
    console.log(`   ${c('blue', '●')} ${key}`);
  }
  console.log('');
}

// ── DB Provider check ─────────────────────────────────────────────────────────
console.log(c('cyan', `📦 DB_PROVIDER: ${dbProvider}`));
if (dbProvider === 'postgres' && !process.env.POSTGRES_URL) {
  console.log(c('red', '   ❌ DB_PROVIDER=postgres but POSTGRES_URL is not set!'));
  criticalMissing++;
} else if (dbProvider === 'supabase' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.log(c('red', '   ❌ DB_PROVIDER=supabase but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing!'));
  criticalMissing++;
} else if (dbProvider === 'mongodb' && !process.env.MONGODB_URI) {
  console.log(c('red', '   ❌ DB_PROVIDER=mongodb but MONGODB_URI is not set!'));
  criticalMissing++;
} else if (dbProvider === 'firestore') {
  const haveAdmin = process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY
    || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (haveAdmin) {
    console.log(c('green', '   ✅ Firestore (service account found)'));
  } else {
    console.log(c('yellow', '   ⚠️  DB_PROVIDER=firestore but no Firebase service account is set.'));
    console.log(c('yellow', '      The server will run in LIMITED mode (no secure checkout / payment confirmation).'));
    warningMissing++;
  }
} else {
  console.log(c('green', `   ✅ DB config looks valid for provider: ${dbProvider}`));
}
if (isProd && dbProvider === 'memory') {
  console.log(c('red', '   ❌ DB_PROVIDER=memory in production would lose ALL data on every restart!'));
  criticalMissing++;
}
console.log('');

// ── AI Provider check ─────────────────────────────────────────────────────────
const aiProviders = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY'].filter(k => process.env[k]);
console.log(c('cyan', `🤖 AI Providers active: ${aiProviders.length}`));
if (aiProviders.length === 0) {
  console.log(c('yellow', '   ⚠️  No AI provider keys found. System will use offline fallback only.'));
  console.log(c('yellow', '   → Get free keys: GEMINI at ai.google.dev, GROQ at console.groq.com'));
} else {
  console.log(c('green', `   ✅ Active: ${aiProviders.map(k => k.replace('_API_KEY', '')).join(', ')}`));
}
console.log('');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('─'.repeat(52));
if (criticalMissing > 0) {
  console.log(c('red', `\n🚨 ${criticalMissing} CRITICAL problem(s). The server will not start until they are fixed.`));
  console.log(c('red', '   সার্ভার চালু হবে না — উপরের লাল লাইনগুলো Railway → Variables-এ যোগ/ঠিক করুন।'));
  console.log(c('yellow', '\n📋 Action: add the missing variables in Railway → your service → Variables, then redeploy.\n'));
  process.exit(1);
} else if (warningMissing > 0) {
  console.log(c('yellow', `\n⚠️  ${warningMissing} warning(s). The server starts, but some features are limited.`));
  console.log(c('green', '✅ No blocking problems.\n'));
  process.exit(0);
} else {
  console.log(c('green', '\n🎉 All checks passed! Ready for production.\n'));
  process.exit(0);
}
