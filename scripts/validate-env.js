#!/usr/bin/env node
/**
 * scripts/validate-env.js
 * NexusOS — Pre-flight Environment Validator
 *
 * Run before starting the server:
 *   node scripts/validate-env.js
 *
 * Exit code 0 = all critical vars present
 * Exit code 1 = critical vars missing (server WILL fail)
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

console.log(`\n${c('bold', '╔══════════════════════════════════════════════════╗')}`);
console.log(`${c('bold', '║  NexusOS — Pre-flight Environment Validator       ║')}`);
console.log(`${c('bold', '╚══════════════════════════════════════════════════╝')}\n`);

// ── Variable definitions ──────────────────────────────────────────────────────
const checks = [
  // [envKey, severity: 'critical'|'warning'|'info', description]
  ['OWNER_SECRET',           'critical', 'Admin API secret — generate: openssl rand -hex 32'],
  ['JWT_SECRET',             'critical', 'JWT signing key — generate: openssl rand -hex 64'],
  ['FIREBASE_PROJECT_ID',    'critical', 'Firebase project ID'],
  ['FIREBASE_CLIENT_EMAIL',  'critical', 'Firebase service account email'],
  ['FIREBASE_PRIVATE_KEY',   'critical', 'Firebase service account private key'],

  ['GEMINI_API_KEY',         'warning',  'Gemini AI (free) — get at ai.google.dev'],
  ['GROQ_API_KEY',           'warning',  'Groq AI (free) — get at console.groq.com'],

  ['STRIPE_SECRET_KEY',      'warning',  'Stripe payments (international)'],
  ['BKASH_APP_KEY',          'info',     'bKash mobile payments (Bangladesh)'],
  ['NAGAD_MERCHANT_ID',      'info',     'Nagad mobile payments (Bangladesh)'],

  ['WHATSAPP_TOKEN',         'info',     'WhatsApp Business API'],
  ['TELEGRAM_BOT_TOKEN',     'info',     'Telegram bot'],
  ['SMTP_HOST',              'warning',  'Email SMTP host'],

  ['REDIS_URL',              'info',     'Redis cache (optional but recommended)'],
  ['APP_URL',                'warning',  'Production URL (e.g. https://yourdomain.com)'],
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
  console.log(c('red', `❌ CRITICAL — Missing (${results.critical.length}) — Server WILL NOT start correctly:`));
  for (const { key, desc } of results.critical) {
    console.log(`   ${c('red', '●')} ${c('bold', key)}`);
    console.log(`     → ${desc}`);
  }
  console.log('');
}

// ── Print warning missing ─────────────────────────────────────────────────────
if (results.warning.length > 0) {
  console.log(c('yellow', `⚠️  WARNING — Missing (${results.warning.length}) — Some features will be disabled:`));
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
const dbProvider = process.env.DB_PROVIDER ?? 'firestore';
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
} else {
  console.log(c('green', `   ✅ DB config looks valid for provider: ${dbProvider}`));
}
console.log('');

// ── AI Provider check ─────────────────────────────────────────────────────────
const aiProviders = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY'].filter(k => process.env[k]);
console.log(c('cyan', `🤖 AI Providers active: ${aiProviders.length}`));
if (aiProviders.length === 0) {
  console.log(c('yellow', '   ⚠️  No AI provider keys found. System will use offline fallback only.'));
  console.log(c('yellow', '   → Get free keys: GEMINI at ai.google.dev, GROQ at console.groq.com'));
  warningMissing++;
} else {
  console.log(c('green', `   ✅ Active: ${aiProviders.map(k => k.replace('_API_KEY', '')).join(', ')}`));
}
console.log('');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('─'.repeat(52));
if (criticalMissing > 0) {
  console.log(c('red', `\n🚨 ${criticalMissing} CRITICAL variable(s) missing.`));
  console.log(c('red', '   Server will fail to start or have broken functionality.'));
  console.log(c('yellow', '\n📋 Action: cp .env.example .env  →  fill in missing values\n'));
  process.exit(1);
} else if (warningMissing > 0) {
  console.log(c('yellow', `\n⚠️  ${warningMissing} warning(s). Server will start but some features may be limited.`));
  console.log(c('green', '✅ All critical variables are present.\n'));
  process.exit(0);
} else {
  console.log(c('green', '\n🎉 All checks passed! Ready for production.\n'));
  process.exit(0);
}
