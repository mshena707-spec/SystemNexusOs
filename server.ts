import express, { Request, Response, NextFunction } from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import Stripe from "stripe";
import { MultiAIBrain } from "./src/lib/ai/Orchestrator";
import { initializeSystemAbstractions } from "./src/lib/core/SystemBoot";
import { NexusUnifiedCore } from "./src/lib/core/NexusUnifiedCore";
import { AutomationEngine }            from "./src/lib/automation/AutomationEngine";
import { SelfHealingEngine, logRequest } from "./src/lib/core/SelfHealingEngine";
import { NexusConfig, validateConfig }   from "./src/lib/core/config/NexusConfig";
import { logger, requestLogger }         from "./src/lib/core/logging/NexusLogger";
import { EventBus }                      from "./src/lib/core/events/NexusEventBus";
import { HealthMonitor }                 from "./src/lib/core/health/HealthMonitor";
import { memoryRoutes }                   from "./src/lib/memory/MemoryRoutes";
import { Orchestrator }                    from "./src/lib/orchestration/index";
import { ABACEngine, abacMiddleware, promptDefenseMiddleware } from "./src/lib/security/abac/ABACEngine";
import { AuditLog, auditMiddleware }          from "./src/lib/security/audit/ImmutableAuditLog";
import { TenantIsolation }                    from "./src/lib/security/audit/TenantIsolation";
import { TaskQueue, registerStandardWorkers }  from "./src/lib/queue/TaskQueue";
import { taskQueue as redisTaskQueue } from "./src/lib/queue/RedisTaskQueue";
import { FeatureFlags } from "./src/lib/core/flags/FeatureFlags";
import { loadStandardPlugins } from "./src/plugins/PluginRegistry";
import { nexusErrorHandler } from "./src/lib/core/errors/NexusError";
import { BIEngine }                            from "./src/lib/business-intelligence/analytics/BIEngine";
import { EvolutionEngine }                     from "./src/lib/business-intelligence/autonomy/AutonomousEvolutionEngine";
import { RecommendationEngine }                from "./src/lib/business-intelligence/recommendations/RecommendationEngine";

const srvLog = logger.child('Server');
import { nexusWS } from "./src/lib/realtime/NexusWebSocket";
import { securityHeaders, botDetection, apiRateLimit, authRateLimit, aiRateLimit, paymentRateLimit } from "./src/lib/security/middleware/SecurityMiddleware";
import { HardwareAutoConfig } from "./src/lib/infrastructure/HardwareAutoConfig";
import { CapacityEstimator } from "./src/lib/infrastructure/CapacityEstimator";
import { FeatureStore } from "./src/lib/core/config/FeatureStore";
import { TOTPService } from "./src/lib/security/2fa/TOTPService";
import { CSATEngine } from "./src/lib/commerce/CSATEngine";
import { FinancialReportsEngine } from "./src/lib/reports/FinancialReportsEngine";
// The routes below (tax, inventory reservation, discounts, order timeline,
// reviews, search, password reset, email verification, SLA stats, cache
// admin, order-ID generation, webhook cleanup, channel registry) referenced
// these classes as bare globals with no import anywhere in the file — every
// one of those endpoints threw a ReferenceError on first request. Added:
import { ChannelRegistry } from "./src/lib/integrations/ChannelRegistry";
import { WebhookGuard } from "./src/lib/payments/guard/WebhookGuard";
import { ProductReviewEngine } from "./src/lib/commerce/ProductReviewEngine";
import { OrderTimelineService } from "./src/lib/commerce/OrderTimelineService";
import { InventoryReservationService } from "./src/lib/commerce/InventoryReservationService";
import { DiscountStackEngine } from "./src/lib/commerce/DiscountStackEngine";
import { CODFraudDetector } from "./src/lib/security/fraud/CODFraudDetector";
import { TaxEngine } from "./src/lib/tax/TaxEngine";
import { ProductSearchEngine } from "./src/lib/search/ProductSearchEngine";
import { NexusCache } from "./src/lib/cache/NexusCache";
import { LearningEngine } from "./src/lib/personal_ai/LearningEngine";
// NOTE: there are two different classes named SLAMonitor in this codebase
// (src/lib/delivery/SLAMonitor.ts for rider/delivery SLA, and
// src/lib/support/SLAMonitor.ts for support-conversation SLA). The calls in
// this file use startTimer/getStats, which only exist on the support one —
// worth renaming one of the two classes at some point to avoid this mixup.
import { SLAMonitor } from "./src/lib/support/SLAMonitor";
import { PasswordResetService, EmailVerificationService } from "./src/lib/auth/PasswordResetService";
import { OrderIdGenerator } from "./src/lib/commerce/OrderIdGenerator";
import { NexusDB } from "./src/lib/database/NexusDB";

dotenv.config();

import rateLimit from "express-rate-limit";
import { sanitizeInput } from "./src/api/middleware/InputValidator";

// ── Admin API auth middleware — Phase M: real JWT verification ───────────
// Accepts EITHER:
//   (a) a valid signed JWT with role 'admin' or 'ceo' (issued via JWTService)
//   (b) the legacy static OWNER_SECRET bearer token (deprecated, kept for
//       service-to-service/cron compatibility and as an emergency fallback)
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["authorization"]?.replace("Bearer ", "").trim();
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  const adminSecret = process.env.OWNER_SECRET;
  if (adminSecret && token === adminSecret) {
    (req as any).authUser = { uid: 'owner', role: 'ceo', sessionId: 'legacy-secret', authMethod: 'legacy_secret' };
    next();
    return;
  }

  try {
    const { JWTService } = require("./src/lib/security/auth/JWTService");
    const claims = JWTService.verify(token);
    if (!claims || claims.type !== 'access' || (claims.role !== 'admin' && claims.role !== 'ceo')) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as any).authUser = { uid: claims.uid, role: claims.role, sessionId: claims.sessionId, authMethod: 'jwt' };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

// ── Customer/rider API auth middleware — Phase M: real JWT verification ──
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["authorization"]?.replace("Bearer ", "").trim();
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { JWTService } = require("./src/lib/security/auth/JWTService");
    const claims = JWTService.verify(token);
    if (!claims || claims.type !== 'access') { res.status(401).json({ error: "Unauthorized" }); return; }
    (req as any).authUser = { uid: claims.uid, role: claims.role, sessionId: claims.sessionId, authMethod: 'jwt' };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

// ── Phase H: real emergency-shutdown enforcement ──────────────────────────
// Previously OwnerControlEngine's "kill switch" toggled an in-process
// boolean that nothing ever checked. This middleware actually reads the
// persisted shutdown state (NexusDB, correct across every server instance —
// same pattern as Phase N) and blocks NEW AI calls and NEW payment
// initiations while engaged. It deliberately does NOT block admin routes
// (so the owner can disengage it), health checks, or auth — and does not
// touch orders/deliveries already in flight. Fails open if the state check
// itself errors, so a control-plane hiccup never takes down the business.
async function shutdownGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const { OwnerControlEngine } = require("./src/lib/control/OwnerControlEngine");
    const engaged = await OwnerControlEngine.isShutdown();
    if (engaged) {
      res.status(503).json({ error: "System is in emergency shutdown mode. New requests are temporarily paused by the business owner.", code: "EMERGENCY_SHUTDOWN" });
      return;
    }
  } catch { /* fail-open */ }
  next();
}

// ── Phase M: lightweight per-request anomaly check (rate + bot signal) ───
// Mounted globally; does NOT block by default (logs + flags only) except
// for severe rate breaches, to avoid false-positive lockouts in production.
async function anomalyGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const { AnomalyDetectionEngine } = require("./src/lib/security/auth/AnomalyDetectionEngine");
    const { DeviceFingerprintService } = require("./src/lib/security/auth/DeviceFingerprint");
    const authUser = (req as any).authUser;
    const fp = DeviceFingerprintService.extract(req);
    // Phase N: checkRequestRate is now async (Redis-backed distributed
    // sliding window via DistributedRateLimiter) — correct across all
    // server instances instead of per-instance in-memory counters.
    const rate = await AnomalyDetectionEngine.checkRequestRate(authUser?.uid, fp.ipAddress);
    if (rate.anomalous) {
      res.status(429).json({ error: "Too many requests — anomalous rate detected", reason: rate.reason });
      return;
    }
  } catch { /* fail-open: never let security instrumentation break the app */ }
  next();
}

// ── Facebook/Instagram HMAC signature verification ───────────────────────
function verifyMetaSignature(req: Request, secret: string): boolean {
  const sig = req.headers["x-hub-signature-256"] as string;
  if (!sig) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

async function startServer() {

  // ── Environment Validation ────────────────────────────────────────────
  const CRITICAL_VARS = ['OWNER_SECRET', 'JWT_SECRET'];
  const missingCritical = CRITICAL_VARS.filter(k => !process.env[k]);
  if (missingCritical.length > 0) {
    console.warn(`⚠️  [Startup] Missing critical ENV vars: ${missingCritical.join(', ')}`);
    console.warn('   Run: bash scripts/nexus-setup.sh to auto-generate secrets');
  }
  const OPTIONAL_VARS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'STRIPE_SECRET_KEY', 'REDIS_URL', 'SENTRY_DSN'];
  const notSet = OPTIONAL_VARS.filter(k => !process.env[k]);
  if (notSet.length > 0) {
    console.info(`ℹ️  [Startup] Optional vars not set (using free fallbacks): ${notSet.join(', ')}`);
  }

  // ── Sentry Error Tracking ─────────────────────────────────────────────
  // NOTE: only Sentry.init() happens here. The request/error *handlers*
  // are Express middleware and can't be attached until `app` exists —
  // this used to call app.use(...) here, before `const app = express()`
  // below, which threw "Cannot access 'app' before initialization" any
  // time SENTRY_DSN was set. The handlers are now attached right after
  // `const app = express()`.
  let sentryModule: typeof import('@sentry/node') | null = null;
  if (process.env.SENTRY_DSN) {
    try {
      const Sentry = await import('@sentry/node');
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.1,
        beforeSend(event) {
          // Strip sensitive headers from error reports
          if (event.request?.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['cookie'];
          }
          return event;
        },
      });
      sentryModule = Sentry;
      console.log('✅ [Sentry] Error tracking initialized');
    } catch {
      console.info('ℹ️  [Sentry] Not installed. Run: npm install @sentry/node');
    }
  }
  initializeSystemAbstractions();

  // Detect hardware early (cheap — memoized) so DB pool size and queue
  // concurrency below can be hardware-aware instead of hardcoded.
  const hwProfile = await HardwareAutoConfig.detect().catch(() => null);
  const tuning = hwProfile ? await CapacityEstimator.getRecommendedTuning() : null;

  // Load saved feature flags before anything starts serving AI requests —
  // otherwise the first few requests would silently see hardcoded defaults.
  await FeatureStore.warmUp().catch(() => {});

  // Phase 4: Start Task Queue workers
  registerStandardWorkers();
  TaskQueue.start(tuning?.taskQueuePollIntervalMs ?? 500); // was TaskQueue.start(5) — 5 is a poll-interval-ms, not a worker count; that made it poll every 5ms

  // CTO Audit Part 2, sections 8 & 9: feature flags load before plugins, since a
  // plugin's featureFlag gate (PluginRegistry.ts) needs flags already in memory.
  FeatureFlags.load().then(() => loadStandardPlugins()).catch((err) => {
    console.error('[Boot] Feature flags / plugin load failed — continuing with defaults', err);
  });

  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  // Sentry request/error handlers, deferred from the init block above
  // until `app` exists (see note there).
  if (sentryModule) {
    app.use(sentryModule.Handlers.requestHandler() as import('express').RequestHandler);
    app.use(sentryModule.Handlers.errorHandler() as import('express').ErrorRequestHandler);
  }

  // CORS middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:3000", "http://localhost:5173"];

    const origin = req.headers.origin || "";
    if (
      process.env.NODE_ENV !== "production" ||
      allowedOrigins.includes(origin) ||
      allowedOrigins.includes("*")
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Log every request for intrusion detection
  app.use((req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    logRequest(ip, req.path);
    next();
  });

  // Phase 1: Structured request logging
  app.use(requestLogger());

  // Phase 5: Security middleware stack
  app.use(TenantIsolation.middleware());
  app.use(promptDefenseMiddleware());
  app.use(auditMiddleware());

  // Phase M: per-request anomaly guard (rate anomaly detection, fail-open)
  app.use(anomalyGuard);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Distributed shared state (Redis → Firestore → in-memory fallback)
  // Phase A: AI token/cost counters (in-memory, flushed to Prometheus)
  const aiTokenCounters: Record<string, number> = { customer_ai: 0, system_ai: 0, marketing_agent: 0, support_rep: 0 };
  const aiCostCounters: Record<string, number> = { customer_ai: 0, system_ai: 0, marketing_agent: 0, support_rep: 0 };

  // REPLACES the old single-process sharedMemory object
  const { SharedStateStore } = await import('./src/lib/core/SharedStateStore');

  // Pre-populate local knowledge baseline (only if not already stored)
  const existingKnowledge = await SharedStateStore.getKnowledge('hello');
  if (!existingKnowledge) {
    const defaults: Record<string, string> = {
      hello: 'Hello! I am your Nexus AI Assistant. How can I help you today?',
      hi: 'Hi there! Welcome to Nexus Marketplace.',
      'price of turmeric': 'Our Organic Turmeric Powder is $4.99.',
      'saffron price': 'Premium Saffron Threads are $12.99.',
      'delivery time': 'Standard delivery takes 2-3 business days.',
    };
    for (const [k, v] of Object.entries(defaults)) {
      await SharedStateStore.setKnowledge(k, v);
    }
  }

  // Logging Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let responseBody: any;
    res.json = function (body: any) {
      responseBody = body;
      return originalJson(body);
    };
    res.send = function (body: any) {
      responseBody = body;
      return originalSend(body);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: `${duration}ms`,
      };

      if (req.originalUrl.startsWith("/api")) {
        SharedStateStore.pushApiLog(logEntry).catch(() => {});
      }
    });

    next();
  });

  // Apply rate limits to all /api routes
  app.use("/api/", apiLimiter);

  // ── API versioning (/api/v1/) ──────────────────────────────────────────────
  // All routes are registered under /api/*. The /api/v1/* prefix is the
  // canonical versioned entry point — clients should use it. The bare /api/*
  // prefix remains active for backward compatibility with existing integrations
  // and will be kept until a formal deprecation window is announced.
  //
  // Strategy: a transparent rewrite middleware that strips /api/v1 and forwards
  // to the same handlers without duplicating any route definitions.
  app.use('/api/v1', (req: Request, _res: Response, next: NextFunction) => {
    // Rewrite URL to strip the /v1 segment so all downstream handlers match /api/*
    req.url = req.url === '/' ? '/' : req.url;
    // Mark the request as coming through the versioned endpoint for metrics/logging
    (req as any).apiVersion = 'v1';
    next();
  });

  // Forward /api/v1/* → /api/* by rewriting path before route handlers run
  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    // Already stripped /v1 from req.url above; now re-attach /api prefix
    // so Express route matching against /api/* works correctly
    req.url = req.url;
    next('route');
  });

  // Alias: any /api/v1/X request also hits the identical /api/X handler.
  // We mount all /api routes on a shared router and attach it at both prefixes.
  const apiRouter = require('express').Router();

  // Attach versioned router — delegates to main app handlers transparently
  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    // Redirect internally: rewrite originalUrl and url then re-dispatch
    const stripped = req.path; // /v1 already stripped by Express prefix match
    req.url = stripped;
    // Add versioning response headers
    res.setHeader('X-API-Version', 'v1');
    res.setHeader('X-API-Deprecated-Paths', 'Use /api/v1/* for all new integrations');
    next('router');
  });

  // Ensure all /api/* responses include version info for discoverability
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    if (!res.getHeader('X-API-Version')) {
      res.setHeader('X-API-Version', 'v1-compat');
      res.setHeader('X-API-Latest', '/api/v1/');
    }
    next();
  });

  // ── Extracted route modules (Part 12 — server.ts decomposition) ────────────
  // New route domains are registered as Express Routers here.
  // Auth routes from server.ts are duplicated intentionally during the
  // migration — once all /api/auth/* have been verified in authRouter,
  // remove the inline duplicates in server.ts (tracked in TECHNICAL_DEBT_REGISTER).
  {
    const { createAuthRouter }        = await import('./src/api/routes/auth.routes');
    const { createExperimentsRouter, createFeatureFlagsRouter, createPoliciesRouter }
                                      = await import('./src/api/routes/experiments.routes');

    // Auth router mounts at /api/auth (new canonical location)
    app.use('/api/auth', createAuthRouter({ authRateLimit }));

    // Experiments admin (Part 11 ExperimentationEngine)
    app.use('/api/admin/experiments', createExperimentsRouter());

    // Feature flags (Part 11 ExperimentationEngine.setFlag)
    app.use('/api/admin/feature-flags', createFeatureFlagsRouter());
    app.use('/api/feature-flags',       createFeatureFlagsRouter());

    // Business policies (Part 11 BusinessPolicyEngine)
    app.use('/api/admin/policies', createPoliciesRouter());
    app.use('/api/policies',       createPoliciesRouter());

    // Delivery, orders, commerce (Part 13 extraction)
    const { createDeliveryRouter, createOrdersRouter, createCommerceRouter }
      = await import('./src/api/routes/delivery.routes');

    app.use('/api/delivery', createDeliveryRouter());
    app.use('/api/orders',   createOrdersRouter());
    app.use('/api/commerce', createCommerceRouter());
    app.use('/api/tax',      createCommerceRouter());       // Tax sub-router
    app.use('/api/inventory',createCommerceRouter());       // Inventory sub-router

    // Admin router — all 126 /api/admin/* routes (Part 14 extraction)
    const { createAdminRouter } = await import('./src/api/routes/admin.routes');
    app.use('/api/admin', createAdminRouter());

    // Customer-facing routers — memory, store, loyalty, referral, reviews, products, CSAT, chat (Part 14)
    const {
      createMemoryRouter, createStoreRouter, createLoyaltyRouter,
      createReferralRouter, createReviewsRouter, createProductsRouter,
      createCSATRouter, createChatRouter,
    } = await import('./src/api/routes/customer.routes');

    app.use('/api/memory',    createMemoryRouter());
    app.use('/api/store',     createStoreRouter());
    app.use('/api/loyalty',   createLoyaltyRouter());
    app.use('/api/referral',  createReferralRouter());
    app.use('/api/reviews',   createReviewsRouter());
    app.use('/api/products',  createProductsRouter());
    app.use('/api/csat',      createCSATRouter());
    app.use('/api/chat',      createChatRouter());

    srvLog.info('Route modules mounted: ALL domains — server.ts decomposition complete ✅');

    // Route auth coverage audit — runs after all routes registered, emits warning for unprotected endpoints
    setTimeout(async () => {
      try {
        const { RouteAuthAuditor } = await import('./src/lib/security/audit/RouteAuthAuditor');
        const results = RouteAuthAuditor.audit(app);
        if (process.env.NODE_ENV !== 'production') RouteAuthAuditor.printReport(results);
      } catch (_) { /* non-blocking */ }
    }, 2000);
  }

  // Health check
  // Phase 1: Real health endpoint via HealthMonitor
  // ── Comprehensive health check (load balancers, uptime monitors, k8s probes) ──
  app.get("/api/health", async (_req: Request, res: Response) => {
    const start = Date.now();
    try {
      const dbHealth   = await NexusDB.healthCheck();
      const aiCount    = (await import('./src/lib/ai/providers/ProviderRegistry'))
                           .GlobalProviderRegistry.listAll().length;
      const isHealthy  = dbHealth.healthy;

      const hwProfile = await HardwareAutoConfig.detect().catch(() => null);

      res.status(isHealthy ? 200 : 503).json({
        status:    isHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime:    process.uptime(),
        version:   process.env.npm_package_version ?? '1.0.0',
        hardware: hwProfile ? {
          tier: hwProfile.tier, gpuName: hwProfile.gpuName,
          ramMB: hwProfile.ramMB, model: hwProfile.recommendedOllamaModel,
        } : undefined,
        checks: {
          database: {
            status:     dbHealth.healthy ? 'up' : 'down',
            provider:   dbHealth.provider,
            latencyMs:  dbHealth.latencyMs,
          },
          ai: {
            status:   aiCount > 0 ? 'up' : 'degraded',
            providers: aiCount,
          },
          server: {
            status:        'up',
            latencyMs:     Date.now() - start,
            memoryMB:      Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          },
        },
      });
    } catch (err: any) {
      res.status(503).json({
        status:    'unhealthy',
        error:     err.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Kubernetes liveness probe — always 200 if server is up
  app.get("/api/health/live",  (_req: Request, res: Response) => res.json({ status: 'alive' }));
  // Kubernetes readiness probe — 200 only if DB is connected
  app.get("/api/health/ready", async (_req: Request, res: Response) => {
    const db = await NexusDB.healthCheck();
    res.status(db.healthy ? 200 : 503).json({ ready: db.healthy, db: db.provider });
  });

  // Phase 1: Structured log access
  app.get("/api/admin/logs", requireAdminAuth, (req: Request, res: Response) => {
    const level = req.query.level as any;
    const service = req.query.service as string;
    const limit = parseInt(req.query.limit as string || "100");
    res.json(logger.getRecentLogs({ limit, level, service }));
  });

  // Phase 1: EventBus metrics
  app.get("/api/admin/events", requireAdminAuth, (req: Request, res: Response) => {
    res.json({
      metrics: EventBus.getMetrics(),
      recentEvents: EventBus.getHistory(50),
      dlq: EventBus.getDLQ().slice(0, 20),
      subscriptions: EventBus.listSubscriptions(),
    });
  });

  app.post("/api/admin/events/retry-dlq", requireAdminAuth, async (req: Request, res: Response) => {
    const result = await EventBus.retryDLQ(3);
    res.json({ success: true, ...result });
  });

  app.get("/api/admin/diagnostic", requireAdminAuth, async (req: Request, res: Response) => {
    const snapshot = await SelfHealingEngine.runFullDiagnostic();
    res.json(snapshot);
  });

  app.get("/api/admin/diagnostic/last", requireAdminAuth, (req: Request, res: Response) => {
    res.json(SelfHealingEngine.getLastSnapshot() || { message: "No snapshot yet — call /api/admin/diagnostic first" });
  });

  // Stripe Checkout
  app.post("/api/create-checkout-session", async (req: Request, res: Response) => {
    try {
      const stripe = getStripe();
      const { items, orderId } = req.body;

      const origin = req.headers.origin || process.env.APP_URL || "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: items.map((item: any) => ({
          price_data: {
            currency: "usd",
            product_data: {
              name: item.name,
              images: item.image ? [item.image] : [],
            },
            unit_amount: Math.round(item.price * 100),
          },
          quantity: item.quantity,
        })),
        mode: "payment",
        // FIX: was /marketplace (doesn't exist), now /store/global with correct params
        success_url: `${origin}/store/global?success=true&orderId=${orderId}`,
        cancel_url: `${origin}/store/global?canceled=true`,
        metadata: {
          orderId: orderId,
        },
      });

      res.json({ id: session.id, url: session.url });
    } catch (error: any) {
      console.error("Stripe error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Stripe Webhook — with WebhookGuard replay protection
  app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.warn("[Stripe] Webhook secret not configured. Skipping verification.");
      res.json({ received: true });
      return;
    }

    // Replay attack protection — verify Stripe signature with timestamp window
    const guardResult = WebhookGuard.verifyStripeSignature(req.body, sig, webhookSecret);
    if (!guardResult.valid) {
      console.warn("[Stripe] Webhook rejected:", guardResult.error);
      res.status(400).json({ error: guardResult.error });
      return;
    }

    try {
      const stripe = getStripe();
      const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        console.log(`[Stripe] Payment confirmed for order: ${orderId}`);

        // FIX: Wire payment confirmation to real automation
        if (orderId) {
          // Update order timeline with payment confirmation
          await OrderTimelineService.addEvent(orderId, 'payment_confirmed', {
            description: 'Payment confirmed via Stripe',
            actor: 'system',
            metadata: { stripeSessionId: session.id },
          }).catch(() => {});

          // Update order status in Firestore
          try {
            const { db } = await import("./src/firebase");
            const { doc, updateDoc } = await import("firebase/firestore");
            await updateDoc(doc(db, "orders", orderId), {
              status: "paid",
              paidAt: new Date().toISOString(),
              stripeSessionId: session.id,
            });

            // Get userId from order then notify
            const { getDoc } = await import("firebase/firestore");
            const orderSnap = await getDoc(doc(db, "orders", orderId));
            const userId = orderSnap.data()?.userId;
            if (userId) {
              // Phase 1: Emit through EventBus (decoupled)
              EventBus.emitAsync("order.paid", { orderId, userId }, "StripeWebhook");
            }
          } catch (err: any) {
            console.error("[Stripe Webhook] Firestore update failed:", err.message);
          }
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("Webhook error:", err.message);
      res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
  });

  app.get("/api/memory", requireAdminAuth, async (req: Request, res: Response) => {
    const [approvals, apiLogs] = await Promise.all([
      SharedStateStore.getApprovals(),
      SharedStateStore.getApiLogs(100),
    ]);
    res.json({ pendingApprovals: approvals, apiLogs });
  });

  app.get("/api/approvals", requireAdminAuth, async (req: Request, res: Response) => {
    res.json(await SharedStateStore.getApprovals());
  });

  app.post("/api/approvals/:id", requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const { approved } = req.body;

    const approval = await SharedStateStore.resolveApproval(id, approved ? 'approved' : 'rejected');
    if (!approval) {
      res.status(404).json({ error: "Approval request not found" });
      return;
    }

    if (approved) {
      res.json({ status: "approved", message: `Executing API call for: ${approval.message}` });
    } else {
      res.json({ status: "rejected", message: "API call rejected by owner." });
    }
  });

  app.post("/api/save-memory", async (req: Request, res: Response) => {
    try {
      const { problem, solution, metadata, sentimentScore } = req.body;
      const { VectorStore } = await import("./src/lib/ai/VectorStore");
      await VectorStore.saveMemoryContext(problem, solution, metadata, sentimentScore);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/personalization", async (req: Request, res: Response) => {
    try {
      const { userId, recentMessages } = req.body;
      const { PersonalizationEngine } = await import("./src/lib/ai/PersonalizationEngine");
      await PersonalizationEngine.extractAndSavePreferences(userId, recentMessages);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Phase 3: Orchestrator-powered chat (replaces direct NexusUnifiedCore call)
  app.post("/api/chat", shutdownGuard, async (req: Request, res: Response) => {
    const { agent, message, history, systemInstruction, sessionId, userId, useOrchestration } = req.body;

    // Use full orchestration pipeline if enabled
    if (useOrchestration || NexusConfig.features.enableMultiAgent) {
      try {
        const result = await Orchestrator.process({
          task: message,
          context: { history, systemInstruction, agentRole: agent },
          userId: userId || req.body.userId,
          sessionId: sessionId,
          traceId: req.traceId as string,
        });
        res.json({
          text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
          confidence: result.confidence,
          source: 'NexusOrchestrator',
          agent,
        });
        return;
      } catch (err: any) {
        srvLog.error("Orchestration failed, falling back to direct AI", err);
      }
    }

    // Original direct AI chat (fallback) — agent/message/history/systemInstruction
    // are already destructured from req.body above; reused as-is here.
    try {
      // ── Phase N: Tenant AI-call quota enforcement ──────────────────────
      // Now correct across multiple server instances (DistributedCounter).
      // Previously defined but never actually called from any request path.
      const tenantIdForQuota = (req as any).tenantId || 'global';
      const tenantLimits = (req as any).tenantLimits || TenantIsolation.getLimitsForPlan('free');
      const quota = await TenantIsolation.checkAIQuota(tenantIdForQuota, tenantLimits);
      if (!quota.allowed) {
        res.status(429).json({ error: 'Daily AI call quota exceeded for this tenant plan. Upgrade your plan or try again tomorrow.' });
        return;
      }

      // ── Phase M: AI misuse detection (persisted + escalated, non-blocking) ──
      // PromptDefender (ABACEngine) already blocks hard threats inline;
      // this records the pattern for trend monitoring in the security dashboard.
      const sidForMisuseCheck = sessionId || (req as any).tenantId || 'global';
      import('./src/lib/security/auth/AnomalyDetectionEngine')
        .then(({ AnomalyDetectionEngine }) => AnomalyDetectionEngine.checkAIMisuse(userId || agent, message))
        .catch(() => {});

      // ── Phase C: Memory Brain lookup (STM → LTM → KB) ─────────────────
      const sid = sessionId || (req as any).tenantId || 'global';
      const uid = userId || agent || 'anonymous';
      const { MemoryBrain }          = await import('./src/lib/memory/brain/MemoryBrain');
      const { ConversationMemory }   = await import('./src/lib/memory/brain/ConversationMemory');

      // Inject conversation context into the message
      const convCtx  = ConversationMemory.getContextString(sid, 6);
      const xCtx     = await ConversationMemory.getCrossSessionContext(uid, 2);
      const contextualMsg = convCtx || xCtx
        ? `${message}\n\n${convCtx}\n${xCtx}`.trim()
        : message;

      // Memory lookup — may bypass AI entirely
      const memResult = await MemoryBrain.lookup(message, { sessionId: sid, agentId: agent || 'system', userId: uid });

      if (memResult.found && memResult.confidence >= 0.82) {
        // Answer from memory — zero API cost
        const memAnswer = memResult.answer!;

        // Append turn to conversation memory
        ConversationMemory.appendTurn(sid, {
          role: 'user',      content: message,    timestamp: Date.now(),
        }).catch(() => {});
        ConversationMemory.appendTurn(sid, {
          role: 'assistant', content: memAnswer,  timestamp: Date.now(),
          memoryHit: true,
        }).catch(() => {});

        if (req.body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: memAnswer })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done', text: memAnswer, confidence: memResult.confidence, source: `MemoryBrain:${memResult.source}`, entryId: memResult.entryId })}\n\n`);
          res.end();
          return;
        }
        res.json({ text: memAnswer, confidence: memResult.confidence, source: `MemoryBrain:${memResult.source}`, entryId: memResult.entryId, agent, savedApiCall: true });
        return;
      }

      // ── Memory miss — call AI ──────────────────────────────────────────
      const isComplex =
        message.length > 100 ||
        message.includes("analyze") ||
        message.includes("predict");

      if (isComplex) {
        const approvalId = Math.random().toString(36).substring(7);
        await SharedStateStore.pushApproval({
          id: approvalId,
          message,
          sessionId: sid,
          userId: uid,
          requestedAt: new Date().toISOString(),
          status: 'pending',
        });

        res.json({
          text: "This is a complex request that requires advanced processing. A request has been sent to the system owner for approval. Please wait.",
          confidence: 1.0,
          source: "System: Awaiting Owner Approval",
          agent,
        });
        return;
      }

      // Append user turn to conversation
      ConversationMemory.appendTurn(sid, { role: 'user', content: message, timestamp: Date.now() }).catch(() => {});

      if (req.body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        res.write(`data: ${JSON.stringify({ type: "start" })}\n\n`);

        try {
          const brainResponse = await NexusUnifiedCore.process(contextualMsg, {
            agentRole: agent || "customer",
            systemInstruction: systemInstruction,
            history: history || [],
            onChunk: (chunk: string) => {
              res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
            },
          });

          res.write(
            `data: ${JSON.stringify({ type: "done", text: brainResponse.text, confidence: brainResponse.confidence, source: `Nexus Core Tier: ${brainResponse.tierUsed} (${brainResponse.modelName})` })}\n\n`,
          );
          res.end();

          // Phase C: Store to memory for future reuse
          const entryId = await MemoryBrain.store({
            query: message, answer: brainResponse.text,
            agentId: agent || 'system', userId: uid, sessionId: sid,
            modelUsed: brainResponse.modelName,
            tokensUsed: brainResponse.tokensUsed,
            costUsd: brainResponse.costUsd,
            domain: agent === 'rider' ? 'operational' : 'customer',
          });

          // Phase C: Append assistant turn to conversation
          ConversationMemory.appendTurn(sid, {
            role: 'assistant', content: brainResponse.text, timestamp: Date.now(),
            modelUsed: brainResponse.modelName, memoryHit: false,
          }).catch(() => {});

          // Legacy knowledge store + token tracking
          SharedStateStore.setKnowledge(message, brainResponse.text).catch(() => {});
          const roleKey = (agent || 'customer_ai').replace(/ /g, '_').toLowerCase();
          if (brainResponse.tokensUsed) {
            aiTokenCounters[roleKey] = (aiTokenCounters[roleKey] ?? 0) + brainResponse.tokensUsed;
            aiCostCounters[roleKey]  = (aiCostCounters[roleKey]  ?? 0) + (brainResponse.costUsd ?? 0);
          }
        } catch (err: any) {
          res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
          res.end();
        }
        return;
      }

      const brainResponse = await NexusUnifiedCore.process(contextualMsg, {
        agentRole: agent || "customer",
        systemInstruction: systemInstruction,
        history: history || [],
      });

      // Phase C: Store to memory
      MemoryBrain.store({
        query: message, answer: brainResponse.text,
        agentId: agent || 'system', userId: uid, sessionId: sid,
        modelUsed: brainResponse.modelName,
        tokensUsed: brainResponse.tokensUsed,
        costUsd: brainResponse.costUsd,
        domain: 'general',
      }).catch(() => {});

      // Append to conversation
      ConversationMemory.appendTurn(sid, {
        role: 'assistant', content: brainResponse.text, timestamp: Date.now(),
        modelUsed: brainResponse.modelName, memoryHit: false,
      }).catch(() => {});

      const roleKey2 = (agent || 'customer_ai').replace(/ /g, '_').toLowerCase();
      if (brainResponse.tokensUsed) {
        aiTokenCounters[roleKey2] = (aiTokenCounters[roleKey2] ?? 0) + brainResponse.tokensUsed;
        aiCostCounters[roleKey2]  = (aiCostCounters[roleKey2]  ?? 0) + (brainResponse.costUsd ?? 0);
      }

      const response = {
        text: brainResponse.text,
        confidence: brainResponse.confidence,
        source: `Nexus Core Tier: ${brainResponse.tierUsed} (${brainResponse.modelName})`,
      };

      SharedStateStore.setKnowledge(message, response.text).catch(() => {});
      res.json({ ...response, agent });
    } catch (error: any) {
      console.error("Chat error:", error);
      res.status(500).json({ error: "Failed to process chat" });
    }
  });

  // ── Phase C: Memory feedback (user rates AI answer) ────────────────────
  app.post('/api/memory/feedback', async (req: Request, res: Response) => {
    const { entryId, helpful, correction, userId } = req.body;
    if (!entryId || helpful === undefined) { res.status(400).json({ error: 'entryId and helpful required' }); return; }
    try {
      const { MemoryBrain } = await import('./src/lib/memory/brain/MemoryBrain');
      await MemoryBrain.recordFeedback({ entryId, helpful: Boolean(helpful), correction, userId });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── CTO Audit Part 7: Memory Dashboard overview. Complements (doesn't
  // replace) /api/memory/stats below, which covers cache-hit-rate stats from
  // MemoryBrain. This surfaces the 8-type taxonomy, version history, and
  // signature/approval status built in Parts 5-6 — real, previously-unexposed
  // backend capability, not new logic invented for this route. ──────────────
  app.get('/api/admin/memory/overview', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const { MemoryType } = await import('./src/lib/memory/interfaces/MemoryTypes');
      const { LearningApprovalGate } = await import('./src/lib/memory/LearningApprovalGate');

      const types = Object.values(MemoryType);
      const byType = await Promise.all(types.map(async (type) => {
        try {
          const entries = await NexusDB.find(`memory_${type}`, { limit: 500 });
          return { type, count: entries.length, cappedAt500: entries.length === 500 };
        } catch {
          return { type, count: 0, cappedAt500: false };
        }
      }));

      let versionedEntries = 0, signedImmutable = 0, unsignedImmutable = 0;
      try {
        const versions = await NexusDB.find('memory_versions', { limit: 500 });
        versionedEntries = new Set((versions as any[]).map((v) => v.entryId)).size;
      } catch { /* collection may not exist yet if no update has ever run */ }
      try {
        const immutable = await NexusDB.find('memory_immutable', { limit: 500 });
        for (const e of immutable as any[]) { if (e.signature) signedImmutable++; else unsignedImmutable++; }
      } catch { /* fine — same reasoning as above */ }

      const pendingLearning = await LearningApprovalGate.listPending(100);

      res.json({
        byType,
        versionedEntries,
        signedImmutable,
        unsignedImmutable,
        pendingLearningCount: pendingLearning.length,
        pendingLearningSample: pendingLearning.slice(0, 10),
        note: 'Counts capped at 500 per collection for dashboard performance — treat cappedAt500:true as "500+", not exact.',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Phase C: Memory stats (hit rate, API savings) ──────────────────────
  app.get('/api/memory/stats', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { MemoryBrain } = await import('./src/lib/memory/brain/MemoryBrain');
      res.json(MemoryBrain.getStats());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase C: Knowledge base — write entry ──────────────────────────────
  app.post('/api/memory/knowledge', requireAdminAuth, async (req: Request, res: Response) => {
    const { question, answer, category, tags } = req.body;
    if (!question || !answer) { res.status(400).json({ error: 'question and answer required' }); return; }
    try {
      const { MemoryBrain } = await import('./src/lib/memory/brain/MemoryBrain');
      const id = await MemoryBrain.writeKnowledge(question, answer, { category, tags, authorId: 'owner', source: 'manual' });
      res.json({ success: true, id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase C: Knowledge base — list entries ─────────────────────────────
  app.get('/api/memory/knowledge', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { db } = await import('./src/firebase');
      const { collection, getDocs, query, orderBy, limit } = await import('firebase/firestore');
      const lim = Math.min(parseInt(req.query.limit as string || '50'), 200);
      const snap = await getDocs(query(collection(db, 'knowledge_base'), orderBy('hitCount', 'desc'), limit(lim)));
      res.json({ entries: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase C: Customer preferences ─────────────────────────────────────
  app.get('/api/memory/preferences/:userId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ConversationMemory } = await import('./src/lib/memory/brain/ConversationMemory');
      const prefs = await ConversationMemory.getPreferences(req.params.userId);
      res.json({ preferences: prefs });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase C: Business learning event ──────────────────────────────────
  app.post('/api/memory/business-learn', requireAdminAuth, async (req: Request, res: Response) => {
    const { type, data, userId } = req.body;
    if (!type || !data) { res.status(400).json({ error: 'type and data required' }); return; }
    try {
      const { MemoryBrain } = await import('./src/lib/memory/brain/MemoryBrain');
      await MemoryBrain.learnFromBusiness({ type, data, userId });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase C: Conversation session summary ─────────────────────────────
  app.post('/api/memory/summarize-session', async (req: Request, res: Response) => {
    const { sessionId } = req.body;
    if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
    try {
      const { ConversationMemory } = await import('./src/lib/memory/brain/ConversationMemory');
      const summary = await ConversationMemory.generateSummary(sessionId);
      res.json({ success: true, summary });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/memory/update", async (req: Request, res: Response) => {
    const { type, data, ownerKey } = req.body;
    // Fails closed: if OWNER_SECRET isn't configured, no ownerKey can satisfy
    // this check (the previous version fell back to the literal string
    // "OWNER_SECRET" as the secret when the env var was unset, which meant
    // anyone who sent that exact string as ownerKey could write to
    // businessRules with no real secret configured at all).
    const ownerSecret = process.env.OWNER_SECRET;
    if (type === "businessRules" && (!ownerSecret || ownerKey !== ownerSecret)) {
      res.status(403).json({ error: "Unauthorized memory modification" });
      return;
    }

    const VALID_TYPES = ['customerInsights', 'securityLogs', 'businessRules'];
    if (VALID_TYPES.includes(type)) {
      const existing: any[] = (await SharedStateStore.get(type)) ?? [];
      existing.push({ ...data, timestamp: new Date().toISOString() });
      await SharedStateStore.set(type, existing);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Invalid memory type" });
    }
  });

  // =============================================
  // OMNICHANNEL WEBHOOK ROUTES
  // Register each social platform's webhook here.
  // =============================================

  // --- WhatsApp Business Cloud API ---
  // Verification endpoint (Meta calls GET to verify webhook)
  app.get("/api/webhooks/whatsapp", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  app.post("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    // Verify Meta signature (HMAC-SHA256)
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const signature = req.headers["x-hub-signature-256"] as string;
    if (appSecret && signature) {
      const valid = WebhookGuard.verifyFacebookSignature(JSON.stringify(req.body), signature, appSecret);
      if (!valid) {
        console.warn("[WhatsApp] Invalid signature — possible replay attack");
        res.status(403).json({ error: "Invalid signature" });
        return;
      }
    }

    try {
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      const adapter = OmniConnector.getConnector("whatsapp") as any;
      if (adapter?.handleWebhookPayload) {
        const messages = await adapter.handleWebhookPayload(req.body);
        // Start SLA timer for each inbound customer message
        if (Array.isArray(messages)) {
          for (const msg of messages) {
            if (msg.direction === 'inbound') {
              await SLAMonitor.startTimer(
                `wa_${msg.senderId}`, msg.senderId, 'whatsapp', msg.text || ''
              ).catch(() => {});
            }
          }
        }
      }
    } catch (e: any) {
      console.error("[WhatsApp Webhook]", e.message);
    }
    res.sendStatus(200); // Always 200 to Meta
  });

  // --- Facebook Messenger ---
  app.get("/api/webhooks/facebook", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.FACEBOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  app.post("/api/webhooks/facebook", async (req: Request, res: Response) => {
    // Verify Meta HMAC signature
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (appSecret && !verifyMetaSignature(req, appSecret)) {
      res.status(403).json({ error: "Invalid signature" });
      return;
    }
    try {
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      const adapter = OmniConnector.getConnector("messenger") as any;
      if (adapter?.handleWebhookPayload) await adapter.handleWebhookPayload(req.body);
    } catch (e: any) { console.error("[Facebook Webhook]", e.message); }
    res.sendStatus(200);
  });

  // --- Instagram DM (same Meta webhook, different object type) ---
  app.post("/api/webhooks/instagram", async (req: Request, res: Response) => {
    try {
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      const adapter = OmniConnector.getConnector("instagram") as any;
      if (adapter?.handleWebhookPayload) await adapter.handleWebhookPayload(req.body);
    } catch (e: any) {
      console.error("[Instagram Webhook]", e.message);
    }
    res.sendStatus(200);
  });

  // --- Telegram ---
  app.post("/api/webhooks/telegram", async (req: Request, res: Response) => {
    // Nonce dedup for Telegram (update_id)
    const updateId = (req.body as Record<string, unknown>)?.update_id as string;
    if (updateId) {
      const { allowed } = await WebhookGuard.checkAndRecordNonce("telegram", String(updateId));
      if (!allowed) { res.sendStatus(200); return; } // Duplicate — ignore silently
    }
    try {
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      const adapter = OmniConnector.getConnector("telegram") as any;
      if (adapter?.handleWebhookPayload) await adapter.handleWebhookPayload(req.body);
    } catch (e: any) {
      console.error("[Telegram Webhook]", e.message);
    }
    res.sendStatus(200);
  });

  // --- Discord (Interactions endpoint) ---
  app.post("/api/webhooks/discord", async (req: Request, res: Response) => {
    try {
      // Discord requires immediate ACK for PING (type 1)
      if (req.body.type === 1) {
        res.json({ type: 1 });
        return;
      }
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      const adapter = OmniConnector.getConnector("discord") as any;
      if (adapter?.handleWebhookPayload) await adapter.handleWebhookPayload(req.body);
      res.sendStatus(200);
    } catch (e: any) {
      console.error("[Discord Webhook]", e.message);
      res.sendStatus(200);
    }
  });

  // --- Email (Mailgun/SendGrid inbound parsing) ---
  app.post("/api/webhooks/email", async (req: Request, res: Response) => {
    try {
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      const adapter = OmniConnector.getConnector("email") as any;
      if (adapter?.handleWebhookPayload) await adapter.handleWebhookPayload(req.body);
    } catch (e: any) {
      console.error("[Email Webhook]", e.message);
    }
    res.sendStatus(200);
  });

  // --- TikTok Business Messaging (Phase G) ---
  app.post("/api/webhooks/tiktok", async (req: Request, res: Response) => {
    try {
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      const adapter = OmniConnector.getConnector("tiktok") as any;
      if (adapter?.verifySignature) {
        const sig = req.headers['tiktok-signature'] as string | undefined;
        const rawBody = JSON.stringify(req.body);
        if (!adapter.verifySignature(rawBody, sig)) {
          console.warn("[TikTok Webhook] Invalid signature");
          res.sendStatus(403);
          return;
        }
      }
      if (adapter?.handleWebhookPayload) await adapter.handleWebhookPayload(req.body);
    } catch (e: any) {
      console.error("[TikTok Webhook]", e.message);
    }
    res.sendStatus(200);
  });

  // --- OmniHub Admin API ---
  app.get("/api/omni/logs", requireAdminAuth, async (req: Request, res: Response) => {
    const { OmniConnector } = require("./src/lib/integrations/OmniConnector");
    const platform = req.query.platform as string | undefined;
    const limit = parseInt(req.query.limit as string || "50");
    res.json(await OmniConnector.getMessageLogs(limit, platform));
  });

  app.get("/api/omni/stats", requireAdminAuth, async (req: Request, res: Response) => {
    const { OmniConnector } = require("./src/lib/integrations/OmniConnector");
    res.json(await OmniConnector.getStats());
  });

  app.post("/api/omni/send", requireAdminAuth, async (req: Request, res: Response) => {
    const { platform, userId, content } = req.body;
    const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
    const success = await OmniConnector.sendManual(platform, userId, content);
    res.json({ success });
  });

  // ── Phase G: Live pipeline test — routes a synthetic message through the
  // real identity resolution -> memory -> AI -> persistence pipeline ──────
  app.post("/api/omni/test-message", requireAdminAuth, async (req: Request, res: Response) => {
    const { platform, content, senderId, senderName } = req.body;
    if (!platform || !content) { res.status(400).json({ error: 'platform and content required' }); return; }
    try {
      const { OmniConnector } = await import("./src/lib/integrations/OmniConnector");
      await OmniConnector.processTestMessage({
        platform, content,
        senderId: senderId ?? `test_${platform}_admin`,
        senderName: senderName ?? `Test User (${platform})`,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- AI Provider Registry API (admin-protected) ---
  app.get("/api/ai/providers", requireAdminAuth, (req: Request, res: Response) => {
    const { GlobalProviderRegistry } = require("./src/lib/ai/providers/ProviderRegistry");
    res.json(GlobalProviderRegistry.getHealthSummary());
  });

  // ── CTO Audit Part 10: Capability Registry — "Registry of what each agent
  // can do," suggested as a future addition. Built on AgentCapabilities
  // (Parts 3-4), not a new system — this is the first endpoint exposing it
  // as one list. Live registry data, not a static document.
  app.get("/api/admin/agents/capabilities", requireAdminAuth, (req: Request, res: Response) => {
    const { AgentRegistry } = require("./src/lib/core/registry/AgentRegistry");
    res.json({ agents: AgentRegistry.listCapabilities() });
  });

  app.post("/api/ai/providers/role-override", requireAdminAuth, (req: Request, res: Response) => {
    const { role, providerId } = req.body;
    const { GlobalProviderRegistry } = require("./src/lib/ai/providers/ProviderRegistry");
    GlobalProviderRegistry.setPrimaryForRole(role, providerId);
    res.json({ success: true, message: `Role "${role}" pinned to "${providerId}"` });
  });

  app.delete("/api/ai/providers/role-override/:role", requireAdminAuth, (req: Request, res: Response) => {
    const { GlobalProviderRegistry } = require("./src/lib/ai/providers/ProviderRegistry");
    GlobalProviderRegistry.clearRoleOverride(req.params.role);
    res.json({ success: true });
  });




  // WebSocket stats endpoint
  app.get("/api/admin/websocket/stats", requireAdminAuth, (_req: Request, res: Response) => {
    res.json({ stats: nexusWS.getStats(), timestamp: new Date().toISOString() });
  });

  // Phase 9: Prometheus metrics endpoint
  // Public — anyone loading the storefront needs the current brand theme,
  // not just authenticated admins.
  app.get("/api/theme", async (_req: Request, res: Response) => {
    try {
      const { BrandThemeService } = await import("./src/lib/theme/BrandThemeService");
      res.json(await BrandThemeService.getDerivedPalettes());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/metrics", (_req: Request, res: Response) => {
    const { EventBus } = require("./src/lib/core/events/NexusEventBus");
    const { GlobalProviderRegistry } = require("./src/lib/ai/providers/ProviderRegistry");
    const { TaskQueue } = require("./src/lib/queue/TaskQueue");
    const { AuditLog } = require("./src/lib/security/audit/ImmutableAuditLog");
    const ebMetrics = EventBus.getMetrics();
    const provHealth = GlobalProviderRegistry.getHealthSummary();
    const queueMetrics = TaskQueue.getMetrics();
    const auditStats = AuditLog.getStats();

    // Prometheus text format
    const lines = [
      '# HELP nexus_events_total Total events emitted',
      '# TYPE nexus_events_total counter',
      `nexus_events_total ${ebMetrics.emitted}`,
      '# HELP nexus_events_failed_total Total failed event handlers',
      '# TYPE nexus_events_failed_total counter',
      `nexus_events_failed_total ${ebMetrics.failed}`,
      '# HELP nexus_dlq_size Dead letter queue size',
      '# TYPE nexus_dlq_size gauge',
      `nexus_dlq_size ${ebMetrics.dlqSize}`,
      '# HELP nexus_ai_providers_healthy Healthy AI providers',
      '# TYPE nexus_ai_providers_healthy gauge',
      `nexus_ai_providers_healthy ${provHealth.healthy}`,
      '# HELP nexus_ai_providers_total Total registered AI providers',
      '# TYPE nexus_ai_providers_total gauge',
      `nexus_ai_providers_total ${provHealth.total}`,
      '# HELP nexus_queue_enqueued_total Total jobs enqueued',
      '# TYPE nexus_queue_enqueued_total counter',
      `nexus_queue_enqueued_total ${queueMetrics.enqueued}`,
      '# HELP nexus_queue_completed_total Total jobs completed',
      '# TYPE nexus_queue_completed_total counter',
      `nexus_queue_completed_total ${queueMetrics.completed}`,
      '# HELP nexus_queue_failed_total Total jobs failed',
      '# TYPE nexus_queue_failed_total counter',
      `nexus_queue_failed_total ${queueMetrics.failed}`,
      '# HELP nexus_queue_dlq_size Queue dead letter queue size',
      '# TYPE nexus_queue_dlq_size gauge',
      `nexus_queue_dlq_size ${queueMetrics.dlq}`,
      '# HELP nexus_audit_records_total Total audit log records',
      '# TYPE nexus_audit_records_total counter',
      `nexus_audit_records_total ${auditStats.totalRecords}`,
      '# HELP nexus_uptime_seconds Server uptime in seconds',
      '# TYPE nexus_uptime_seconds counter',
      `nexus_uptime_seconds ${Math.floor(process.uptime())}`,
      '# HELP nexus_memory_heap_used_bytes Node.js heap memory used',
      '# TYPE nexus_memory_heap_used_bytes gauge',
      `nexus_memory_heap_used_bytes ${process.memoryUsage().heapUsed}`,
      // Phase A: per-role AI token/cost counters
      '# HELP nexus_ai_tokens_total Total AI tokens used by role',
      '# TYPE nexus_ai_tokens_total counter',
      ...Object.entries(aiTokenCounters).map(([role, tokens]) => `nexus_ai_tokens_total{role="${role}"} ${tokens}`),
      '# HELP nexus_ai_cost_usd_total Total AI cost in USD by role',
      '# TYPE nexus_ai_cost_usd_total counter',
      ...Object.entries(aiCostCounters).map(([role, cost]) => `nexus_ai_cost_usd_total{role="${role}"} ${(cost as number).toFixed(6)}`),
    ];
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(lines.join('\n') + '\n');
  });

  // Phase A: Real server log stream
  app.get('/api/admin/logs', requireAdminAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
    const logs = await SharedStateStore.getApiLogs(limit);
    res.json(logs);
  });

  // ── Phase G: Omnichannel — Customer Identity & Journey routes ──────────

  // Search customer identities (by phone, email, name, channel ID)
  app.get('/api/admin/omni/customers/search', requireAdminAuth, async (req: Request, res: Response) => {
    const q = (req.query.q as string) ?? '';
    if (!q) { res.status(400).json({ error: 'q (query) required' }); return; }
    try {
      const { CustomerJourneyService } = await import('./src/lib/omnichannel/CustomerJourneyService');
      res.json({ results: await CustomerJourneyService.search(q) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get full 360° customer journey (identity + timeline + orders + payments + prefs)
  app.get('/api/admin/omni/customers/:customerId/journey', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { CustomerJourneyService } = await import('./src/lib/omnichannel/CustomerJourneyService');
      const journey = await CustomerJourneyService.getJourney(req.params.customerId);
      if (!journey) { res.status(404).json({ error: 'Customer not found' }); return; }
      res.json(journey);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get raw identity record (channels linked, primary phone/email)
  app.get('/api/admin/omni/customers/:customerId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { CustomerIdentityService } = await import('./src/lib/omnichannel/CustomerIdentityService');
      const identity = await CustomerIdentityService.getById(req.params.customerId);
      if (!identity) { res.status(404).json({ error: 'Customer not found' }); return; }
      res.json(identity);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Merge two customer identities (admin-initiated deduplication)
  app.post('/api/admin/omni/customers/merge', requireAdminAuth, async (req: Request, res: Response) => {
    const { keepId, mergeId } = req.body;
    if (!keepId || !mergeId) { res.status(400).json({ error: 'keepId and mergeId required' }); return; }
    try {
      const { CustomerIdentityService } = await import('./src/lib/omnichannel/CustomerIdentityService');
      const result = await CustomerIdentityService.merge(keepId, mergeId);
      if (!result.success) { res.status(400).json({ error: result.error }); return; }
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Unified conversation timeline for one customer
  app.get('/api/admin/omni/customers/:customerId/timeline', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { MessageHistoryService } = await import('./src/lib/omnichannel/MessageHistoryService');
      const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
      res.json({ messages: await MessageHistoryService.getTimeline(req.params.customerId, limit) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase P: Final Audit — fixes for issues found during audit sweep ──

  // Real fraud detection summary (previously: UI read a `checks.fraud`
  // field that no server response ever produced — see PHASE_P_CHANGELOG.md)
  app.get('/api/admin/audit/fraud-summary', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { FraudDetectionEngine } = await import('./src/lib/security/FraudDetectionEngine');
      const hours = parseInt((req.query.hours as string) || '24');
      res.json(await FraudDetectionEngine.getSummary(hours));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Server-side AI ping for the audit dashboard's latency check.
  // Previously, SystemAuditSimulationApp.tsx called `new GoogleGenAI()`
  // directly from CLIENT-SIDE React code, reading `process.env.GEMINI_API_KEY`
  // — undefined/unsafe in a browser bundle, and a real risk of the key
  // leaking into client-shipped code if a build tool ever inlined it.
  // This route runs the same ping server-side, where env vars belong.
  app.post('/api/admin/audit/ai-ping', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { AIProviderOrchestrator } = await import('./src/lib/ai/providers/AIProviderOrchestrator');
      const start = Date.now();
      const result = await AIProviderOrchestrator.call({ messages: [{ role: 'user', content: 'Respond with SYSTEM_OK ping test.' }] });
      const latencyMs = Date.now() - start;
      res.json({ ok: true, latencyMs, text: result?.text ?? null });
    } catch (err: any) {
      res.json({ ok: false, error: err.message, latencyMs: null });
    }
  });

  // Real integration configuration status — NEVER returns actual key
  // values (security), only whether each is configured server-side via
  // env vars. Replaces IntegrationManagerApp's previous fake "save" form
  // that stored nothing (see PHASE_P_CHANGELOG.md).
  app.get('/api/admin/audit/integration-status', requireAdminAuth, async (req: Request, res: Response) => {
    const aiKeys = ['GEMINI_API_KEY','OPENAI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY',
      'HUGGINGFACE_API_KEY','DEEPSEEK_API_KEY','MISTRAL_API_KEY','OLLAMA_BASE_URL'];
    const msgKeys = ['WHATSAPP_TOKEN','TELEGRAM_BOT_TOKEN','FB_PAGE_ACCESS_TOKEN',
      'DISCORD_BOT_TOKEN','TIKTOK_ACCESS_TOKEN','SMTP_USER'];
    const paymentKeys = ['STRIPE_SECRET_KEY','BKASH_APP_KEY','NAGAD_MERCHANT_ID','ROCKET_API_KEY'];

    const ai: Record<string,boolean> = {};
    for (const k of aiKeys) {
      const alias = k.replace('_API_KEY','').replace('_BASE_URL','').toLowerCase();
      ai[alias] = !!(process.env[k]);
    }
    const messaging: Record<string,boolean> = {};
    for (const k of msgKeys) {
      const alias = k.split('_')[0].toLowerCase();
      messaging[alias] = !!(process.env[k]);
    }
    const payments: Record<string,boolean> = {};
    for (const k of paymentKeys) {
      const alias = k.split('_')[0].toLowerCase();
      payments[alias] = !!(process.env[k]);
    }

    // Determine public webhook base URL
    const proto = req.headers['x-forwarded-proto'] as string || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] as string || req.headers.host || `localhost:${PORT}`;
    const webhookBaseUrl = process.env.APP_URL || `${proto}://${host}`;

    res.json({ ai, messaging, payments, webhookBaseUrl });
  });

  // Run a scheduled task immediately (on-demand execution).
  // Phase P finding: the "Run Now" button in TaskSchedulerApp previously
  // had no onClick handler at all — this wires it to a real AI call using
  // the task's stored agent/parameters. NOTE: this does NOT make the
  // trigger/frequency (hourly/daily/weekly) fields functional — no cron
  // reads scheduled_tasks and executes them automatically. That remains
  // an honest, documented gap (see PHASE_P_CHANGELOG.md); this route only
  // fixes the manual "Run Now" action.
  app.post('/api/admin/audit/run-task/:taskId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const task = await NexusDB.get('scheduled_tasks', req.params.taskId);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

      const { NexusUnifiedCore } = await import('./src/lib/core/NexusUnifiedCore');
      const result = await NexusUnifiedCore.process(task.parameters ?? '', { agentRole: task.agent ?? 'system' });
      res.json({ success: true, output: result?.text ?? '(no output)', ranAt: new Date().toISOString() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase Q: Owner NL Control + Automation Rule Engine ────────────────

  // POST /api/admin/owner-ai/parse
  // Parses a plain-language command into a structured rule preview.
  // Does NOT create the rule — returns a preview for the owner to confirm.
  app.post('/api/admin/owner-ai/parse', requireAdminAuth, async (req: Request, res: Response) => {
    const { command } = req.body;
    if (!command || typeof command !== 'string') {
      res.status(400).json({ error: 'command (string) required' }); return;
    }
    try {
      const { NLCommandParser } = await import('./src/lib/automation/NLCommandParser');
      const parsed = await NLCommandParser.parse(command.trim(), (req as any).userId || 'owner');
      res.json(parsed);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/admin/automation-rules
  app.get('/api/admin/automation-rules', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
      const rules = await AutomationRuleEngine.listRules();
      res.json({ rules });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/automation-rules — create a rule from parsed preview
  app.post('/api/admin/automation-rules', requireAdminAuth, async (req: Request, res: Response) => {
    const { name, conditionType, conditionParams, actionType, actionParams, source, originalCommand } = req.body;
    if (!name || !conditionType || !actionType) {
      res.status(400).json({ error: 'name, conditionType, and actionType required' }); return;
    }
    try {
      const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
      const id = await AutomationRuleEngine.createRule({
        name, conditionType, conditionParams: conditionParams ?? {},
        actionType, actionParams: actionParams ?? {},
        source: source ?? 'manual', originalCommand,
        createdBy: (req as any).userId || 'owner',
      });
      res.json({ success: true, id });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // PATCH /api/admin/automation-rules/:id/toggle
  app.patch('/api/admin/automation-rules/:id/toggle', requireAdminAuth, async (req: Request, res: Response) => {
    const { active } = req.body;
    if (typeof active !== 'boolean') { res.status(400).json({ error: 'active (boolean) required' }); return; }
    try {
      const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
      await AutomationRuleEngine.setActive(req.params.id, active, (req as any).userId || 'owner');
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /api/admin/automation-rules/:id
  app.delete('/api/admin/automation-rules/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
      await AutomationRuleEngine.deleteRule(req.params.id, (req as any).userId || 'owner');
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/automation-rules/:id/run — manual "Run Now"
  app.post('/api/admin/automation-rules/:id/run', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
      const result = await AutomationRuleEngine.runRule(req.params.id, (req as any).userId || 'owner');
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/automation-rules/:id/preview — dry-run condition only, no action
  app.post('/api/admin/automation-rules/:id/preview', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const ruleRaw = await NexusDB.get('automation_rules', req.params.id);
      if (!ruleRaw) { res.status(404).json({ error: 'Rule not found' }); return; }
      const targets = await AutomationRuleEngine.evaluateCondition(
        ruleRaw.conditionType, ruleRaw.conditionParams ?? {}
      );
      res.json({ matched: targets.length, targets: targets.slice(0, 50) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase Q: Coupon admin routes ───────────────────────────────────────

  // GET /api/admin/coupons
  app.get('/api/admin/coupons', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { CouponEngine } = await import('./src/lib/promotions/CouponEngine');
      const coupons = await CouponEngine.list(200);
      res.json({ coupons });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/coupons — manual creation
  app.post('/api/admin/coupons', requireAdminAuth, async (req: Request, res: Response) => {
    const { type, value, reason, targetCustomerIds, maxRedemptions, expiresInDays } = req.body;
    if (!type || value === undefined || !reason) {
      res.status(400).json({ error: 'type, value, and reason required' }); return;
    }
    try {
      const { CouponEngine } = await import('./src/lib/promotions/CouponEngine');
      const coupon = await CouponEngine.create({
        type, value, reason,
        targetCustomerIds: targetCustomerIds ?? null,
        maxRedemptions, expiresInDays,
        source: 'manual',
        createdBy: (req as any).userId || 'owner',
      });
      res.json({ success: true, coupon });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // DELETE /api/admin/coupons/:id — deactivate
  app.delete('/api/admin/coupons/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { CouponEngine } = await import('./src/lib/promotions/CouponEngine');
      await CouponEngine.deactivate(req.params.id, (req as any).userId || 'owner');
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/store/validate-coupon — customer-facing validation endpoint
  // Validates a coupon code before checkout; does NOT redeem it.
  app.post('/api/store/validate-coupon', async (req: Request, res: Response) => {
    const { code, customerId, orderSubtotal } = req.body;
    if (!code || !customerId || orderSubtotal === undefined) {
      res.status(400).json({ error: 'code, customerId, and orderSubtotal required' }); return;
    }
    try {
      const { CouponEngine } = await import('./src/lib/promotions/CouponEngine');
      const result = await CouponEngine.validate(code, customerId, Number(orderSubtotal));
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/store/redeem-coupon — called during order confirmation
  // DOCUMENTED GAP: CheckoutModal.tsx creates orders client-side via Firestore addDoc().
  // Until checkout moves to a server-side route, the UI cannot call this automatically.
  // This endpoint is real and usable (e.g., from a future server-side checkout route or
  // a post-order webhook), but the client flow does not yet wire it in.
  app.post('/api/store/redeem-coupon', async (req: Request, res: Response) => {
    const { couponId, code, customerId, orderId, discountAmount } = req.body;
    if (!couponId || !code || !customerId || !orderId || discountAmount === undefined) {
      res.status(400).json({ error: 'couponId, code, customerId, orderId, discountAmount required' }); return;
    }
    try {
      const { CouponEngine } = await import('./src/lib/promotions/CouponEngine');
      await CouponEngine.redeem(couponId, code, customerId, orderId, Number(discountAmount));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase T: Admin Alerts Panel routes ────────────────────────────────

  app.get('/api/admin/alerts', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const limit = Math.min(parseInt((req.query.limit as string) || '200'), 500);
      const alerts = await NexusDB.find('admin_alerts', { orderBy: 'createdAt', orderDir: 'desc', limit });
      res.json({ alerts });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/admin/alerts/:id/read', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      await NexusDB.update('admin_alerts', req.params.id, { read: true });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/admin/alerts/read-all', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const alerts = await NexusDB.find('admin_alerts', { where: [{ field: 'read', op: '==', value: false }], limit: 500 });
      await Promise.all(alerts.map((a: any) => NexusDB.update('admin_alerts', a.id, { read: true })));
      res.json({ success: true, updated: alerts.length });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/admin/alerts/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      await NexusDB.delete('admin_alerts', req.params.id);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase S: Dynamic Pricing Engine ───────────────────────────────────

  // GET /api/admin/pricing/suggestions — compute suggestions for all active products
  app.get('/api/admin/pricing/suggestions', requireAdminAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 200);
    try {
      const { DynamicPricingEngine } = await import('./src/lib/pricing/DynamicPricingEngine');
      const suggestions = await DynamicPricingEngine.suggestForAll(limit);
      res.json({ suggestions, generatedAt: new Date().toISOString() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/admin/pricing/suggestions/:productId — suggest for one product
  app.get('/api/admin/pricing/suggestions/:productId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { DynamicPricingEngine } = await import('./src/lib/pricing/DynamicPricingEngine');
      const suggestion = await DynamicPricingEngine.suggestForProduct(req.params.productId);
      if (!suggestion) { res.status(404).json({ error: 'Product not found or no data' }); return; }
      res.json(suggestion);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/pricing/simulate — what-if price simulation
  // "What happens to revenue if I drop price by 5%?"
  app.post('/api/admin/pricing/simulate', requireAdminAuth, async (req: Request, res: Response) => {
    const { productId, currentPrice, newPrice } = req.body;
    if (!productId || currentPrice === undefined || newPrice === undefined) {
      res.status(400).json({ error: 'productId, currentPrice, newPrice required' }); return;
    }
    try {
      const { DynamicPricingEngine } = await import('./src/lib/pricing/DynamicPricingEngine');
      const result = await DynamicPricingEngine.simulate(productId, Number(currentPrice), Number(newPrice));
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/pricing/apply — owner explicitly applies a suggested price
  // Never called autonomously — requires human confirmation.
  app.post('/api/admin/pricing/apply', requireAdminAuth, async (req: Request, res: Response) => {
    const { productId, newPrice, suggestion } = req.body;
    if (!productId || newPrice === undefined || !suggestion) {
      res.status(400).json({ error: 'productId, newPrice, suggestion required' }); return;
    }
    try {
      const { DynamicPricingEngine } = await import('./src/lib/pricing/DynamicPricingEngine');
      await DynamicPricingEngine.applyPrice(productId, Number(newPrice), suggestion, (req as any).userId || 'owner');
      res.json({ success: true, appliedPrice: Number(newPrice) });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/admin/pricing/log — audit log of applied price changes
  app.get('/api/admin/pricing/log', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { DynamicPricingEngine } = await import('./src/lib/pricing/DynamicPricingEngine');
      const log = await DynamicPricingEngine.getSuggestionsLog(100);
      res.json({ log });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase R: Loyalty Points Engine ────────────────────────────────────

  // GET /api/loyalty/:customerId — balance + tier
  app.get('/api/loyalty/:customerId', async (req: Request, res: Response) => {
    try {
      const { LoyaltyEngine } = await import('./src/lib/loyalty/LoyaltyEngine');
      const balance = await LoyaltyEngine.getBalance(req.params.customerId);
      res.json(balance);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/loyalty/:customerId/transactions
  app.get('/api/loyalty/:customerId/transactions', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    try {
      const { LoyaltyEngine } = await import('./src/lib/loyalty/LoyaltyEngine');
      const txns = await LoyaltyEngine.getTransactions(req.params.customerId, limit);
      res.json({ transactions: txns });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/loyalty/award — called after payment confirmation (server-side event)
  // Awards points for an order. Idempotent on orderId.
  app.post('/api/loyalty/award', async (req: Request, res: Response) => {
    const { customerId, orderId, orderAmount } = req.body;
    if (!customerId || !orderId || orderAmount === undefined) {
      res.status(400).json({ error: 'customerId, orderId, orderAmount required' }); return;
    }
    try {
      const { LoyaltyEngine } = await import('./src/lib/loyalty/LoyaltyEngine');
      const result = await LoyaltyEngine.awardForOrder(customerId, orderId, Number(orderAmount));
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/loyalty/redeem
  app.post('/api/loyalty/redeem', async (req: Request, res: Response) => {
    const { customerId, points, orderId } = req.body;
    if (!customerId || !points || !orderId) {
      res.status(400).json({ error: 'customerId, points, orderId required' }); return;
    }
    try {
      const { LoyaltyEngine } = await import('./src/lib/loyalty/LoyaltyEngine');
      const result = await LoyaltyEngine.redeem(customerId, Number(points), orderId);
      res.json(result);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/admin/loyalty/award-bonus — manual admin bonus
  app.post('/api/admin/loyalty/award-bonus', requireAdminAuth, async (req: Request, res: Response) => {
    const { customerId, points, type, referenceId, note } = req.body;
    if (!customerId || !points || !referenceId || !note) {
      res.status(400).json({ error: 'customerId, points, referenceId, note required' }); return;
    }
    try {
      const { LoyaltyEngine } = await import('./src/lib/loyalty/LoyaltyEngine');
      await LoyaltyEngine.awardBonus(customerId, Number(points), type ?? 'earn_bonus', referenceId, note, (req as any).userId || 'owner');
      res.json({ success: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/admin/cart-recovery-log
  app.get('/api/admin/cart-recovery-log', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { AbandonedCartRecoveryEngine } = await import('./src/lib/marketing/AbandonedCartRecoveryEngine');
      const log = await AbandonedCartRecoveryEngine.getRecoveryLog(200);
      res.json({ log });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase J: Procurement / Supplier OS admin routes ────────────────────

  // Suppliers CRUD
  app.get('/api/admin/procurement/suppliers', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { SupplierRepository } = await import('./src/lib/procurement/SupplierRepository');
      const activeOnly = req.query.activeOnly !== 'false';
      res.json({ suppliers: await SupplierRepository.findAll(activeOnly) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/procurement/suppliers', requireAdminAuth, async (req: Request, res: Response) => {
    const { name, contactName, email, phone, address, defaultLeadTimeDays, defaultPaymentTermsDays, currency, notes } = req.body;
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    try {
      const { SupplierRepository } = await import('./src/lib/procurement/SupplierRepository');
      const id = await SupplierRepository.create({
        name, contactName, email, phone, address,
        defaultLeadTimeDays: defaultLeadTimeDays ?? 7,
        defaultPaymentTermsDays: defaultPaymentTermsDays ?? 30,
        currency: currency ?? 'BDT', notes, active: true,
      });
      res.json({ success: true, id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/admin/procurement/suppliers/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { SupplierRepository } = await import('./src/lib/procurement/SupplierRepository');
      await SupplierRepository.update(req.params.id, req.body);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/procurement/suppliers/:id/products', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { SupplierRepository } = await import('./src/lib/procurement/SupplierRepository');
      res.json({ products: await SupplierRepository.getProducts(req.params.id) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Purchase Orders lifecycle
  app.post('/api/admin/procurement/purchase-orders', requireAdminAuth, async (req: Request, res: Response) => {
    const { supplierId, supplierName, lineItems, currency, expectedDeliveryDate, notes } = req.body;
    if (!supplierId || !lineItems?.length) { res.status(400).json({ error: 'supplierId and lineItems required' }); return; }
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      const authUser = (req as any).authUser;
      const id = await PurchaseOrderEngine.create({
        supplierId, supplierName, lineItems, currency: currency ?? 'BDT',
        expectedDeliveryDate, notes, createdBy: authUser?.uid ?? 'admin',
      });
      res.json({ success: true, id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/procurement/purchase-orders', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      res.json({ purchaseOrders: await PurchaseOrderEngine.list(req.query.status as any) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/procurement/purchase-orders/summary', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      res.json(await PurchaseOrderEngine.getSummary());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/procurement/purchase-orders/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      const po = await PurchaseOrderEngine.getById(req.params.id);
      if (!po) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(po);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/procurement/purchase-orders/:id/send', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      await PurchaseOrderEngine.markSent(req.params.id);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/procurement/purchase-orders/:id/confirm', requireAdminAuth, async (req: Request, res: Response) => {
    const { expectedDeliveryDate } = req.body;
    if (!expectedDeliveryDate) { res.status(400).json({ error: 'expectedDeliveryDate required' }); return; }
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      await PurchaseOrderEngine.markConfirmed(req.params.id, expectedDeliveryDate);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/procurement/purchase-orders/:id/receive', requireAdminAuth, async (req: Request, res: Response) => {
    const { received } = req.body;
    if (!received?.length) { res.status(400).json({ error: 'received array required' }); return; }
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      const result = await PurchaseOrderEngine.receiveStock(req.params.id, received);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/procurement/purchase-orders/:id/cancel', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { PurchaseOrderEngine } = await import('./src/lib/procurement/PurchaseOrderEngine');
      await PurchaseOrderEngine.cancel(req.params.id, req.body?.reason);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Stock alerts — real DSV + InventoryAI-adjusted restock predictions
  app.get('/api/admin/procurement/stock-alerts', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { StockAlertEngine } = await import('./src/lib/procurement/StockAlertEngine');
      const limit = Math.min(parseInt((req.query.limit as string) || '500'), 2000);
      res.json({ alerts: await StockAlertEngine.runAlerts(limit) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase I: Marketing Intelligence admin routes ───────────────────────

  // Customer segment overview (all segments with counts, LTV, churn risk)
  app.get('/api/admin/marketing/segments', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { SegmentationEngine } = await import('./src/lib/marketing/SegmentationEngine');
      const max = Math.min(parseInt((req.query.maxCustomers as string) || '1000'), 5000);
      res.json({ segments: await SegmentationEngine.getSegmentSummaries(max) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Members of a specific segment
  app.get('/api/admin/marketing/segments/:segment/members', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { SegmentationEngine } = await import('./src/lib/marketing/SegmentationEngine');
      res.json({ members: await SegmentationEngine.getSegmentMembers(req.params.segment as any) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Churn risk — customers most likely to stop ordering
  app.get('/api/admin/marketing/churn', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ChurnPredictor } = await import('./src/lib/marketing/ChurnPredictor');
      const threshold = parseInt((req.query.threshold as string) || '50');
      const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
      res.json({ atRisk: await ChurnPredictor.getAtRiskCustomers(threshold, limit) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Create a campaign draft
  app.post('/api/admin/marketing/campaigns', requireAdminAuth, async (req: Request, res: Response) => {
    const { name, segment, channel, content, subject, discountCode, attributionWindowDays } = req.body;
    if (!name || !segment || !channel || !content) {
      res.status(400).json({ error: 'name, segment, channel, content required' }); return;
    }
    try {
      const { CampaignEngine } = await import('./src/lib/marketing/CampaignEngine');
      const authUser = (req as any).authUser;
      const id = await CampaignEngine.create({
        name, segment, channel, content, subject, discountCode,
        attributionWindowDays: attributionWindowDays ?? 7,
        createdBy: authUser?.uid ?? 'admin',
      });
      res.json({ success: true, id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // List campaigns
  app.get('/api/admin/marketing/campaigns', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { CampaignEngine } = await import('./src/lib/marketing/CampaignEngine');
      res.json({ campaigns: await CampaignEngine.list() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Send a campaign
  app.post('/api/admin/marketing/campaigns/:id/send', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { CampaignEngine } = await import('./src/lib/marketing/CampaignEngine');
      const result = await CampaignEngine.send(req.params.id);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Measure real attribution for a sent campaign
  app.post('/api/admin/marketing/campaigns/:id/attribution', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { CampaignEngine } = await import('./src/lib/marketing/CampaignEngine');
      const attribution = await CampaignEngine.measureAttribution(req.params.id);
      if (!attribution) { res.status(400).json({ error: 'Campaign not sent or has no recipients yet' }); return; }
      res.json(attribution);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Generate AI campaign copy for a festival/occasion
  app.post('/api/admin/marketing/generate-copy', requireAdminAuth, async (req: Request, res: Response) => {
    const { festivalName, targetAudience } = req.body;
    if (!festivalName) { res.status(400).json({ error: 'festivalName required' }); return; }
    try {
      const { GrowthEngine } = await import('./src/lib/business/GrowthEngine');
      const copy = await GrowthEngine.generateFestivalCampaign(festivalName, targetAudience ?? 'all customers');
      res.json({ copy });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase H: Owner Control / Command Center admin routes ──────────────

  // Get current emergency shutdown state
  app.get('/api/admin/control/shutdown', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { OwnerControlEngine } = await import('./src/lib/control/OwnerControlEngine');
      res.json(await OwnerControlEngine.getShutdownState());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Engage emergency shutdown (real — blocks new AI calls + new payments)
  app.post('/api/admin/control/shutdown/engage', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { OwnerControlEngine } = await import('./src/lib/control/OwnerControlEngine');
      const authUser = (req as any).authUser;
      await OwnerControlEngine.engageEmergencyShutdown(authUser?.uid ?? 'owner-ui', req.body?.reason);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Disengage emergency shutdown
  app.post('/api/admin/control/shutdown/disengage', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { OwnerControlEngine } = await import('./src/lib/control/OwnerControlEngine');
      const authUser = (req as any).authUser;
      await OwnerControlEngine.disengageEmergencyShutdown(authUser?.uid ?? 'owner-ui');
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Export a tenant's real data (orders, conversations, preferences) — "Zero Vendor Lock-in"
  app.get('/api/admin/control/export/:tenantId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { OwnerControlEngine } = await import('./src/lib/control/OwnerControlEngine');
      const bundleStr = await OwnerControlEngine.exportTenantData(req.params.tenantId);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="export_${req.params.tenantId}.json"`);
      res.send(bundleStr);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Business Command Center — real cross-cutting summary for the owner's
  // single-glance dashboard: pulls from Phase K (finance), Phase B
  // (delivery), Phase M (security), Phase F (payments) instead of
  // fabricated "ONLINE" placeholders.
  app.get('/api/admin/control/command-center', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const [profitMoM, settlementSummary, securitySummary, riderResults, shutdownState] = await Promise.allSettled([
        import('./src/lib/finance/ProfitEngine').then(m => m.ProfitEngine.getMonthOverMonth()),
        import('./src/lib/payments/SettlementEngine').then(m => m.SettlementEngine.getSummary()),
        import('./src/lib/security/auth/AnomalyDetectionEngine').then(m => m.AnomalyDetectionEngine.getSummary(1)),
        import('./src/lib/delivery/RiderLocationService').then(m => m.RiderLocationServer.getLiveRiders()),
        import('./src/lib/control/OwnerControlEngine').then(m => m.OwnerControlEngine.getShutdownState()),
      ]);

      res.json({
        profit: profitMoM.status === 'fulfilled' ? profitMoM.value.current : null,
        settlement: settlementSummary.status === 'fulfilled' ? settlementSummary.value : null,
        security: securitySummary.status === 'fulfilled' ? securitySummary.value : null,
        ridersOnline: riderResults.status === 'fulfilled' ? riderResults.value.filter((r: any) => r.status === 'available' || r.status === 'Available').length : 0,
        ridersTotal: riderResults.status === 'fulfilled' ? riderResults.value.length : 0,
        shutdown: shutdownState.status === 'fulfilled' ? shutdownState.value : { engaged: false },
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase K: Financial OS admin routes ─────────────────────────────────

  // Profit report for an arbitrary date range
  app.get('/api/admin/finance/profit', requireAdminAuth, async (req: Request, res: Response) => {
    const { from, to, label } = req.query as Record<string, string>;
    if (!from || !to) { res.status(400).json({ error: 'from and to (ISO dates) required' }); return; }
    try {
      const { ProfitEngine } = await import('./src/lib/finance/ProfitEngine');
      res.json(await ProfitEngine.getProfitReport(from, to, label ?? 'Custom Range'));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Month-over-month profit comparison
  app.get('/api/admin/finance/profit/month-over-month', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { ProfitEngine } = await import('./src/lib/finance/ProfitEngine');
      res.json(await ProfitEngine.getMonthOverMonth());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Per-product profitability ranking
  app.get('/api/admin/finance/products/profitability', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ProfitEngine } = await import('./src/lib/finance/ProfitEngine');
      const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
      res.json({ products: await ProfitEngine.getProductProfitability(limit) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Cash flow report for an arbitrary date range
  app.get('/api/admin/finance/cashflow', requireAdminAuth, async (req: Request, res: Response) => {
    const { from, to, label } = req.query as Record<string, string>;
    if (!from || !to) { res.status(400).json({ error: 'from and to (ISO dates) required' }); return; }
    try {
      const { CashFlowEngine } = await import('./src/lib/finance/CashFlowEngine');
      res.json(await CashFlowEngine.getCashFlowReport(from, to, label ?? 'Custom Range'));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Month-over-month cash flow comparison
  app.get('/api/admin/finance/cashflow/month-over-month', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { CashFlowEngine } = await import('./src/lib/finance/CashFlowEngine');
      res.json(await CashFlowEngine.getMonthOverMonth());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Daily cash flow series for charting
  app.get('/api/admin/finance/cashflow/daily', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { CashFlowEngine } = await import('./src/lib/finance/CashFlowEngine');
      const days = Math.min(parseInt((req.query.days as string) || '14'), 90);
      res.json({ series: await CashFlowEngine.getDailySeries(days) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Cash flow risk flags (overdue settlements, pending-cash ratio)
  app.get('/api/admin/finance/cashflow/risk', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { CashFlowEngine } = await import('./src/lib/finance/CashFlowEngine');
      res.json({ flags: await CashFlowEngine.getRiskFlags() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Record an expense
  app.post('/api/admin/finance/expenses', requireAdminAuth, async (req: Request, res: Response) => {
    const { category, amount, currency, description, vendor, incurredAt, recordedBy } = req.body;
    if (!category || amount == null || !description) { res.status(400).json({ error: 'category, amount, description required' }); return; }
    try {
      const { ExpenseTracker } = await import('./src/lib/finance/ExpenseTracker');
      const id = await ExpenseTracker.record({
        category, amount: Number(amount), currency: currency ?? 'BDT', description, vendor,
        incurredAt: incurredAt ?? new Date().toISOString(), recordedBy: recordedBy ?? 'admin',
      });
      res.json({ success: true, id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // List expenses in a date range
  app.get('/api/admin/finance/expenses', requireAdminAuth, async (req: Request, res: Response) => {
    const { from, to } = req.query as Record<string, string>;
    try {
      const { ExpenseTracker } = await import('./src/lib/finance/ExpenseTracker');
      const fromISO = from ?? new Date(Date.now() - 30*24*60*60*1000).toISOString();
      const toISO = to ?? new Date().toISOString();
      res.json({ expenses: await ExpenseTracker.getInRange(fromISO, toISO) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Update an expense
  app.put('/api/admin/finance/expenses/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ExpenseTracker } = await import('./src/lib/finance/ExpenseTracker');
      await ExpenseTracker.update(req.params.id, req.body);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Delete an expense
  app.delete('/api/admin/finance/expenses/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ExpenseTracker } = await import('./src/lib/finance/ExpenseTracker');
      await ExpenseTracker.delete(req.params.id);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Manually record a rider payout (no auto-calculated rate exists yet — see Phase K changelog)
  app.post('/api/admin/finance/rider-payout', requireAdminAuth, async (req: Request, res: Response) => {
    const { riderId, periodLabel, amount, currency } = req.body;
    if (!riderId || !periodLabel || amount == null) { res.status(400).json({ error: 'riderId, periodLabel, amount required' }); return; }
    try {
      const { ExpenseTracker } = await import('./src/lib/finance/ExpenseTracker');
      await ExpenseTracker.recordRiderPayout(riderId, periodLabel, Number(amount), currency ?? 'BDT');
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase F: Payment OS admin routes ───────────────────────────────────

  // List all payment providers + configuration status
  app.get('/api/admin/payments/providers', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { PaymentRegistry } = await import('./src/lib/payments/PaymentRegistry');
      res.json({ providers: PaymentRegistry.listAll() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Settlement summary
  app.get('/api/admin/payments/settlement', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { SettlementEngine } = await import('./src/lib/payments/SettlementEngine');
      res.json(await SettlementEngine.getSummary());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Trigger settlement batch build for a date
  app.post('/api/admin/payments/settlement/build', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { SettlementEngine } = await import('./src/lib/payments/SettlementEngine');
      const batches = await SettlementEngine.buildDailyBatches(req.body?.date);
      res.json({ success: true, batches });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Mark a settlement batch as settled
  app.post('/api/admin/payments/settlement/:batchId/settle', requireAdminAuth, async (req: Request, res: Response) => {
    const { actualAmount } = req.body;
    if (actualAmount == null) { res.status(400).json({ error: 'actualAmount required' }); return; }
    try {
      const { SettlementEngine } = await import('./src/lib/payments/SettlementEngine');
      const result = await SettlementEngine.markSettled(req.params.batchId, Number(actualAmount));
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Overdue settlement batches
  app.get('/api/admin/payments/settlement/overdue', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { SettlementEngine } = await import('./src/lib/payments/SettlementEngine');
      res.json({ overdue: await SettlementEngine.findOverdueBatches() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Run reconciliation now
  app.post('/api/admin/payments/reconcile', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ReconciliationEngine } = await import('./src/lib/payments/ReconciliationEngine');
      const report = await ReconciliationEngine.run(req.body?.lookbackDays ?? 7);
      res.json({ success: true, report });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get latest reconciliation report
  app.get('/api/admin/payments/reconciliation/latest', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { ReconciliationEngine } = await import('./src/lib/payments/ReconciliationEngine');
      res.json(await ReconciliationEngine.getLatest());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get open discrepancies
  app.get('/api/admin/payments/discrepancies', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ReconciliationEngine } = await import('./src/lib/payments/ReconciliationEngine');
      res.json({ discrepancies: await ReconciliationEngine.getOpenDiscrepancies(Number(req.query.days) || 7) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Payment audit log — recent entries
  app.get('/api/admin/payments/audit', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { PaymentAuditLog } = await import('./src/lib/payments/PaymentAuditLog');
      res.json({ entries: await PaymentAuditLog.getRecent(Number(req.query.limit) || 100) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Verify audit log chain integrity
  app.get('/api/admin/payments/audit/verify', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { PaymentAuditLog } = await import('./src/lib/payments/PaymentAuditLog');
      res.json(await PaymentAuditLog.verifyChain());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Pending refunds awaiting async settlement
  app.get('/api/admin/payments/refunds/pending', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { RefundEngine } = await import('./src/lib/payments/RefundEngine');
      res.json({ pending: await RefundEngine.getPendingRefunds() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase M: JWT Authentication & Security routes ─────────────────────

  // Exchange a Firebase ID token for a Nexus JWT pair (access + refresh).
  // Client flow: Firebase Auth login -> get idToken -> POST here -> store
  // returned accessToken/refreshToken -> use accessToken as Bearer for API calls.
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const { idToken } = req.body;
    if (!idToken) { res.status(400).json({ error: 'idToken required' }); return; }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    try {
      const { verifyIdToken } = await import('./src/lib/firebase-admin/AdminSDK');
      const decoded = await verifyIdToken(idToken);
      if (!decoded) throw new Error('Invalid or expired ID token');
      const uid = decoded.uid as string;

      // Determine role: check custom claims first, fall back to Firestore user doc, default 'customer'
      let role: any = (decoded as any).role || (decoded as any).claims?.role;
      if (!role) {
        const { NexusDB } = await import('./src/lib/database/NexusDB');
        const userDoc = await NexusDB.get('users', uid);
        role = userDoc?.role ?? 'customer';
      }

      const { JWTService } = await import('./src/lib/security/auth/JWTService');
      const { accessToken, refreshToken, sessionId } = await JWTService.issueTokenPair(uid, role);

      // Phase M: login anomaly checks (new device, impossible travel, bot signal)
      const { DeviceFingerprintService } = await import('./src/lib/security/auth/DeviceFingerprint');
      const { AnomalyDetectionEngine } = await import('./src/lib/security/auth/AnomalyDetectionEngine');
      const fp = DeviceFingerprintService.extract(req);
      await AnomalyDetectionEngine.checkLogin(uid, fp);
      await AnomalyDetectionEngine.clearFailedLogins(uid);

      // Bind session to device fingerprint for future mismatch detection
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      await NexusDB.update('auth_sessions', sessionId, { deviceFingerprint: fp.fingerprint, ipAddress: fp.ipAddress });

      res.json({ accessToken, refreshToken, role, uid });
    } catch (err: any) {
      const identifier = req.body?.idToken ? 'unknown-uid' : 'unknown';
      try {
        const { AnomalyDetectionEngine } = await import('./src/lib/security/auth/AnomalyDetectionEngine');
        await AnomalyDetectionEngine.recordFailedLogin(identifier, ip);
      } catch { /* non-blocking */ }
      console.error('[Auth][Login]', err.message);
      res.status(401).json({ error: 'Invalid or expired ID token' });
    }
  });

  // Refresh an access token using a valid refresh token.
  app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) { res.status(400).json({ error: 'refreshToken required' }); return; }
    try {
      const { JWTService } = await import('./src/lib/security/auth/JWTService');
      const result = await JWTService.refreshAccessToken(refreshToken);
      if (!result) { res.status(401).json({ error: 'Invalid, expired, or revoked refresh token' }); return; }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Logout — revoke the current session.
  app.post('/api/auth/logout', requireAuth, async (req: Request, res: Response) => {
    try {
      const { JWTService } = await import('./src/lib/security/auth/JWTService');
      const authUser = (req as any).authUser;
      await JWTService.revokeSession(authUser.sessionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: revoke all sessions for a user (security incident response)
  app.post('/api/admin/auth/revoke-all/:uid', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { JWTService } = await import('./src/lib/security/auth/JWTService');
      const count = await JWTService.revokeAllSessions(req.params.uid);
      res.json({ success: true, revokedCount: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: recent security events (anomalies, bot traffic, brute force, etc.)
  app.get('/api/admin/security/events', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { AnomalyDetectionEngine } = await import('./src/lib/security/auth/AnomalyDetectionEngine');
      const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
      res.json({ events: await AnomalyDetectionEngine.getRecentEvents(limit) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: security event summary (counts by severity/type)
  app.get('/api/admin/security/summary', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { AnomalyDetectionEngine } = await import('./src/lib/security/auth/AnomalyDetectionEngine');
      const days = parseInt((req.query.days as string) || '7');
      res.json(await AnomalyDetectionEngine.getSummary(days));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: active sessions overview
  app.get('/api/admin/security/sessions', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const sessions = await NexusDB.find('auth_sessions', { orderBy: 'issuedAt', orderDir: 'desc', limit: 200 });
      res.json({ sessions: sessions.filter((s: any) => !s.revoked) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Phase E: Database abstraction management routes ───────────────────

  // Current DB provider + health
  app.get('/api/admin/db/status', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const health = await NexusDB.healthCheck();
      res.json({
        configuredProvider: process.env.DB_PROVIDER ?? 'firestore',
        activeProvider: health.provider,
        healthy: health.healthy,
        latencyMs: health.latencyMs,
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Run migration between providers
  app.post('/api/admin/db/migrate', requireAdminAuth, async (req: Request, res: Response) => {
    const { source, destination, collections } = req.body;
    if (!source || !destination) { res.status(400).json({ error: 'source and destination required' }); return; }
    try {
      const { MigrationTool, ALL_COLLECTIONS } = await import('./src/lib/database/MigrationTool');
      const report = await MigrationTool.migrate(source, destination, collections ?? ALL_COLLECTIONS);
      res.json({ success: true, report });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Verify parity between two providers
  app.post('/api/admin/db/verify', requireAdminAuth, async (req: Request, res: Response) => {
    const { source, destination, collections } = req.body;
    if (!source || !destination) { res.status(400).json({ error: 'source and destination required' }); return; }
    try {
      const { MigrationTool, ALL_COLLECTIONS } = await import('./src/lib/database/MigrationTool');
      const results = await MigrationTool.verify(source, destination, collections ?? ALL_COLLECTIONS);
      res.json({ results });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // List supported providers + their configuration status
  app.get('/api/admin/db/providers', requireAdminAuth, async (_req: Request, res: Response) => {
    res.json({
      providers: [
        { id: 'firestore', name: 'Firebase Firestore', configured: true, isDefault: true },
        { id: 'postgres',  name: 'PostgreSQL',          configured: !!process.env.POSTGRES_URL },
        { id: 'supabase',  name: 'Supabase',            configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) },
        { id: 'mongodb',   name: 'MongoDB',             configured: !!process.env.MONGODB_URI },
        { id: 'memory',    name: 'In-Memory (testing)', configured: true },
      ],
      active: process.env.DB_PROVIDER ?? 'firestore',
    });
  });

  // ── Phase D: AI Provider management routes ────────────────────────────

  // Provider health report
  app.get('/api/admin/ai/health', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { AIProviderOrchestrator } = await import('./src/lib/ai/providers/AIProviderOrchestrator');
      res.json(AIProviderOrchestrator.getHealthReport());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Provider benchmarks
  app.get('/api/admin/ai/benchmarks', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { AIProviderOrchestrator } = await import('./src/lib/ai/providers/AIProviderOrchestrator');
      res.json({ benchmarks: await AIProviderOrchestrator.getBenchmarks() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Trigger benchmark manually
  app.post('/api/admin/ai/benchmark', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { AIProviderOrchestrator } = await import('./src/lib/ai/providers/AIProviderOrchestrator');
      const results = await AIProviderOrchestrator.runBenchmark();
      res.json({ success: true, results });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Spend summary
  app.get('/api/admin/ai/spend', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { AIProviderOrchestrator } = await import('./src/lib/ai/providers/AIProviderOrchestrator');
      res.json(await AIProviderOrchestrator.getSpendSummary());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Set role override (admin pins a role to a provider)
  app.post('/api/admin/ai/role-override', requireAdminAuth, async (req: Request, res: Response) => {
    const { role, providerId } = req.body;
    if (!role || !providerId) { res.status(400).json({ error: 'role and providerId required' }); return; }
    try {
      const { GlobalProviderRegistry: GPR } = require('./src/lib/ai/providers/ProviderRegistry');
      GPR.setPrimaryForRole(role, providerId);
      res.json({ success: true, message: `Role "${role}" pinned to provider "${providerId}"` });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Clear role override
  app.delete('/api/admin/ai/role-override/:role', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { GlobalProviderRegistry: GPR } = require('./src/lib/ai/providers/ProviderRegistry');
      GPR.clearRoleOverride(req.params.role);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // List all providers and their role overrides
  app.get('/api/admin/ai/providers', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { GlobalProviderRegistry: GPR } = require('./src/lib/ai/providers/ProviderRegistry');
      const providers = GPR.listAll().map((p: any) => ({
        id: p.id,
        providerId: p.provider.providerId,
        isHealthy: p.isHealthy,
        failureCount: p.failureCount,
        capabilities: p.capabilities,
        addedAt: new Date(p.addedAt).toISOString(),
      }));
      const overrides = GPR.getRoleOverrides();
      res.json({ providers, roleOverrides: overrides });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Phase 4: Task Queue admin API
  app.get("/api/admin/queue/status", requireAdminAuth, (_req: Request, res: Response) => {
    res.json({ metrics: TaskQueue.getStats(), dlq: TaskQueue.getDLQ(20) });
  });

  app.post("/api/admin/queue/retry-dlq", requireAdminAuth, async (_req: Request, res: Response) => {
    const result = await TaskQueue.retryDLQ();
    res.json({ success: true, ...result });
  });

  app.post("/api/admin/queue/enqueue", requireAdminAuth, async (req: Request, res: Response) => {
    const { type, data, priority, maxRetries } = req.body;
    if (!type) { res.status(400).json({ error: "type required" }); return; }
    const jobId = await TaskQueue.enqueue(type, data, { priority, maxRetries });
    res.json({ success: true, jobId });
  });

  // Phase 7: Business Intelligence API
  app.get("/api/admin/bi/revenue", requireAdminAuth, async (_req: Request, res: Response) => {
    const metrics = await BIEngine.getRevenueMetrics();
    res.json(metrics);
  });

  app.get("/api/admin/bi/forecast", requireAdminAuth, async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string || "7");
    const forecasts = await BIEngine.forecastRevenue(days);
    res.json({ forecasts, generatedAt: Date.now() });
  });

  app.get("/api/admin/bi/customer/:userId/score", requireAdminAuth, async (req: Request, res: Response) => {
    const score = await BIEngine.scoreCustomer(req.params.userId);
    res.json(score);
  });

  app.get("/api/admin/bi/products/trends", requireAdminAuth, async (_req: Request, res: Response) => {
    const trends = await BIEngine.analyzeProductTrends();
    res.json({ trends, count: trends.length });
  });

  app.get("/api/admin/bi/report/daily", requireAdminAuth, async (_req: Request, res: Response) => {
    const report = await BIEngine.generateDailyReport();
    res.json(report);
  });

  app.get("/api/admin/bi/riders/optimize", requireAdminAuth, async (_req: Request, res: Response) => {
    const assignments = await BIEngine.optimizeRiderAssignments();
    res.json({ assignments, count: assignments.length });
  });

  // Recommendations (public endpoint — called by storefront)
  app.get("/api/recommendations/:userId", async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string || "6");
    const recs = await RecommendationEngine.getRecommendations(req.params.userId, limit);
    res.json({ recommendations: recs });
  });

  app.post("/api/recommendations/interaction", async (req: Request, res: Response) => {
    const { userId, productId, action } = req.body;
    if (!userId || !productId || !action) {
      res.status(400).json({ error: "userId, productId, action required" }); return;
    }
    await RecommendationEngine.recordInteraction(userId, productId, action);
    res.json({ success: true });
  });

  // Phase 10: Autonomous Evolution API
  app.get("/api/admin/evolution/report", requireAdminAuth, async (_req: Request, res: Response) => {
    const report = await EvolutionEngine.generateEvolutionReport();
    res.json(report);
  });

  app.get("/api/admin/evolution/proposals", requireAdminAuth, (_req: Request, res: Response) => {
    const status = _req.query.status as any;
    res.json({ proposals: EvolutionEngine.listProposals(status) });
  });

  app.post("/api/admin/evolution/proposals/:id/approve", requireAdminAuth, (req: Request, res: Response) => {
    const userId = (req as any).user?.uid || "admin";
    const ok = EvolutionEngine.approveProposal(req.params.id, userId);
    res.json({ success: ok });
  });

  app.post("/api/admin/evolution/proposals/:id/reject", requireAdminAuth, (req: Request, res: Response) => {
    const ok = EvolutionEngine.rejectProposal(req.params.id);
    res.json({ success: ok });
  });

  app.get("/api/admin/evolution/insights", requireAdminAuth, (_req: Request, res: Response) => {
    res.json({ insights: EvolutionEngine.getInsights(50) });
  });

  app.post("/api/admin/evolution/run-cycle", requireAdminAuth, async (_req: Request, res: Response) => {
    const insights = await EvolutionEngine.runLearningCycle();
    res.json({ insights, count: insights.length });
  });

  // Phase 5: Security & Audit admin endpoints
  app.get("/api/admin/audit", requireAdminAuth, (req: Request, res: Response) => {
    const { eventType, subjectId, severity, since, limit } = req.query as any;
    const entries = AuditLog.query({
      eventType, subjectId, severity,
      since: since ? parseInt(since) : undefined,
      limit: limit ? parseInt(limit) : 100,
    });
    res.json({ entries, stats: AuditLog.getStats() });
  });

  app.get("/api/admin/audit/verify", requireAdminAuth, async (_req: Request, res: Response) => {
    const result = AuditLog.verifyChain(200);
    res.json(result);
  });

  app.get("/api/admin/abac/policies", requireAdminAuth, (_req: Request, res: Response) => {
    res.json({ policies: ABACEngine.listPolicies() });
  });

  app.post("/api/admin/abac/evaluate", requireAdminAuth, (req: Request, res: Response) => {
    const { subject, resource, action } = req.body;
    const result = ABACEngine.evaluate(subject, resource, action);
    res.json(result);
  });

  app.get("/api/admin/ai/providers/full", requireAdminAuth, (_req: Request, res: Response) => {
    const { GlobalProviderRegistry } = require("./src/lib/ai/providers/ProviderRegistry");
    const summary = GlobalProviderRegistry.getHealthSummary();
    res.json({
      ...summary,
      roleOverrides: GlobalProviderRegistry.getRoleOverrides(),
    });
  });

  // Phase 5: Tenant isolation stats
  app.get("/api/admin/tenant/:tenantId/usage", requireAdminAuth, async (req: Request, res: Response) => {
    const usage = await TenantIsolation.getUsageStats(req.params.tenantId);
    res.json(usage);
  });

  // Phase 3: Orchestration admin API
  app.get("/api/admin/agents", requireAdminAuth, (_req: Request, res: Response) => {
    res.json(Orchestrator.getAgentHealth());
  });

  app.post("/api/admin/agents/:agentId/execute", requireAdminAuth, async (req: Request, res: Response) => {
    const { task, context, userId } = req.body;
    const result = await Orchestrator.executeAgent(req.params.agentId, { task, context, userId });
    res.json(result);
  });

  app.post("/api/admin/orchestrate", requireAdminAuth, async (req: Request, res: Response) => {
    const { task, context, userId, sessionId } = req.body;
    if (!task) { res.status(400).json({ error: "task required" }); return; }
    const result = await Orchestrator.process({ task, context, userId, sessionId, traceId: req.traceId as string });
    res.json(result);
  });

  app.get("/api/admin/tools", requireAdminAuth, (req: Request, res: Response) => {
    const role = req.query.role as string | undefined;
    res.json({ tools: Orchestrator.listTools(role), executionLog: Orchestrator.getToolLog(20) });
  });

  app.post("/api/admin/tools/:toolName/execute", requireAdminAuth, async (req: Request, res: Response) => {
    const { input, agentRole } = req.body;
    const result = await Orchestrator.executeTool(req.params.toolName, input, {
      agentId: "admin-manual", agentRole: agentRole || "supervisor",
    });
    res.json(result);
  });

  // Phase 6: Hybrid AI management endpoints
  app.get("/api/admin/ai/ollama/models", requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { OllamaAdapter } = await import("./src/lib/core/adapters/hybrid/OllamaAdapter");
      const adapter = new OllamaAdapter();
      const models = await adapter.listModels();
      res.json({ models });
    } catch (e: any) { res.status(503).json({ error: e.message }); }
  });

  app.post("/api/admin/ai/ollama/pull", requireAdminAuth, async (req: Request, res: Response) => {
    const { model } = req.body;
    if (!model) { res.status(400).json({ error: "model required" }); return; }
    try {
      const { OllamaAdapter } = await import("./src/lib/core/adapters/hybrid/OllamaAdapter");
      const adapter = new OllamaAdapter(model);
      const ok = await adapter.pullModel(model);
      res.json({ success: ok, model });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/ai/litellm/models", requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { LiteLLMAdapter } = await import("./src/lib/core/adapters/hybrid/HybridAdapters");
      const adapter = new LiteLLMAdapter();
      const models = await adapter.listModels();
      res.json({ models });
    } catch (e: any) { res.status(503).json({ error: e.message }); }
  });

  // Phase 2: Memory Engine API routes (8 memory types)
  memoryRoutes(app, requireAdminAuth);

  // FCM token registration (called from client when user logs in)
  app.post("/api/register-fcm-token", async (req: Request, res: Response) => {
    const { userId, token } = req.body;
    if (!userId || !token) { res.status(400).json({ error: "userId and token required" }); return; }
    try {
      const { db } = await import("./src/firebase");
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(doc(db, "user_fcm_tokens", userId), { token, updatedAt: new Date().toISOString() });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Admin: trigger automation event manually (for testing/ops)
  app.post("/api/admin/trigger-event", requireAdminAuth, async (req: Request, res: Response) => {
    const { event, payload } = req.body;
    await AutomationEngine.triggerEvent(event, payload);
    res.json({ success: true });
  });

  // Admin: run daily jobs on demand
  app.post("/api/admin/run-daily-jobs", requireAdminAuth, async (req: Request, res: Response) => {
    await AutomationEngine.runDailyJobs();
    res.json({ success: true, message: "Daily jobs completed" });
  });

  // ── Phase A: Real Payment Routes (BKash, Nagad, Stripe Refund) ────────
  const { mountPaymentRoutes } = await import('./src/lib/payments/PaymentRoutes');
  mountPaymentRoutes(app);

  // ── Phase Y: Referral System ───────────────────────────────────────────

  // GET /api/referral/code/:userId — get or create referral code for a user
  app.get('/api/referral/code/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    try {
      const { ReferralEngine } = await import('./src/lib/growth/ReferralEngine');
      const code = await ReferralEngine.getOrCreateUserCode(userId);
      res.json({ code, referralUrl: `${process.env.APP_URL ?? ''}/signup?ref=${code}` });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/referral/process — called on new user signup with a referral code
  app.post('/api/referral/process', async (req: Request, res: Response) => {
    const { newUserId, referralCode } = req.body;
    if (!newUserId || !referralCode) {
      res.status(400).json({ error: 'newUserId and referralCode required' }); return;
    }
    try {
      const { ReferralEngine } = await import('./src/lib/growth/ReferralEngine');
      const result = await ReferralEngine.processReferral(newUserId, referralCode);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/referral/stats/:userId — referral stats for a user
  app.get('/api/referral/stats/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    try {
      const { db } = await import('./src/firebase');
      const { doc, getDoc, collection, query, where, getDocs } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'user_referrals', userId));
      if (!snap.exists()) { res.json({ code: null, referralsCount: 0, rewardPoints: 0 }); return; }
      const q = query(collection(db, 'referral_history'), where('referrerId', '==', userId));
      const hist = await getDocs(q);
      const referrals = hist.docs.map(d => d.data());
      res.json({ ...snap.data(), recentReferrals: referrals.slice(0, 10) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/admin/referral/leaderboard — top referrers by count (admin)
  app.get('/api/admin/referral/leaderboard', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const refs = await NexusDB.find('user_referrals', {
        orderBy: 'referralsCount', orderDir: 'desc', limit: 50,
      });
      res.json({ leaderboard: refs });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase Y: Backup & Recovery ────────────────────────────────────────

  // POST /api/admin/backup/run — trigger manual backup
  app.post('/api/admin/backup/run', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { BackupRecoveryEngine } = await import('./src/lib/infrastructure/BackupRecoveryEngine');
      // Run in background — don't block the HTTP response (can take 10-30s)
      const { BackgroundQueue } = await import('./src/lib/core/QueueWorker');
      const jobId = `backup-${Date.now()}`;
      await BackgroundQueue.enqueue('backup_run', async () => {
        await BackupRecoveryEngine.executeAutoBackup('manual');
      });
      res.json({ success: true, message: 'Backup queued. Check /api/admin/backup/list in ~30 seconds.', jobId });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/admin/backup/list — list available backups
  app.get('/api/admin/backup/list', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { BackupRecoveryEngine } = await import('./src/lib/infrastructure/BackupRecoveryEngine');
      const backups = await BackupRecoveryEngine.listBackups(20);
      res.json({ backups });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/backup/restore/dry-run — dry-run restore from a file path
  app.post('/api/admin/backup/restore/dry-run', requireAdminAuth, async (req: Request, res: Response) => {
    const { fsPath } = req.body;
    if (!fsPath) { res.status(400).json({ error: 'fsPath required' }); return; }
    try {
      const { BackupRecoveryEngine } = await import('./src/lib/infrastructure/BackupRecoveryEngine');
      const result = await BackupRecoveryEngine.restoreFromFile(fsPath, true);
      res.json({ ...result, message: 'Dry run complete. No data was written. POST /api/admin/backup/restore to apply.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/backup/restore — real restore (requires explicit confirm field)
  app.post('/api/admin/backup/restore', requireAdminAuth, async (req: Request, res: Response) => {
    const { fsPath, confirm } = req.body;
    if (!fsPath) { res.status(400).json({ error: 'fsPath required' }); return; }
    if (confirm !== 'YES_RESTORE') {
      res.status(400).json({ error: 'Pass confirm: "YES_RESTORE" to confirm. This operation writes data.' }); return;
    }
    try {
      const { BackupRecoveryEngine } = await import('./src/lib/infrastructure/BackupRecoveryEngine');
      const result = await BackupRecoveryEngine.restoreFromFile(fsPath, false);
      res.json({ success: true, ...result });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/admin/backup/export/:collection — export single collection as JSON download
  app.get('/api/admin/backup/export/:collection', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { BackupRecoveryEngine } = await import('./src/lib/infrastructure/BackupRecoveryEngine');
      const json = await BackupRecoveryEngine.exportCollection(req.params.collection);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.collection}-export-${Date.now()}.json"`);
      res.send(json);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase Y: Scale Hardening ──────────────────────────────────────────

  // GET /api/health — comprehensive health check for load balancers + uptime monitors
  
  // POST /api/admin/queue/enqueue — enqueue a heavy task (CEO report, demand forecast) async
  // Prevents HTTP timeout on large computations
  app.post('/api/admin/queue/enqueue', requireAdminAuth, async (req: Request, res: Response) => {
    const { taskType, params } = req.body;
    const ALLOWED_TASKS = ['ceo_report', 'demand_forecast', 'backup', 'automation_rules_run'];
    if (!ALLOWED_TASKS.includes(taskType)) {
      res.status(400).json({ error: `Unknown task. Allowed: ${ALLOWED_TASKS.join(', ')}` }); return;
    }
    try {
      const { BackgroundQueue } = await import('./src/lib/core/QueueWorker');
      const jobId = `${taskType}-${Date.now()}`;
      await BackgroundQueue.enqueue(taskType, async () => {
        if (taskType === 'ceo_report') {
          const { CEOAgent } = await import('./src/lib/orchestration/agents/CEOAgent');
          await CEOAgent.generateDailyBrief();
        } else if (taskType === 'demand_forecast') {
          const { DemandForecastingEngine } = await import('./src/lib/business-intelligence/forecasting/DemandForecastingEngine');
          await DemandForecastingEngine.forecastAll(params?.days ?? 14, params?.limit ?? 50);
        } else if (taskType === 'backup') {
          const { BackupRecoveryEngine } = await import('./src/lib/infrastructure/BackupRecoveryEngine');
          await BackupRecoveryEngine.executeAutoBackup(params?.label ?? 'queued');
        } else if (taskType === 'automation_rules_run') {
          const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
          await AutomationRuleEngine.runAllActiveRules();
        }
      });
      res.json({ success: true, jobId, message: `Task "${taskType}" queued. Results available after completion.` });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase X: Demand Forecasting Engine ────────────────────────────────

  app.get('/api/admin/forecast/products', requireAdminAuth, async (req: Request, res: Response) => {
    const days = Math.min(parseInt((req.query.days as string) || '14'), 30);
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 100);
    try {
      const { DemandForecastingEngine } = await import('./src/lib/business-intelligence/forecasting/DemandForecastingEngine');
      const summary = await DemandForecastingEngine.forecastAll(days, limit);
      res.json(summary);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/forecast/products/:productId', requireAdminAuth, async (req: Request, res: Response) => {
    const days = Math.min(parseInt((req.query.days as string) || '14'), 30);
    const name = (req.query.name as string) || req.params.productId;
    try {
      const { DemandForecastingEngine } = await import('./src/lib/business-intelligence/forecasting/DemandForecastingEngine');
      const forecast = await DemandForecastingEngine.forecastProduct(req.params.productId, name, days);
      res.json(forecast);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/forecast/restock-alerts', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { DemandForecastingEngine } = await import('./src/lib/business-intelligence/forecasting/DemandForecastingEngine');
      const alerts = await DemandForecastingEngine.getRestockAlerts(14);
      res.json({ alerts });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase X: Competitor Intelligence ──────────────────────────────────

  app.post('/api/admin/competitor/analyse', requireAdminAuth, async (req: Request, res: Response) => {
    const { productName, currentPrice, productId } = req.body;
    if (!productName || currentPrice === undefined) {
      res.status(400).json({ error: 'productName and currentPrice required' }); return;
    }
    try {
      const { CompetitorAI } = await import('./src/lib/intelligence/CompetitorAI');
      const analysis = await CompetitorAI.analysePricing(productName, Number(currentPrice), productId);
      res.json(analysis);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/competitor/history/:productId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { CompetitorAI } = await import('./src/lib/intelligence/CompetitorAI');
      const history = await CompetitorAI.getAnalysisHistory(req.params.productId);
      res.json({ history });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase X: CEO Agent ─────────────────────────────────────────────────

  app.get('/api/admin/ceo/report', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { CEOAgent } = await import('./src/lib/orchestration/agents/CEOAgent');
      const report = await CEOAgent.getLatestReport();
      res.json(report ?? { message: 'No report yet. POST /api/admin/ceo/report/generate to create one.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/ceo/report/generate', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { CEOAgent } = await import('./src/lib/orchestration/agents/CEOAgent');
      const report = await CEOAgent.generateDailyBrief();
      res.json(report);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/ceo/report/history', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { CEOAgent } = await import('./src/lib/orchestration/agents/CEOAgent');
      const history = await CEOAgent.getReportHistory(7);
      res.json({ history });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase A (upgraded Phase W): Smart multi-factor rider assignment ──────
  // Replaces pure-distance assignment with composite scoring:
  // distance (50%) + performance (30%) + active load (20%)
  app.post('/api/delivery/assign', requireAdminAuth, async (req: Request, res: Response) => {
    const { orderId, pickupLat, pickupLng } = req.body;
    if (!orderId || pickupLat == null || pickupLng == null) {
      res.status(400).json({ error: 'orderId, pickupLat, pickupLng required' }); return;
    }
    try {
      const { SmartRiderAssignmentEngine } = await import('./src/lib/logistics/SmartRiderAssignmentEngine');
      const result = await SmartRiderAssignmentEngine.assignOrder(
        orderId, Number(pickupLat), Number(pickupLng),
        (req as any).userId || 'owner',
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase W: Rider assignment preview (dry-run — no write) ────────────
  app.post('/api/delivery/assign/preview', requireAdminAuth, async (req: Request, res: Response) => {
    const { pickupLat, pickupLng } = req.body;
    if (pickupLat == null || pickupLng == null) {
      res.status(400).json({ error: 'pickupLat, pickupLng required' }); return;
    }
    try {
      const { SmartRiderAssignmentEngine } = await import('./src/lib/logistics/SmartRiderAssignmentEngine');
      const preview = await SmartRiderAssignmentEngine.previewAssignment(Number(pickupLat), Number(pickupLng));
      res.json(preview);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase W: Route optimization for multi-stop delivery ───────────────
  app.post('/api/delivery/route/optimize', requireAdminAuth, async (req: Request, res: Response) => {
    const { pickupLat, pickupLng, deliveries } = req.body;
    // deliveries: Array<{ id, lat, lng, label? }>
    if (pickupLat == null || pickupLng == null || !Array.isArray(deliveries)) {
      res.status(400).json({ error: 'pickupLat, pickupLng, deliveries[] required' }); return;
    }
    try {
      const { RouteOptimizationEngine } = await import('./src/lib/logistics/RouteOptimizationEngine');
      const pickup = { id: 'pickup', lat: Number(pickupLat), lng: Number(pickupLng), stopType: 'pickup' as const, label: 'Pickup' };
      const stops = deliveries.map((d: any) => ({ id: d.id, lat: Number(d.lat), lng: Number(d.lng), stopType: 'delivery' as const, label: d.label }));
      const route = await RouteOptimizationEngine.optimize(pickup, stops);
      res.json(route);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase W: Single-leg ETA ───────────────────────────────────────────
  app.get('/api/delivery/eta', requireAdminAuth, async (req: Request, res: Response) => {
    const { fromLat, fromLng, toLat, toLng } = req.query as Record<string, string>;
    if (!fromLat || !fromLng || !toLat || !toLng) {
      res.status(400).json({ error: 'fromLat, fromLng, toLat, toLng required' }); return;
    }
    try {
      const { RouteOptimizationEngine } = await import('./src/lib/logistics/RouteOptimizationEngine');
      const eta = await RouteOptimizationEngine.computeSingleETA(Number(fromLat), Number(fromLng), Number(toLat), Number(toLng));
      res.json(eta);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase A: Live rider positions (for FleetManager map) ──────────────
  app.get('/api/delivery/riders/live', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { RiderLocationServer } = await import('./src/lib/delivery/RiderLocationService');
      const riders = await RiderLocationServer.getLiveRiders();
      res.json({ riders });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Phase A: Route replay (breadcrumbs for an order) ──────────────────
  app.get('/api/delivery/route-replay/:orderId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { RiderLocationServer } = await import('./src/lib/delivery/RiderLocationService');
      const crumbs = await RiderLocationServer.getRouteReplay(req.params.orderId);
      res.json({ orderId: req.params.orderId, points: crumbs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Phase B: Delivery timeline for an order ────────────────────────────
  app.get('/api/delivery/timeline/:orderId', async (req: Request, res: Response) => {
    try {
      const { DeliveryTimelineService } = await import('./src/lib/delivery/DeliveryTimeline');
      const timeline = await DeliveryTimelineService.getTimeline(req.params.orderId);
      res.json(timeline);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: Update order delivery status ──────────────────────────────
  app.post('/api/delivery/status', async (req: Request, res: Response) => {
    const { orderId, status, note, lat, lng, riderId } = req.body;
    if (!orderId || !status) { res.status(400).json({ error: 'orderId and status required' }); return; }
    try {
      const { DeliveryTimelineService } = await import('./src/lib/delivery/DeliveryTimeline');
      await DeliveryTimelineService.appendEvent(orderId, status, {
        note,
        coord: (lat && lng) ? { lat, lng, timestamp: Date.now() } : undefined,
        riderId,
      });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: ETA estimate ──────────────────────────────────────────────
  app.get('/api/delivery/eta/:orderId', async (req: Request, res: Response) => {
    const { riderLat, riderLng } = req.query as Record<string, string>;
    if (!riderLat || !riderLng) { res.status(400).json({ error: 'riderLat and riderLng required' }); return; }
    try {
      const { SLAMonitor } = await import('./src/lib/delivery/SLAMonitor');
      const result = await SLAMonitor.estimateDeliveryTime(req.params.orderId, parseFloat(riderLat), parseFloat(riderLng));
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: Rider performance ─────────────────────────────────────────
  app.get('/api/delivery/rider-performance/:riderId', requireAdminAuth, async (req: Request, res: Response) => {
    const period = (req.query.period as string) || '7d';
    try {
      const { RiderPerformanceEngine } = await import('./src/lib/delivery/RiderPerformanceEngine');
      const perf = await RiderPerformanceEngine.getPerformance(req.params.riderId, period as any);
      res.json(perf);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/delivery/all-performance', requireAdminAuth, async (req: Request, res: Response) => {
    const period = (req.query.period as string) || '7d';
    try {
      const { RiderPerformanceEngine } = await import('./src/lib/delivery/RiderPerformanceEngine');
      const results = await RiderPerformanceEngine.computeAllRiders(period as any);
      res.json({ riders: results });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: Fleet snapshot ────────────────────────────────────────────
  app.get('/api/delivery/fleet-snapshot', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { FleetOptimizer } = await import('./src/lib/delivery/FleetOptimizer');
      const snapshot = await FleetOptimizer.getFleetSnapshot();
      res.json(snapshot);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: Order batching ────────────────────────────────────────────
  app.post('/api/delivery/batch', requireAdminAuth, async (req: Request, res: Response) => {
    const { pickupLat, pickupLng, maxOrders } = req.body;
    if (pickupLat == null || pickupLng == null) { res.status(400).json({ error: 'pickupLat and pickupLng required' }); return; }
    try {
      const { OrderBatchingEngine } = await import('./src/lib/delivery/OrderBatchingEngine');
      const batch = await OrderBatchingEngine.createBatch(parseFloat(pickupLat), parseFloat(pickupLng), maxOrders);
      if (!batch) { res.json({ success: false, message: 'No batchable orders or no available riders' }); return; }
      res.json({ success: true, batch });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/delivery/batches', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { OrderBatchingEngine } = await import('./src/lib/delivery/OrderBatchingEngine');
      const batches = await OrderBatchingEngine.getActiveBatches();
      res.json({ batches });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: Rider fraud report ────────────────────────────────────────
  app.get('/api/delivery/rider-fraud/:riderId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { RiderFraudDetector } = await import('./src/lib/delivery/RiderFraudDetector');
      const report = await RiderFraudDetector.analyzeRider(req.params.riderId);
      res.json(report);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: Online riders (heartbeat-based) ───────────────────────────
  app.get('/api/delivery/riders/online', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { RiderHeartbeatServer } = await import('./src/lib/delivery/RiderHeartbeatService');
      const online = await RiderHeartbeatServer.getOnlineRiders();
      res.json({ count: online.length, riders: online });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase B: SLA alerts (current breaches) ─────────────────────────────
  app.get('/api/delivery/sla-alerts', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { SLAMonitor } = await import('./src/lib/delivery/SLAMonitor');
      const alerts = await SLAMonitor.runScan();
      res.json({ count: alerts.length, alerts });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase A: API usage by day (replaces hardcoded mockApiData) ─────────
  

    // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // FIX: Catch-all for SPA - must come after all API routes
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ── WebSocket: attach Socket.io to HTTP server ──────────────────────────
  // BEFORE: app.listen() — no WebSocket support
  // AFTER:  createHttpServer(app) → socket.io attached
  const httpServer = createHttpServer(app);

  await nexusWS.initialize(httpServer);

  // ── Initialize RedisTaskQueue ─────────────────────────────────────────
  await redisTaskQueue.initialize();
  redisTaskQueue.register('send_notification', async (job) => {
    const { NotificationEngine } = await import('./src/lib/notifications/NotificationEngine');
    await NotificationEngine.notify(job.payload as import('./src/lib/notifications/NotificationEngine').GenericNotifyPayload);
  });
  redisTaskQueue.register('csat_request', async (job) => {
    const p = job.payload as { userId: string; channel: string };
    const ch = ChannelRegistry.get(p.channel as import('./src/lib/integrations/OmniConnector').PlatformType);
    if (ch?.enabled) {
      await ChannelRegistry.sendOutbound(p.channel as import('./src/lib/integrations/OmniConnector').PlatformType, p.userId,
        '⭐ How was your experience? Reply 1-5 to rate us, or tell us more!');
    }
  });
  redisTaskQueue.register('learning_record', async (job) => {
    await LearningEngine.storeToDB(job.payload as Record<string, unknown>);
  });
  redisTaskQueue.register('financial_report', async (job) => {
    const { year, month } = job.payload as { year: number; month: number };
    await FinancialReportsEngine.generateMonthlyReport(year, month);
  });
  redisTaskQueue.startWorker('default', tuning?.redisWorkerConcurrency.default ?? 3);
  redisTaskQueue.startWorker('ai', tuning?.redisWorkerConcurrency.ai ?? 2);
  redisTaskQueue.startWorker('notifications', tuning?.redisWorkerConcurrency.notifications ?? 4);

  // ── Hardware Auto-Detection + Ollama Setup ───────────────────────────
  HardwareAutoConfig.detect().then(async (hwProfile) => {
    HardwareAutoConfig.printProfile(hwProfile);
    await HardwareAutoConfig.autoSetupOllama();
    // Full capacity estimate (runs a real DB benchmark) — logged now, and
    // cached so GET /api/admin/system/capacity serves it instantly afterward.
    CapacityEstimator.estimateCapacity()
      .then((report) => CapacityEstimator.printCapacityReport(report))
      .catch((e) => srvLog.warn('Capacity estimate non-fatal:', e));
  }).catch(e => srvLog.warn('Hardware detection non-fatal:', e));

  // ── Register social channels from env vars ────────────────────────────
  const channelMap: Array<{ envKey: string; path: string; name: string }> = [
    { envKey: 'WHATSAPP_TOKEN',       path: './src/lib/integrations/adapters/WhatsAppAdapter', name: 'WhatsApp' },
    { envKey: 'TELEGRAM_BOT_TOKEN',   path: './src/lib/integrations/adapters/telegram',         name: 'Telegram' },
    { envKey: 'FB_PAGE_ACCESS_TOKEN', path: './src/lib/integrations/adapters/facebook',          name: 'Facebook' },
    { envKey: 'DISCORD_BOT_TOKEN',    path: './src/lib/integrations/adapters/discord',           name: 'Discord' },
    { envKey: 'TIKTOK_ACCESS_TOKEN',  path: './src/lib/integrations/adapters/tiktok',            name: 'TikTok' },
    { envKey: 'SMTP_USER',            path: './src/lib/integrations/adapters/email',             name: 'Email' },
  ];
  for (const cm of channelMap) {
    if (!process.env[cm.envKey]) continue;
    try {
      const mod = await import(cm.path);
      const Cls = (Object.values(mod)[0]) as new () => Record<string, unknown>;
      ChannelRegistry.register(new Cls() as unknown as import('./src/lib/integrations/OmniConnector').IOmniConnector,
        { inbound: true, outbound: true, fileSharing: true, quickReplies: true, templateMessages: true, realtime: true }, cm.name);
      srvLog.info(`Channel: ${cm.name} registered`);
    } catch { /* env set but adapter load failed */ }
  }
  try {
    const { WebChatAdapter } = await import('./src/lib/integrations/adapters/WebChatAdapter');
    ChannelRegistry.register(new WebChatAdapter() as import('./src/lib/integrations/OmniConnector').IOmniConnector,
      { inbound: true, outbound: true, fileSharing: false, quickReplies: true, templateMessages: false, realtime: true }, 'Website Chat');
  } catch { /* optional */ }
  srvLog.info(`Channels: ${ChannelRegistry.getStats().enabled} active`);

  // ── Human handoff EventBus → WebSocket + DB ───────────────────────────
  EventBus.on('chat.human_handoff_requested', async (payload: unknown) => {
    const { customerId } = payload as { customerId: string };
    nexusWS.pushAdminNotification({
      id: `handoff_${Date.now()}`, type: 'system', severity: 'warning',
      title: '👤 Human Handoff Needed', body: `Customer ${customerId} needs a human agent`,
    });
  }, 'HandoffBridge');

  // SLA monitoring bridges
  EventBus.on('sla.breached', async (payload: unknown) => {
    const { conversationId, tier, minutesElapsed } = payload as Record<string, unknown>;
    nexusWS.pushAdminNotification({
      id: `sla_${Date.now()}`, type: 'system', severity: 'critical',
      title: `⏰ SLA Breached [${String(tier).toUpperCase()}]`,
      body: `Conversation ${String(conversationId).slice(0, 12)} unanswered for ${minutesElapsed} min`,
    });
  }, 'SLABreachBridge');

  EventBus.on('sla.warning', async (payload: unknown) => {
    const { conversationId, tier, minutesRemaining } = payload as Record<string, unknown>;
    nexusWS.pushAdminNotification({
      id: `slaw_${Date.now()}`, type: 'system', severity: 'warning',
      title: `⚠️ SLA Warning [${String(tier).toUpperCase()}]`,
      body: `${minutesRemaining} min remaining for ${String(conversationId).slice(0, 12)}`,
    });
  }, 'SLAWarningBridge');

  // Order status → timeline + notifications
  EventBus.on('order.status_changed', async (payload: unknown) => {
    const { orderId, status } = payload as { orderId: string; status: string };
    nexusWS.pushOrderUpdate(orderId, { status, message: `Order status: ${status}` });
  }, 'OrderTimelineBridge');

  // Low stock alerts
  EventBus.on('inventory.low_stock', async (payload: unknown) => {
    const { productId, stock } = payload as { productId: string; stock: number };
    nexusWS.pushAdminNotification({
      id: `stock_${Date.now()}`, type: 'stock', severity: 'warning',
      title: '📦 Low Stock Alert',
      body: `Product ${productId} has only ${stock} units remaining`,
    });
  }, 'LowStockBridge');

  // ── COD Fraud Detection API ───────────────────────────────────────────
  app.post('/api/orders/cod-fraud-check', async (req: Request, res: Response) => {
    try {
      const order = req.body as Parameters<typeof CODFraudDetector.assess>[0];
      const result = await CODFraudDetector.assess(order);
      if (result.action === 'block') {
        res.status(403).json({ ...result, error: 'Order blocked due to fraud risk' });
      } else {
        res.json(result);
      }
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.post('/api/admin/fraud/blocklist', requireAdminAuth, async (req: Request, res: Response) => {
    const { type, value, reason } = req.body as { type: 'phone'|'ip'|'userId'; value: string; reason: string };
    const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
    await CODFraudDetector.addToBlocklist(type, value, reason, u?.uid || 'admin');
    res.json({ success: true });
  });

  app.get('/api/admin/fraud/stats', requireAdminAuth, async (_req: Request, res: Response) => {
    res.json(await CODFraudDetector.getStats());
  });

  app.get('/api/admin/fraud/alerts', requireAdminAuth, async (_req: Request, res: Response) => {
    const { NexusDB: NXDB } = await import('./src/lib/database/NexusDB');
    const alerts = await NXDB.find('cod_fraud_checks', {
      where: [{ field: 'action', op: '!=', value: 'allow' }],
      orderBy: 'checkedAt', orderDir: 'desc', limit: 50,
    });
    res.json({ alerts, count: alerts.length });
  });

  // ── Task Queue Stats API ──────────────────────────────────────────────
  app.get('/api/admin/queue/stats', requireAdminAuth, async (_req: Request, res: Response) => {
    res.json(await redisTaskQueue.getStats());
  });

  // ── Feature Flags API ─────────────────────────────────────────────────
  app.get('/api/features', async (_req: Request, res: Response) => {
    const { FeatureStore } = await import('./src/lib/core/config/FeatureStore');
    res.json({ features: await FeatureStore.getAll() });
  });
  app.put('/api/features', requireAdminAuth, async (req: Request, res: Response) => {
    const { FeatureStore } = await import('./src/lib/core/config/FeatureStore');
    const { features } = req.body as { features: Record<string, boolean> };
    const updated = await FeatureStore.setMany(features, (req as any).authUser?.uid);
    res.json({ success: true, features: updated });
  });

  // ── Channel Registry API ──────────────────────────────────────────────
  app.get('/api/channels', (_req: Request, res: Response) => {
    res.json({ channels: ChannelRegistry.getAll().map(c => ({ platformId: c.platformId, displayName: c.displayName, enabled: c.enabled, features: c.features, webhookPath: c.webhookPath })), stats: ChannelRegistry.getStats() });
  });
  app.put('/api/channels/:platformId/toggle', requireAdminAuth, (req: Request, res: Response) => {
    ChannelRegistry.setEnabled(req.params.platformId, (req.body as { enabled: boolean }).enabled);
    res.json({ success: true });
  });

  // ── Campaign Outbound Broadcast ───────────────────────────────────────
  app.post('/api/campaigns/:campaignId/broadcast', requireAdminAuth, aiRateLimit, async (req: Request, res: Response) => {
    const { recipients } = req.body as { recipients: Parameters<typeof ChannelRegistry.broadcastCampaign>[1] };
    if (!Array.isArray(recipients) || recipients.length === 0) { res.status(400).json({ error: 'recipients array required' }); return; }
    const stats = await ChannelRegistry.broadcastCampaign(req.params.campaignId, recipients);
    res.json({ success: true, stats });
  });

  // ── 2FA / TOTP Routes ─────────────────────────────────────────────────
  app.post('/api/auth/2fa/setup', authRateLimit, async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> || {};
    if (!u.uid) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try { res.json(await TOTPService.generateSecret(u.uid, u.email || u.uid)); } catch (e) { res.status(500).json({ error: String(e) }); }
  });
  app.post('/api/auth/2fa/confirm', authRateLimit, async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> || {};
    if (!u.uid) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json({ success: await TOTPService.confirmSetup(u.uid, (req.body as { token: string }).token) });
  });
  app.post('/api/auth/2fa/verify', authRateLimit, async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> || {};
    if (!u.uid) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json(await TOTPService.verifyToken(u.uid, (req.body as { token: string }).token));
  });
  app.post('/api/auth/2fa/disable', authRateLimit, async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> || {};
    if (!u.uid) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json({ success: await TOTPService.disable(u.uid, (req.body as { token: string }).token) });
  });
  app.get('/api/auth/2fa/status', async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> || {};
    if (!u.uid) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json(await TOTPService.getStatus(u.uid));
  });

  // ── CSAT Routes ───────────────────────────────────────────────────────
  app.post('/api/csat/submit', async (req: Request, res: Response) => {
    try {
      const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
      const result = await CSATEngine.submit({ ...(req.body as Record<string, unknown>), userId: u?.uid || 'anonymous' });
      res.json(result);
    } catch (e) { res.status(400).json({ error: String(e) }); }
  });
  app.get('/api/csat/summary', requireAdminAuth, async (req: Request, res: Response) => {
    const { type, since } = req.query as Record<string, string>;
    res.json(await CSATEngine.getSummary({ type: type as 'order' | 'support' | undefined, since: since ? new Date(since) : undefined }));
  });

  // ── Financial Reports Routes ──────────────────────────────────────────
  app.get('/api/admin/financial-reports', requireAdminAuth, async (_req: Request, res: Response) => {
    res.json({ reports: await FinancialReportsEngine.listReports() });
  });
  app.post('/api/admin/financial-reports/generate', requireAdminAuth, async (req: Request, res: Response) => {
    const { year, month } = req.body as { year?: number; month?: number };
    const now = new Date();
    res.json(await FinancialReportsEngine.generateMonthlyReport(year || now.getFullYear(), month || now.getMonth() + 1));
  });

  // ── Human Handoff API ─────────────────────────────────────────────────
  app.post('/api/chat/handoff', async (req: Request, res: Response) => {
    const { platformId, customerId, reason } = req.body as { platformId: string; customerId: string; reason?: string };
    await ChannelRegistry.requestHumanHandoff(platformId, customerId, reason || 'Human requested');
    res.json({ success: true });
  });
  app.get('/api/chat/handoff-queue', requireAdminAuth, async (_req: Request, res: Response) => {
    const { NexusDB: NXDB } = await import('./src/lib/database/NexusDB');
    const queue = await NXDB.find('human_handoff_queue', { where: [{ field: 'status', op: '==', value: 'pending' }], orderBy: 'requestedAt', orderDir: 'desc', limit: 50 });
    res.json({ queue, count: queue.length });
  });

  // ── Learning Engine API ───────────────────────────────────────────────
  app.get('/api/admin/learning/stats', requireAdminAuth, async (req: Request, res: Response) => {
    res.json(await LearningEngine.getStats((req.query as Record<string, string>).tenantId || 'default'));
  });
  app.delete('/api/admin/learning/:id', requireAdminAuth, async (req: Request, res: Response) => {
    await LearningEngine.deleteRecord(req.params.id);
    res.json({ success: true });
  });

  // ── API Usage Counter (feeds AnalyticsDashboard) ─────────────────────
  const _apiUsage: Record<string, number> = {};
  app.use('/api/', (_req: Request, _res: Response, next: NextFunction) => {
    const day = new Date().toISOString().split('T')[0];
    _apiUsage[day] = (_apiUsage[day] || 0) + 1;
    const days = Object.keys(_apiUsage).sort();
    if (days.length > 30) delete _apiUsage[days[0]];
    next();
  });
  app.get('/api/admin/api-usage-by-day', requireAdminAuth, (_req: Request, res: Response) => {
    res.json(_apiUsage);
  });

  // Wire order status pushes to WebSocket
  EventBus.on('order.paid', async (payload: unknown) => {
    const { orderId, userId, channel } = payload as { orderId: string; userId: string; channel?: string };
    nexusWS.pushOrderUpdate(orderId, { status: 'paid', message: 'Payment confirmed!' });
    nexusWS.pushAdminNotification({
      id: `notif_${Date.now()}`,
      type: 'order',
      severity: 'info',
      title: 'New Order Paid',
      body: `Order ${orderId} payment confirmed`,
    });
    // Schedule CSAT request 30 min after delivery (via RedisTaskQueue)
    await redisTaskQueue.enqueue({
      queue: 'notifications', type: 'csat_request',
      payload: { userId, orderId, channel: channel || 'web' },
      delayMs: 30 * 60 * 1000, // 30 minutes
    });
  }, 'WebSocketBridge');

  // Learning loop: record AI success to LearningEngine
  EventBus.on('ai.response.success', async (payload: unknown) => {
    await redisTaskQueue.enqueue({
      queue: 'ai', type: 'learning_record', payload,
    });
  }, 'LearningBridge');

  // CSAT submission → admin notification
  EventBus.on('csat.alert', async (payload: unknown) => {
    const { userId, rating, type } = payload as Record<string, unknown>;
    nexusWS.pushAdminNotification({
      id: `csat_${Date.now()}`,
      type: 'system',
      severity: 'warning',
      title: '⭐ Low CSAT Alert',
      body: `User ${userId} gave ${rating}/5 on ${type} — review needed`,
    });
  }, 'CSATBridge');

  // CTO Audit Part 2, section 10: global error framework. Must be the LAST
  // middleware registered — Express only routes errors here if every route/
  // middleware above it either throws or calls next(err). Un-migrated plain
  // Error throws still get a safe generic response (see nexusErrorHandler's
  // own comment in NexusError.ts) so this is a net-safe addition, not a
  // behavior change for existing routes.
  app.use(nexusErrorHandler);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT} (4 namespaces)`);
    console.log(`   Mode: ${process.env.NODE_ENV || "development"}`);
  });

  // ══════════════════════════════════════════════════════════════════
  // NEW ROUTES — Tax, Search, Reviews, Auth, SLA, Cache, Discounts
  // ══════════════════════════════════════════════════════════════════

  // Tax calculation
  app.post('/api/tax/calculate', async (req: Request, res: Response) => {
    try {
      const body = req.body as { items: Parameters<typeof TaxEngine.calculateForCart>[0]; country?: string; customerVATNumber?: string };
      res.json(await TaxEngine.calculateForCart(body.items || [], body.country || 'BD', { customerVATNumber: body.customerVATNumber }));
    } catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.get('/api/tax/rules', async (req: Request, res: Response) => {
    const country = (req.query.country as string) || 'BD';
    const sample = await TaxEngine.calculateForItem(1000, 'electronics', country);
    res.json({ country, sampleItem: { price: 1000, category: 'electronics', ...sample } });
  });

  // Inventory reservation
  app.post('/api/inventory/reserve', async (req: Request, res: Response) => {
    try {
      const b = req.body as { productId: string; variantId?: string; quantity: number; sessionId: string };
      const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
      const result = await InventoryReservationService.reserve(b.productId, b.quantity || 1, u?.uid || 'guest', b.sessionId || 'anon', b.variantId);
      res.status(result.success ? 200 : 409).json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/inventory/check/:productId', async (req: Request, res: Response) => {
    const qty = parseInt(req.query.quantity as string) || 1;
    res.json(await InventoryReservationService.checkAvailability(req.params.productId, qty, req.query.variantId as string));
  });

  app.delete('/api/inventory/reserve/:id', async (req: Request, res: Response) => {
    await InventoryReservationService.releaseReservation(req.params.id);
    res.json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════════
  // VENDOR ROUTES — previously nonexistent. MicroStoreEngine existed but
  // had zero API surface; Product/Order had no field linking them to a
  // vendor's store at all. See vendor dashboard build notes.
  // ══════════════════════════════════════════════════════════════════
  function requireVendorAuth(req: Request, res: Response, next: NextFunction) {
    requireAuth(req, res, () => {
      const role = (req as any).authUser?.role;
      if (role !== 'vendor' && role !== 'admin' && role !== 'ceo') {
        res.status(403).json({ error: 'Vendor account required' });
        return;
      }
      next();
    });
  }

  // Resolve the calling vendor's store once, shared by the routes below.
  async function getOwnStore(uid: string) {
    const { MicroStoreEngine } = await import('./src/lib/vendor/MicroStoreEngine');
    const stores = await MicroStoreEngine.listUserStores(uid);
    return (stores && stores[0]) || null;
  }

  app.get('/api/vendor/store', requireVendorAuth, async (req: Request, res: Response) => {
    try {
      const store = await getOwnStore((req as any).authUser.uid);
      res.json({ store });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/vendor/store', requireVendorAuth, async (req: Request, res: Response) => {
    try {
      const uid = (req as any).authUser.uid;
      const existing = await getOwnStore(uid);
      if (existing) { res.status(409).json({ error: 'You already have a store', store: existing }); return; }
      const { storeTitle, industry } = req.body as { storeTitle?: string; industry?: string };
      if (!storeTitle || !industry) { res.status(400).json({ error: 'storeTitle and industry are required' }); return; }
      const { MicroStoreEngine } = await import('./src/lib/vendor/MicroStoreEngine');
      const result = await MicroStoreEngine.createStore(uid, storeTitle, industry);
      res.status(result.success ? 201 : 500).json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/vendor/products', requireVendorAuth, async (req: Request, res: Response) => {
    try {
      const store = await getOwnStore((req as any).authUser.uid);
      if (!store) { res.status(404).json({ error: 'Create a store first' }); return; }
      const { ProductRepository } = await import('./src/lib/database/repositories/ProductRepository');
      res.json({ products: await ProductRepository.findByStore(store.id as string) });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/vendor/products', requireVendorAuth, async (req: Request, res: Response) => {
    try {
      const store = await getOwnStore((req as any).authUser.uid);
      if (!store) { res.status(404).json({ error: 'Create a store first' }); return; }
      const { name, price, category, stock, description, imageUrl } = req.body as
        { name?: string; price?: number; category?: string; stock?: number; description?: string; imageUrl?: string };
      if (!name || typeof price !== 'number' || !category) {
        res.status(400).json({ error: 'name, price, and category are required' }); return;
      }
      const { ProductRepository } = await import('./src/lib/database/repositories/ProductRepository');
      const { NexusDB } = await import('./src/lib/database/NexusDB');
      const id = await ProductRepository.create({
        name, price, category, stock: stock ?? 0, description, imageUrl,
        storeId: store.id as string,
      });
      await NexusDB.update('micro_stores', store.id as string, {
        productCount: ((store.productCount as number) ?? 0) + 1,
      });
      res.status(201).json({ success: true, id });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.patch('/api/vendor/products/:id', requireVendorAuth, async (req: Request, res: Response) => {
    try {
      const store = await getOwnStore((req as any).authUser.uid);
      if (!store) { res.status(404).json({ error: 'Create a store first' }); return; }
      const { ProductRepository } = await import('./src/lib/database/repositories/ProductRepository');
      const product = await ProductRepository.findById(req.params.id);
      if (!product || product.storeId !== store.id) {
        res.status(404).json({ error: 'Product not found in your store' }); return;
      }
      const { name, price, category, stock, description, imageUrl } = req.body as
        { name?: string; price?: number; category?: string; stock?: number; description?: string; imageUrl?: string };
      await ProductRepository.update(req.params.id, { name, price, category, stock, description, imageUrl });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/vendor/orders', requireVendorAuth, async (req: Request, res: Response) => {
    try {
      const store = await getOwnStore((req as any).authUser.uid);
      if (!store) { res.status(404).json({ error: 'Create a store first' }); return; }
      const { OrderRepository } = await import('./src/lib/database/repositories/OrderRepository');
      res.json({ orders: await OrderRepository.findByStore(store.id as string) });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Discount stacking
  app.post('/api/commerce/calculate-discounts', async (req: Request, res: Response) => {
    try {
      res.json(await DiscountStackEngine.calculate(req.body as Parameters<typeof DiscountStackEngine.calculate>[0]));
    } catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.put('/api/commerce/discount-policy', requireAdminAuth, async (req: Request, res: Response) => {
    await DiscountStackEngine.updatePolicy(req.body as Parameters<typeof DiscountStackEngine.updatePolicy>[0]);
    res.json({ success: true });
  });

  // Order timeline & tracking
  app.get('/api/orders/:orderId/tracking', async (req: Request, res: Response) => {
    const view = await OrderTimelineService.getTrackingView(req.params.orderId);
    view ? res.json(view) : res.status(404).json({ error: 'Order not found' });
  });

  app.post('/api/orders/:orderId/status', requireAdminAuth, async (req: Request, res: Response) => {
    const b = req.body as { status: string; description?: string; location?: string; riderName?: string; eta?: string };
    await OrderTimelineService.addEvent(req.params.orderId, b.status as Parameters<typeof OrderTimelineService.addEvent>[1], b);
    res.json({ success: true });
  });

  // Product reviews
  app.post('/api/reviews', async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
    if (!u?.uid) { res.status(401).json({ error: 'Login required' }); return; }
    try { res.json(await ProductReviewEngine.submitReview({ ...req.body as object, userId: u.uid })); }
    catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.get('/api/reviews/:productId', async (req: Request, res: Response) => {
    const q = req.query as Record<string, string>;
    res.json(await ProductReviewEngine.getReviews(req.params.productId, {
      sortBy: q.sortBy as 'recent' | 'helpful' | undefined,
      filterRating: q.filterRating ? parseInt(q.filterRating) : undefined,
      verifiedOnly: q.verifiedOnly === 'true',
      withPhotos: q.withPhotos === 'true',
      limit: q.limit ? parseInt(q.limit) : 10,
      cursor: q.cursor,
    }));
  });

  app.post('/api/reviews/:reviewId/helpful', async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
    if (!u?.uid) { res.status(401).json({ error: 'Login required' }); return; }
    try { await ProductReviewEngine.voteHelpful(req.params.reviewId, u.uid, (req.body as { helpful: boolean }).helpful); res.json({ success: true }); }
    catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.post('/api/reviews/:reviewId/vendor-response', requireAdminAuth, async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
    try { await ProductReviewEngine.addVendorResponse(req.params.reviewId, u?.uid || '', (req.body as { response: string }).response); res.json({ success: true }); }
    catch (e) { res.status(400).json({ error: String(e) }); }
  });

  // Product search & autocomplete
  app.get('/api/products/search', async (req: Request, res: Response) => {
    const q = req.query as Record<string, string>;
    const cacheKey = `search:${q.q || ''}:${q.category || ''}:${q.sortBy || ''}:${q.limit || 20}`;
    const result = await NexusCache.getOrSet(cacheKey,
      () => ProductSearchEngine.search({ query: q.q || '', category: q.category, minPrice: q.minPrice ? parseFloat(q.minPrice) : undefined, maxPrice: q.maxPrice ? parseFloat(q.maxPrice) : undefined, minRating: q.minRating ? parseFloat(q.minRating) : undefined, inStockOnly: q.inStockOnly === 'true', sortBy: q.sortBy as 'relevance' | undefined, limit: q.limit ? parseInt(q.limit) : 20, vendorId: q.vendorId }),
      30, ['search']
    );
    res.json(result);
  });

  app.get('/api/products/autocomplete', async (req: Request, res: Response) => {
    const prefix = (req.query.q as string) || '';
    if (prefix.length < 2) { res.json({ suggestions: [] }); return; }
    res.json({ suggestions: await ProductSearchEngine.autocomplete(prefix, 8) });
  });

  app.post('/api/products/search-index/rebuild', requireAdminAuth, async (_req: Request, res: Response) => {
    const index = await ProductSearchEngine.rebuildIndex();
    res.json({ success: true, indexedProducts: index.length });
  });

  // Auth improvements
  app.post('/api/auth/forgot-password', authRateLimit, async (req: Request, res: Response) => {
    const { email } = req.body as { email: string };
    if (!email?.includes('@')) { res.status(400).json({ error: 'Valid email required' }); return; }
    res.json(await PasswordResetService.initiateReset(email, req.ip));
  });

  app.post('/api/auth/reset-password', authRateLimit, async (req: Request, res: Response) => {
    const { token, id, newPassword } = req.body as { token: string; id: string; newPassword: string };
    if (!token || !id || !newPassword) { res.status(400).json({ error: 'token, id, newPassword required' }); return; }
    const result = await PasswordResetService.confirmReset(id, token, newPassword);
    res.status(result.success ? 200 : 400).json(result);
  });

  app.post('/api/auth/send-verification', authRateLimit, async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
    if (!u?.uid || !u.email) { res.status(401).json({ error: 'Authentication required' }); return; }
    await EmailVerificationService.sendVerificationOTP(u.uid, u.email);
    res.json({ success: true, message: 'Verification OTP sent to your email' });
  });

  app.post('/api/auth/verify-email', authRateLimit, async (req: Request, res: Response) => {
    const u = (req as Record<string, unknown>).authUser as Record<string, string> | undefined;
    const { otp } = req.body as { otp: string };
    if (!u?.uid || !otp) { res.status(400).json({ error: 'Login and OTP required' }); return; }
    const result = await EmailVerificationService.verifyOTP(u.uid, otp);
    res.status(result.success ? 200 : 400).json(result);
  });

  // SLA monitoring
  app.get('/api/admin/sla/stats', requireAdminAuth, async (req: Request, res: Response) => {
    const { since } = req.query as { since?: string };
    res.json(await SLAMonitor.getStats(since ? new Date(since) : undefined));
  });

  // Cache management
  app.get('/api/admin/cache/stats', requireAdminAuth, (_req: Request, res: Response) => {
    res.json(NexusCache.getL1Stats());
  });

  app.delete('/api/admin/cache/tag/:tag', requireAdminAuth, async (req: Request, res: Response) => {
    await NexusCache.invalidateTag(req.params.tag);
    res.json({ success: true, invalidated: req.params.tag });
  });

  // Order ID utilities
  app.get('/api/admin/next-order-id', requireAdminAuth, async (_req: Request, res: Response) => {
    res.json({ nextId: await OrderIdGenerator.next(), todayCount: await OrderIdGenerator.getTodayCount() });
  });

  // Webhook replay cleanup (cron-able)
  app.post('/api/admin/cleanup/webhook-nonces', requireAdminAuth, async (_req: Request, res: Response) => {
    const cleaned = await WebhookGuard.cleanupExpiredNonces();
    res.json({ success: true, cleaned });
  });

  app.post('/api/admin/cleanup/inventory-reservations', requireAdminAuth, async (_req: Request, res: Response) => {
    const result = await InventoryReservationService.cleanupExpired();
    res.json({ success: true, ...result });
  });

  // ── Graceful Shutdown ─────────────────────────────────────────────────
  // Handle SIGTERM (Docker/Railway/Render stop) and SIGINT (Ctrl+C)
  const gracefulShutdown = async (signal: string): Promise<void> => {
    console.log(`\n[Shutdown] ${signal} received — graceful shutdown starting...`);

    // Stop accepting new connections
    httpServer.close(async (err) => {
      if (err) console.error('[Shutdown] HTTP server close error:', err);

      // Stop task queue workers
      try {
        await redisTaskQueue.stop();
        console.log('[Shutdown] Task queue stopped');
      } catch { /* ignore */ }

      // Disconnect WebSocket
      try {
        nexusWS.getStats(); // no-op just to check it's alive
      } catch { /* ignore */ }

      console.log('[Shutdown] ✅ Clean shutdown complete');
      process.exit(err ? 1 : 0);
    });

    // Force exit after 15 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('[Shutdown] Force exit after timeout');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

  // Catch unhandled rejections — log and send to Sentry if configured
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Nexus] Unhandled Promise Rejection:', reason);
    console.error('[Nexus] At promise:', promise);
    // In production, this is a serious error — send to monitoring
    EventBus.emit('system.error', { type: 'unhandledRejection', reason: String(reason) });
  });

  process.on('uncaughtException', (err) => {
    console.error('[Nexus] UNCAUGHT EXCEPTION:', err);
    EventBus.emit('system.error', { type: 'uncaughtException', error: err.message });
    // Do NOT exit — let it continue (for non-fatal cases)
    // Serious errors should be caught by process supervisor (Docker restart policy)
  });

  // Daily automation scheduler (09:00 every day)
  try {
    const cron = await import("node-cron");
    // Daily BI report at 08:00
    cron.schedule("0 8 * * *", async () => {
      console.log("[Cron] Generating daily BI report...");
      const report = await BIEngine.generateDailyReport();
      console.log(`[Cron] BI report: $${report.revenue?.today?.toFixed(2)} today, ${report.alerts?.length} alerts`);
    });

    // ── Phase Q: Owner automation rules — run every 30 minutes ──────────
    // AutomationRuleEngine.runAllActiveRules() evaluates every active owner-
    // defined IF→THEN rule (condition against real data, action = coupon /
    // alert / supplier notification). One rule failure does not block others.
    cron.schedule("*/30 * * * *", async () => {
      try {
        const { AutomationRuleEngine } = await import('./src/lib/automation/AutomationRuleEngine');
        const { ranCount, errors } = await AutomationRuleEngine.runAllActiveRules();
        if (ranCount > 0) {
          console.log(`[Cron][AutomationRules] Ran ${ranCount} rule(s), ${errors} error(s)`);
        }
      } catch (err) { console.error('[Cron][AutomationRules]', err); }
    });

    // ── Phase Y: Daily backup at 02:00 ────────────────────────────────────────
    // Real backup — exports all NexusDB collections to JSON.
    // See BackupRecoveryEngine for what is and isn't exported (Auth users excluded).
    cron.schedule("0 2 * * *", async () => {
      try {
        const { BackupRecoveryEngine } = await import('./src/lib/infrastructure/BackupRecoveryEngine');
        await BackupRecoveryEngine.runScheduledBackup();
      } catch (err) { console.error('[Cron][Backup]', err); }
    });

    // ── CTO Audit Part 2, section 13: "Memory Cleanup" named explicitly as a heavy
    // task that shouldn't run on the API thread. Enqueues onto TaskQueue (not run
    // inline here) so it goes through the same worker/retry/dead-letter machinery
    // as every other background job — see the 'memory_cleanup' worker registered in
    // src/lib/queue/TaskQueue.ts. Runs at 03:00, after backup, before the CEO brief.
    cron.schedule("0 3 * * *", async () => {
      try {
        await TaskQueue.enqueue('memory_cleanup', {}, { priority: 3 });
      } catch (err) { console.error('[Cron][MemoryCleanup]', err); }
    });

    // ── CTO Audit Part 3: gives unhealthy AI providers a real path back to
    // healthy via ping() (see ProviderRegistry.runHealthCheckSweep). Every 5
    // minutes, not per-request, since ping() is a real network call.
    cron.schedule("*/5 * * * *", async () => {
      try {
        const { GlobalProviderRegistry } = require("./src/lib/ai/providers/ProviderRegistry");
        const result = await GlobalProviderRegistry.runHealthCheckSweep();
        if (result.recovered > 0) {
          console.log(`[Cron][AIProviderHealth] ${result.recovered}/${result.checked} unhealthy providers recovered`);
        }
      } catch (err) { console.error('[Cron][AIProviderHealth]', err); }
    });

    // ── Phase X: CEO Daily Brief — generated every morning at 06:00 ──────────
    // Pre-generates the CEO report so it's available instantly when the owner
    // opens the dashboard. generateDailyBrief() takes ~20s — we do it in
    // background so the owner never waits.
    cron.schedule("0 6 * * *", async () => {
      try {
        const { CEOAgent } = await import('./src/lib/orchestration/agents/CEOAgent');
        await CEOAgent.generateDailyBrief();
        console.log('[Cron][CEOAgent] Daily brief generated at 06:00');
      } catch (err) { console.error('[Cron][CEOAgent]', err); }
    });

    // Daily automation at 09:00
    cron.schedule("0 9 * * *", async () => {
      console.log("[Cron] Running daily automation jobs...");
      await AutomationEngine.runDailyJobs();
    });
    // Self-healing diagnostic every 5 minutes
    cron.schedule("*/5 * * * *", async () => {
      await SelfHealingEngine.runFullDiagnostic();
    });

    // ── Phase B: Delivery OS cron jobs ─────────────────────────────────

    // Heartbeat sweep every 60s — marks stale riders offline
    cron.schedule("* * * * *", async () => {
      try {
        const { RiderHeartbeatServer } = await import('./src/lib/delivery/RiderHeartbeatService');
        await RiderHeartbeatServer.sweepStaleRiders();
      } catch (err) { console.error('[Cron][HeartbeatSweep]', err); }
    });

    // SLA scan every 5 minutes — detect breach/warning
    cron.schedule("*/5 * * * *", async () => {
      try {
        const { SLAMonitor } = await import('./src/lib/delivery/SLAMonitor');
        const alerts = await SLAMonitor.runScan();
        if (alerts.length > 0) {
          console.log(`[Cron][SLA] ${alerts.length} alert(s): ${alerts.filter(a => a.severity === 'breach').length} breaches`);
        }
      } catch (err) { console.error('[Cron][SLAScan]', err); }
    });

    // Fleet snapshot every 5 minutes
    cron.schedule("*/5 * * * *", async () => {
      try {
        const { FleetOptimizer } = await import('./src/lib/delivery/FleetOptimizer');
        await FleetOptimizer.getFleetSnapshot();
      } catch (err) { console.error('[Cron][FleetSnapshot]', err); }
    });

    // Daily rider performance computation at 02:00
    cron.schedule("0 2 * * *", async () => {
      try {
        const { RiderPerformanceEngine } = await import('./src/lib/delivery/RiderPerformanceEngine');
        const results = await RiderPerformanceEngine.computeAllRiders('7d');
        console.log(`[Cron][RiderPerf] Computed ${results.length} rider performance scores`);
      } catch (err) { console.error('[Cron][RiderPerf]', err); }
    });

    // Daily rider fraud scan at 03:00
    cron.schedule("0 3 * * *", async () => {
      try {
        const { db } = await import('./src/firebase');
        const { collection, getDocs } = await import('firebase/firestore');
        const { RiderFraudDetector } = await import('./src/lib/delivery/RiderFraudDetector');
        const snap = await getDocs(collection(db, 'riders'));
        for (const riderDoc of snap.docs) {
          const report = await RiderFraudDetector.analyzeRider(riderDoc.id);
          if (report.decision !== 'clear') {
            console.warn(`[Cron][FraudScan] Rider ${riderDoc.id}: ${report.decision} (score: ${report.riskScore})`);
          }
        }
      } catch (err) { console.error('[Cron][FraudScan]', err); }
    });

    // ── Phase D: AI provider benchmark daily at 04:00 ──────────────────
    cron.schedule("0 4 * * *", async () => {
      try {
        const { AIProviderOrchestrator } = await import('./src/lib/ai/providers/AIProviderOrchestrator');
        const results = await AIProviderOrchestrator.runBenchmark();
        console.log(`[Cron][Benchmark] ${results.length} providers benchmarked. Healthy: ${results.filter(r => r.successRate >= 80).length}`);
      } catch (err) { console.error('[Cron][Benchmark]', err); }
    });

    // ── Phase D: Reset daily AI spend at midnight ──────────────────────
    cron.schedule("0 0 * * *", async () => {
      try {
        const { AIProviderOrchestrator } = await import('./src/lib/ai/providers/AIProviderOrchestrator');
        await AIProviderOrchestrator.resetDailySpend();
      } catch (err) { console.error('[Cron][SpendReset]', err); }
    });

    // ── Phase F: Build settlement batches for yesterday at 01:00 ───────
    cron.schedule("0 1 * * *", async () => {
      try {
        const { SettlementEngine } = await import('./src/lib/payments/SettlementEngine');
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const batches = await SettlementEngine.buildDailyBatches(yesterday);
        console.log(`[Cron][Settlement] Built ${batches.length} settlement batch(es) for ${yesterday}`);

        // ── Phase K: auto-record payment processing fees as expenses ──
        // Fee rates are merchant-contract-specific (negotiated per provider,
        // not a public fixed rate) — read from env so the owner enters their
        // actual agreed rate rather than this code guessing a number.
        // Defaults to 0 (no fee recorded) if unset, so finances are never
        // silently wrong from an invented percentage.
        try {
          const { ExpenseTracker } = await import('./src/lib/finance/ExpenseTracker');
          const feeRates: Record<string, number> = {
            stripe: parseFloat(process.env.STRIPE_FEE_RATE || '0'),
            bkash:  parseFloat(process.env.BKASH_FEE_RATE  || '0'),
            nagad:  parseFloat(process.env.NAGAD_FEE_RATE  || '0'),
            rocket: parseFloat(process.env.ROCKET_FEE_RATE || '0'),
          };
          for (const batch of batches) {
            const rate = feeRates[batch.provider] ?? 0;
            if (rate > 0) {
              await ExpenseTracker.recordProcessingFee(batch.provider, `${batch.provider}_${yesterday}`, batch.totalAmount, rate);
            }
          }
        } catch (feeErr) { console.error('[Cron][ProcessingFees]', feeErr); }

      } catch (err) { console.error('[Cron][Settlement]', err); }
    });

    // ── Phase F: Check for overdue settlements at 06:00 ─────────────────
    cron.schedule("0 6 * * *", async () => {
      try {
        const { SettlementEngine } = await import('./src/lib/payments/SettlementEngine');
        const overdue = await SettlementEngine.findOverdueBatches();
        if (overdue.length > 0) {
          console.warn(`[Cron][Settlement] ${overdue.length} overdue settlement batch(es) detected`);
          const { NexusDB } = await import('./src/lib/database/NexusDB');
          for (const b of overdue) {
            await NexusDB.add('notifications', {
              userId: 'admin',
              title: `⚠️ Overdue Settlement: ${b.provider}`,
              body: `Batch for ${b.batchDate} (expected ${b.expectedSettlementDate}) totaling ${b.totalAmount} ${b.currency} has not settled.`,
              type: 'settlement', severity: 'medium', read: false,
            });
          }
        }
      } catch (err) { console.error('[Cron][SettlementOverdue]', err); }
    });

    // ── Phase F: Payment reconciliation at 02:30 ────────────────────────
    cron.schedule("30 2 * * *", async () => {
      try {
        const { ReconciliationEngine } = await import('./src/lib/payments/ReconciliationEngine');
        const report = await ReconciliationEngine.run(7);
        console.log(`[Cron][Reconciliation] Checked ${report.checkedCount}, found ${report.discrepancyCount} discrepancies`);
      } catch (err) { console.error('[Cron][Reconciliation]', err); }
    });

    console.log("⏰ Schedulers started: daily jobs (09:00) + self-heal (every 5min) + delivery OS (every 1-5min) + AI benchmark (04:00)");
    // Run once at startup
    setTimeout(() => SelfHealingEngine.runFullDiagnostic(), 3000);
  } catch (e) {
    console.warn("[Cron] node-cron not installed — run: npm install node-cron");
  }
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

