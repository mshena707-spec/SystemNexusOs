/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              NEXUS CENTRALIZED CONFIGURATION SYSTEM          ║
 * ║  Single source of truth for all system configuration.        ║
 * ║  Validates on startup. Never hardcodes secrets.              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE PRINCIPLE:
 *   All config comes from environment variables.
 *   All config is validated at startup.
 *   All config is typed — no raw process.env access anywhere else.
 *
 * USAGE:
 *   import { NexusConfig } from '@/lib/core/config/NexusConfig';
 *   const key = NexusConfig.ai.geminiApiKey;
 */

const IS_SERVER = typeof window === 'undefined';
declare const process: { env: Record<string, string | undefined> };
const env = IS_SERVER ? (process?.env ?? {}) : {};

// ── Validation helpers ────────────────────────────────────────────────────
type ValidationResult = { valid: boolean; errors: string[]; warnings: string[] };

function requireEnv(key: string, description: string): string {
  const val = env[key] || '';
  if (!val) {
    console.warn(`[NexusConfig] ⚠ Missing required env: ${key} (${description})`);
  }
  return val;
}

function optionalEnv(key: string, fallback = ''): string {
  return env[key] || fallback;
}

function requireInt(key: string, fallback: number): number {
  const val = env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION SCHEMA
// ════════════════════════════════════════════════════════════════════════════

export const NexusConfig = {

  // ── System ────────────────────────────────────────────────────────────────
  system: {
    env:         optionalEnv('NODE_ENV', 'development') as 'development' | 'production' | 'test',
    appUrl:      requireEnv('APP_URL', 'Public URL of the app'),
    port:        requireInt('PORT', 3000),
    ownerSecret: requireEnv('OWNER_SECRET', 'Admin API secret key'),
    version:     '3.0.0',
    name:        'Nexus AI-Native OS',
  },

  // ── AI Providers ──────────────────────────────────────────────────────────
  ai: {
    // Cloud providers
    geminiApiKey:      optionalEnv('GEMINI_API_KEY'),
    openaiApiKey:      optionalEnv('OPENAI_API_KEY'),
    groqApiKey:        optionalEnv('GROQ_API_KEY'),
    anthropicApiKey:   optionalEnv('ANTHROPIC_API_KEY'),
    huggingfaceApiKey: optionalEnv('HUGGINGFACE_API_KEY'),
    deepseekApiKey:    optionalEnv('DEEPSEEK_API_KEY'),
    mistralApiKey:     optionalEnv('MISTRAL_API_KEY'),

    // Local AI (Ollama / vLLM / LiteLLM)
    ollamaBaseUrl:   optionalEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
    vllmBaseUrl:     optionalEnv('VLLM_BASE_URL', ''),
    litellmBaseUrl:  optionalEnv('LITELLM_BASE_URL', ''),
    litellmApiKey:   optionalEnv('LITELLM_API_KEY', ''),

    // Routing
    defaultModel:    optionalEnv('DEFAULT_AI_MODEL', 'gemini-flash'),
    maxTokensPerDay: requireInt('MAX_TOKENS_PER_DAY', 1_000_000),
    enableLocalAI:   optionalEnv('ENABLE_LOCAL_AI', 'false') === 'true',
  },

  // ── Storage ───────────────────────────────────────────────────────────────
  storage: {
    // Firestore (primary for structured data)
    firebaseProjectId: optionalEnv('FIREBASE_PROJECT_ID'),
    firebaseServerKey: optionalEnv('FIREBASE_SERVER_KEY'),

    // PostgreSQL (for structured memory - Phase 2)
    postgresUrl:  optionalEnv('POSTGRES_URL', ''),
    postgresPool: requireInt('POSTGRES_POOL_SIZE', 10),

    // Redis (for fast cache + event streams)
    redisUrl:      optionalEnv('REDIS_URL', 'redis://localhost:6379'),
    redisTtlShort: requireInt('REDIS_TTL_SHORT', 300),       // 5 min
    redisTtlLong:  requireInt('REDIS_TTL_LONG', 86400),      // 24 hours

    // Qdrant (for vector/semantic memory - Phase 2)
    qdrantUrl:    optionalEnv('QDRANT_URL', 'http://localhost:6333'),
    qdrantApiKey: optionalEnv('QDRANT_API_KEY', ''),

    // Message queue (Phase 4)
    rabbitMqUrl:  optionalEnv('RABBITMQ_URL', 'amqp://localhost:5672'),
    natsUrl:      optionalEnv('NATS_URL', 'nats://localhost:4222'),
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  payments: {
    stripeSecretKey:     optionalEnv('STRIPE_SECRET_KEY'),
    stripeWebhookSecret: optionalEnv('STRIPE_WEBHOOK_SECRET'),
    stripePublicKey:     optionalEnv('VITE_STRIPE_PUBLIC_KEY'),
    currency:            optionalEnv('DEFAULT_CURRENCY', 'usd'),
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: {
    // Push
    fcmServerKey:    optionalEnv('FIREBASE_SERVER_KEY'),
    // SMS
    twilioAccountSid: optionalEnv('TWILIO_ACCOUNT_SID'),
    twilioAuthToken:  optionalEnv('TWILIO_AUTH_TOKEN'),
    twilioFromNumber: optionalEnv('TWILIO_FROM_NUMBER'),
    // Email
    smtpHost:    optionalEnv('SMTP_HOST'),
    smtpPort:    requireInt('SMTP_PORT', 587),
    smtpUser:    optionalEnv('SMTP_USER'),
    smtpPass:    optionalEnv('SMTP_PASS'),
    smtpFromName: optionalEnv('SMTP_FROM_NAME', 'Nexus Support'),
  },

  // ── Social / Omnichannel ──────────────────────────────────────────────────
  omnichannel: {
    whatsappToken:          optionalEnv('WHATSAPP_TOKEN'),
    whatsappPhoneId:        optionalEnv('WHATSAPP_PHONE_ID'),
    whatsappVerifyToken:    optionalEnv('WHATSAPP_VERIFY_TOKEN'),
    facebookPageToken:      optionalEnv('FACEBOOK_PAGE_ACCESS_TOKEN'),
    facebookVerifyToken:    optionalEnv('FACEBOOK_VERIFY_TOKEN'),
    facebookAppSecret:      optionalEnv('FACEBOOK_APP_SECRET'),
    telegramBotToken:       optionalEnv('TELEGRAM_BOT_TOKEN'),
    discordBotToken:        optionalEnv('DISCORD_BOT_TOKEN'),
    discordApplicationId:   optionalEnv('DISCORD_APPLICATION_ID'),
  },

  // ── Security ──────────────────────────────────────────────────────────────
  security: {
    allowedOrigins:      optionalEnv('ALLOWED_ORIGINS', 'http://localhost:3000'),
    rateLimitWindow:     requireInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    rateLimitMax:        requireInt('RATE_LIMIT_MAX', 100),
    jwtSecret:           optionalEnv('JWT_SECRET', ''),
    jwtExpiresIn:        optionalEnv('JWT_EXPIRES_IN', '24h'),
    enableAuditLog:      optionalEnv('ENABLE_AUDIT_LOG', 'true') === 'true',
    enablePromptDefense: optionalEnv('ENABLE_PROMPT_DEFENSE', 'true') === 'true',
    maxAgentDepth:       requireInt('MAX_AGENT_DEPTH', 5),
    requireHumanApproval: optionalEnv('REQUIRE_HUMAN_APPROVAL', 'false') === 'true',
  },

  // ── Observability ──────────────────────────────────────────────────────────
  observability: {
    prometheusEnabled: optionalEnv('PROMETHEUS_ENABLED', 'false') === 'true',
    prometheusPort:    requireInt('PROMETHEUS_PORT', 9090),
    grafanaUrl:        optionalEnv('GRAFANA_URL', ''),
    lokiUrl:           optionalEnv('LOKI_URL', ''),
    logLevel:          optionalEnv('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
    sentryDsn:         optionalEnv('SENTRY_DSN', ''),
    traceEnabled:      optionalEnv('TRACE_ENABLED', 'false') === 'true',
  },

  // ── Maps & Delivery ─────────────────────────────────────────────────────
  // Phase W: Google Directions API for real ETA + route optimization.
  // If GOOGLE_MAPS_KEY is not set, the system falls back to Haversine-based
  // ETA estimation (avgSpeed × distance) — fully functional without the key,
  // just less accurate in heavy traffic.
  maps: {
    googleMapsKey:        optionalEnv('GOOGLE_MAPS_KEY', ''),
    defaultAvgSpeedKmh:   requireInt('DELIVERY_AVG_SPEED_KMH', 25),  // urban average
    defaultSlaMinutes:    requireInt('DELIVERY_SLA_MINUTES', 45),
    // Smart assignment weights (must sum to 1.0)
    assignWeightDistance: parseFloat(optionalEnv('ASSIGN_WEIGHT_DISTANCE', '0.50') ?? '0.50'),
    assignWeightPerf:     parseFloat(optionalEnv('ASSIGN_WEIGHT_PERF',     '0.30') ?? '0.30'),
    assignWeightLoad:     parseFloat(optionalEnv('ASSIGN_WEIGHT_LOAD',     '0.20') ?? '0.20'),
    // Maximum km radius to search for riders before expanding
    maxRiderSearchKm:     parseFloat(optionalEnv('MAX_RIDER_SEARCH_KM',   '15')   ?? '15'),
    // Multi-order batching
    maxBatchSize:         requireInt('MAX_BATCH_SIZE', 4),
    maxBatchRadiusKm:     parseFloat(optionalEnv('MAX_BATCH_RADIUS_KM',   '3.0')  ?? '3.0'),
  },

  // ── Feature Flags ──────────────────────────────────────────────────────────
  features: {
    enableVectorMemory:      optionalEnv('FEATURE_VECTOR_MEMORY', 'false') === 'true',
    enableMultiAgent:        optionalEnv('FEATURE_MULTI_AGENT', 'false') === 'true',
    enableEventBus:          optionalEnv('FEATURE_EVENT_BUS', 'false') === 'true',
    enableAutonomousAgents:  optionalEnv('FEATURE_AUTONOMOUS_AGENTS', 'false') === 'true',
    enableSelfHealing:       optionalEnv('FEATURE_SELF_HEALING', 'true') === 'true',
    enableFraudDetection:    optionalEnv('FEATURE_FRAUD_DETECTION', 'true') === 'true',
    enablePersonalization:   optionalEnv('FEATURE_PERSONALIZATION', 'true') === 'true',
    enableLocalAI:           optionalEnv('FEATURE_LOCAL_AI', 'false') === 'true',
  },
} as const;

// ── Runtime validation ────────────────────────────────────────────────────
export function validateConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical checks
  if (!NexusConfig.system.ownerSecret) errors.push('OWNER_SECRET is required');
  if (NexusConfig.system.ownerSecret === 'OWNER_SECRET') errors.push('OWNER_SECRET must not be the default value');
  if (NexusConfig.system.ownerSecret && NexusConfig.system.ownerSecret.length < 16) errors.push('OWNER_SECRET must be at least 16 characters');

  // AI — at least one provider must be configured
  const hasAnyAI = NexusConfig.ai.geminiApiKey || NexusConfig.ai.openaiApiKey ||
    NexusConfig.ai.groqApiKey || NexusConfig.ai.ollamaBaseUrl !== 'http://localhost:11434';
  if (!hasAnyAI) errors.push('At least one AI provider must be configured (GEMINI_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or OLLAMA_BASE_URL)');

  // Warnings for optional but recommended
  if (!NexusConfig.payments.stripeSecretKey) warnings.push('STRIPE_SECRET_KEY not set — payments disabled');
  if (!NexusConfig.storage.redisUrl) warnings.push('REDIS_URL not set — caching disabled');
  if (!NexusConfig.security.jwtSecret) warnings.push('JWT_SECRET not set — using session-less auth');
  if (!NexusConfig.observability.prometheusEnabled) warnings.push('Prometheus disabled — add PROMETHEUS_ENABLED=true for production monitoring');

  // Production-specific
  if (NexusConfig.system.env === 'production') {
    if (!NexusConfig.payments.stripeWebhookSecret) errors.push('STRIPE_WEBHOOK_SECRET required in production');
    if (!NexusConfig.system.appUrl || NexusConfig.system.appUrl.includes('localhost')) errors.push('APP_URL must be a real domain in production');
    if (!NexusConfig.observability.prometheusEnabled) warnings.push('Enable Prometheus monitoring in production');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Print validation summary ──────────────────────────────────────────────
export function printConfigSummary() {
  const result = validateConfig();
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         NEXUS CONFIG VALIDATION REPORT       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Environment: ${NexusConfig.system.env}`);
  console.log(`  App URL: ${NexusConfig.system.appUrl || '(not set)'}`);
  console.log(`  AI Providers: ${[
    NexusConfig.ai.geminiApiKey && 'Gemini',
    NexusConfig.ai.openaiApiKey && 'OpenAI',
    NexusConfig.ai.groqApiKey && 'Groq',
    NexusConfig.ai.anthropicApiKey && 'Claude',
    NexusConfig.ai.deepseekApiKey && 'DeepSeek',
    NexusConfig.ai.mistralApiKey && 'Mistral',
    NexusConfig.ai.enableLocalAI && 'Ollama/Local',
  ].filter(Boolean).join(', ') || 'NONE'}`);

  if (result.errors.length > 0) {
    console.log('\n  ❌ ERRORS:');
    result.errors.forEach(e => console.log(`    • ${e}`));
  }
  if (result.warnings.length > 0) {
    console.log('\n  ⚠ WARNINGS:');
    result.warnings.forEach(w => console.log(`    • ${w}`));
  }
  console.log(`\n  Status: ${result.valid ? '✅ VALID' : '❌ INVALID — fix errors before deploying'}\n`);
  return result;
}
