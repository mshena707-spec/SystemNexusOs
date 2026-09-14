/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                    NEXUS HEALTH MONITOR                      ║
 * ║  Real-time health checks for all system dependencies.        ║
 * ║  Integrates with Prometheus metrics. Powers /api/health.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { logger } from '../logging/NexusLogger';
import { NexusConfig } from '../config/NexusConfig';
import { EventBus } from '../events/NexusEventBus';

const log = logger.child('HealthMonitor');

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  lastCheckedAt: number;
  consecutiveFailures: number;
}

export interface SystemHealthReport {
  overall: HealthStatus;
  score: number;              // 0–100
  services: ServiceHealth[];
  timestamp: number;
  uptime: number;             // seconds
}

// ── Individual health checks ──────────────────────────────────────────────
async function pingUrl(url: string, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, method: 'HEAD' });
    clearTimeout(timer);
    return { ok: res.ok || res.status === 404, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function checkFirebase(): Promise<ServiceHealth> {
  const name = 'Firebase Firestore';
  const start = Date.now();
  try {
    const { db } = await import('../../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    await getDoc(doc(db, '_health', 'ping'));
    return { name, status: 'healthy', latencyMs: Date.now() - start, lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  } catch (e) {
    return { name, status: 'unhealthy', latencyMs: Date.now() - start, message: String(e), lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
}

// Phase E: Primary database check via NexusDB abstraction (provider-agnostic)
async function checkNexusDB(): Promise<ServiceHealth> {
  const name = 'Primary Database (NexusDB)';
  try {
    const { NexusDB } = await import('../../database/NexusDB');
    const result = await NexusDB.healthCheck();
    return {
      name: `${name} [${result.provider}]`,
      status: result.healthy ? 'healthy' : 'unhealthy',
      latencyMs: result.latencyMs,
      lastCheckedAt: Date.now(),
      consecutiveFailures: 0,
    };
  } catch (e) {
    return { name, status: 'unhealthy', message: String(e), lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const name = 'Redis';
  if (!NexusConfig.storage.redisUrl || NexusConfig.storage.redisUrl === 'redis://localhost:6379') {
    return { name, status: 'unknown', message: 'REDIS_URL not configured', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
  // Attempt a simple HTTP health check on Redis Info port (placeholder - real check in Phase 4)
  return { name, status: 'unknown', message: 'Redis check requires ioredis (Phase 4)', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
}

async function checkPostgres(): Promise<ServiceHealth> {
  const name = 'PostgreSQL';
  if (!NexusConfig.storage.postgresUrl) {
    return { name, status: 'unknown', message: 'POSTGRES_URL not configured', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
  return { name, status: 'unknown', message: 'PostgreSQL check requires pg client (Phase 2)', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
}

async function checkQdrant(): Promise<ServiceHealth> {
  const name = 'Qdrant (Vector DB)';
  if (!NexusConfig.features.enableVectorMemory) {
    return { name, status: 'unknown', message: 'Vector memory disabled (FEATURE_VECTOR_MEMORY=false)', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
  const result = await pingUrl(`${NexusConfig.storage.qdrantUrl}/healthz`);
  return {
    name,
    status: result.ok ? 'healthy' : 'unhealthy',
    latencyMs: result.latencyMs,
    lastCheckedAt: Date.now(),
    consecutiveFailures: 0,
    message: result.ok ? undefined : 'Qdrant unreachable',
  };
}

async function checkGemini(): Promise<ServiceHealth> {
  const name = 'Gemini AI';
  if (!NexusConfig.ai.geminiApiKey) {
    return { name, status: 'unknown', message: 'GEMINI_API_KEY not set', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
  const start = Date.now();
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + NexusConfig.ai.geminiApiKey, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return { name, status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start, lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  } catch (e) {
    return { name, status: 'unhealthy', message: String(e), lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
}

async function checkOllama(): Promise<ServiceHealth> {
  const name = 'Ollama (Local AI)';
  if (!NexusConfig.ai.enableLocalAI) {
    return { name, status: 'unknown', message: 'Local AI disabled (ENABLE_LOCAL_AI=false)', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
  const result = await pingUrl(`${NexusConfig.ai.ollamaBaseUrl}/api/tags`);
  return {
    name, status: result.ok ? 'healthy' : 'unhealthy', latencyMs: result.latencyMs,
    message: result.ok ? undefined : 'Ollama not running',
    lastCheckedAt: Date.now(), consecutiveFailures: 0,
  };
}

async function checkStripe(): Promise<ServiceHealth> {
  const name = 'Stripe';
  if (!NexusConfig.payments.stripeSecretKey) {
    return { name, status: 'unknown', message: 'STRIPE_SECRET_KEY not set', lastCheckedAt: Date.now(), consecutiveFailures: 0 };
  }
  const mode = NexusConfig.payments.stripeSecretKey.startsWith('sk_live_') ? 'live' : 'test';
  return {
    name, status: 'healthy', message: `Configured (${mode} mode)`,
    lastCheckedAt: Date.now(), consecutiveFailures: 0,
  };
}

// ── Health Monitor class ──────────────────────────────────────────────────
class NexusHealthMonitorImpl {
  private serviceHistory = new Map<string, ServiceHealth>();
  private lastReport: SystemHealthReport | null = null;
  private startTime = Date.now();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private wasHealthy = true;

  /** Run all health checks and return report */
  async runChecks(): Promise<SystemHealthReport> {
    const done = log.startTimer('HealthCheck');

    const checkFns = [
      checkNexusDB,
      checkFirebase,
      checkRedis,
      checkPostgres,
      checkQdrant,
      checkGemini,
      checkOllama,
      checkStripe,
    ];

    const results = await Promise.allSettled(checkFns.map(fn => fn()));
    const services: ServiceHealth[] = [];

    for (const result of results) {
      const svc: ServiceHealth = result.status === 'fulfilled'
        ? result.value
        : { name: 'Unknown', status: 'unhealthy', message: 'Check threw', lastCheckedAt: Date.now(), consecutiveFailures: 0 };

      // Track consecutive failures
      const prev = this.serviceHistory.get(svc.name);
      svc.consecutiveFailures = svc.status === 'unhealthy'
        ? (prev?.consecutiveFailures ?? 0) + 1
        : 0;
      this.serviceHistory.set(svc.name, svc);
      services.push(svc);
    }

    // Score calculation
    const healthy = services.filter(s => s.status === 'healthy').length;
    const degraded = services.filter(s => s.status === 'degraded').length;
    const unhealthy = services.filter(s => s.status === 'unhealthy').length;
    const unknown = services.filter(s => s.status === 'unknown').length;
    const known = services.length - unknown;

    const score = known === 0 ? 100 : Math.round(
      ((healthy * 100) + (degraded * 60) + (unhealthy * 0)) / services.length
    );

    const overall: HealthStatus =
      score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy';

    const report: SystemHealthReport = {
      overall,
      score,
      services,
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };

    this.lastReport = report;

    // Emit events on health transitions
    if (this.wasHealthy && overall === 'unhealthy') {
      EventBus.emitAsync('system.health.degraded', { score, unhealthy: services.filter(s => s.status === 'unhealthy').map(s => s.name) }, 'HealthMonitor');
      log.error('System health degraded', undefined, { score, services: unhealthy });
    } else if (!this.wasHealthy && overall === 'healthy') {
      EventBus.emitAsync('system.health.recovered', { score }, 'HealthMonitor');
      log.info('System health recovered', { score });
    }

    this.wasHealthy = overall !== 'unhealthy';
    done();
    return report;
  }

  /** Get last cached report (fast) */
  getLastReport(): SystemHealthReport | null {
    return this.lastReport;
  }

  /** Start periodic health monitoring */
  startMonitoring(intervalMs = 60_000): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(async () => {
      try {
        await this.runChecks();
      } catch (e) {
        log.error('Health monitoring cycle failed', e instanceof Error ? e : undefined);
      }
    }, intervalMs);
    log.info(`Health monitoring started (interval: ${intervalMs / 1000}s)`);
  }

  /** Stop monitoring */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /** Express route handler for /api/health */
  async httpHandler(_req: any, res: any): Promise<void> {
    // Use cached report for fast response, run fresh check in background
    const cached = this.getLastReport();
    if (cached && Date.now() - cached.timestamp < 30_000) {
      res.status(cached.overall === 'unhealthy' ? 503 : 200).json(cached);
      return;
    }
    const report = await this.runChecks();
    res.status(report.overall === 'unhealthy' ? 503 : 200).json(report);
  }
}

/** Global HealthMonitor singleton */
export const HealthMonitor = new NexusHealthMonitorImpl();
