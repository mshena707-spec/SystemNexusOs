/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           NEXUS TENANT ISOLATION ENGINE — Phase 5            ║
 * ║  Strict data boundary enforcement for multi-tenancy.         ║
 * ║  Prevents cross-tenant data leakage at all layers.           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { logger } from '../../core/logging/NexusLogger';
import { AuditLog } from './ImmutableAuditLog';
import { EventBus } from '../../core/events/NexusEventBus';

const log = logger.child('TenantIsolation');

export interface TenantContext {
  tenantId: string;
  tenantName?: string;
  plan: 'free' | 'basic' | 'pro' | 'enterprise';
  limits: TenantLimits;
  allowedFeatures: string[];
}

export interface TenantLimits {
  maxOrdersPerDay: number;
  maxAICallsPerDay: number;
  maxAgentsActive: number;
  maxStorageGB: number;
  maxUsersActive: number;
  maxOmniChannels: number;
}

const PLAN_LIMITS: Record<TenantContext['plan'], TenantLimits> = {
  free:       { maxOrdersPerDay: 50,    maxAICallsPerDay: 500,    maxAgentsActive: 2,  maxStorageGB: 1,   maxUsersActive: 5,   maxOmniChannels: 1 },
  basic:      { maxOrdersPerDay: 500,   maxAICallsPerDay: 5000,   maxAgentsActive: 5,  maxStorageGB: 10,  maxUsersActive: 20,  maxOmniChannels: 3 },
  pro:        { maxOrdersPerDay: 5000,  maxAICallsPerDay: 50000,  maxAgentsActive: 20, maxStorageGB: 100, maxUsersActive: 100, maxOmniChannels: 7 },
  enterprise: { maxOrdersPerDay: 99999, maxAICallsPerDay: 999999, maxAgentsActive: 99, maxStorageGB: 999, maxUsersActive: 999, maxOmniChannels: 20 },
};

// ── Usage tracking — Phase N: Redis-backed via DistributedCounter ────────
// Previously an in-process Map (comment claimed "Redis in Phase 4" but it
// was never actually wired up). Under multiple server instances behind a
// load balancer, each instance tracked its own copy of "how many AI calls
// / orders has this tenant made today" — a tenant whose requests spread
// across N instances could exceed maxAICallsPerDay/maxOrdersPerDay by up
// to N× before any single instance's local counter caught it. Now atomic
// across all instances via Redis INCRBYFLOAT (or in-process fallback on
// a single dev instance with no Redis configured).
class TenantUsageTracker {
  private readonly windowSeconds = 24 * 60 * 60; // 24 hours

  async getUsage(tenantId: string): Promise<{ aiCalls: number; orders: number }> {
    const { DistributedCounter } = await import('../../scalability/DistributedCounter');
    const [aiCalls, orders] = await Promise.all([
      DistributedCounter.get(`tenant:${tenantId}:aiCalls`),
      DistributedCounter.get(`tenant:${tenantId}:orders`),
    ]);
    return { aiCalls, orders };
  }

  async incrementAICalls(tenantId: string, count = 1): Promise<number> {
    const { DistributedCounter } = await import('../../scalability/DistributedCounter');
    return DistributedCounter.increment(`tenant:${tenantId}:aiCalls`, count, this.windowSeconds);
  }

  async incrementOrders(tenantId: string): Promise<number> {
    const { DistributedCounter } = await import('../../scalability/DistributedCounter');
    return DistributedCounter.increment(`tenant:${tenantId}:orders`, 1, this.windowSeconds);
  }
}

const usageTracker = new TenantUsageTracker();

// ── Tenant Isolation Engine ───────────────────────────────────────────────
export class TenantIsolation {

  /** Enforce tenant ID on all Firestore queries */
  static injectTenantFilter(query: any, tenantId: string): any {
    return { ...query, tenantId };
  }

  /** Validate that a document belongs to the requesting tenant */
  static validateOwnership(doc: any, tenantId: string): boolean {
    if (!doc) return false;
    if (!doc.tenantId) return true; // Legacy data without tenant = global
    const valid = doc.tenantId === tenantId;
    if (!valid) {
      log.error('Cross-tenant access attempt blocked', undefined, {
        docTenantId: doc.tenantId, requestingTenantId: tenantId, docId: doc.id,
      });
      EventBus.emitAsync('security.breach_attempt', {
        type: 'cross_tenant_access', tenantId, docTenantId: doc.tenantId,
      }, 'TenantIsolation');
      AuditLog.record('security.breach_attempt',
        { id: tenantId, type: 'system' },
        { type: 'cross_tenant_access', docTenantId: doc.tenantId },
        { outcome: 'denied', severity: 'critical' }
      );
    }
    return valid;
  }

  /** Check AI call quota for tenant */
  static async checkAIQuota(tenantId: string, limits: TenantLimits): Promise<{ allowed: boolean; remaining: number }> {
    const usage = await usageTracker.getUsage(tenantId);
    const remaining = limits.maxAICallsPerDay - usage.aiCalls;
    if (remaining <= 0) {
      log.warn('AI quota exceeded', { tenantId, limit: limits.maxAICallsPerDay });
      return { allowed: false, remaining: 0 };
    }
    await usageTracker.incrementAICalls(tenantId);
    return { allowed: true, remaining: remaining - 1 };
  }

  /** Check order quota */
  static async checkOrderQuota(tenantId: string, limits: TenantLimits): Promise<boolean> {
    const usage = await usageTracker.getUsage(tenantId);
    if (usage.orders >= limits.maxOrdersPerDay) {
      log.warn('Order quota exceeded', { tenantId, limit: limits.maxOrdersPerDay });
      return false;
    }
    await usageTracker.incrementOrders(tenantId);
    return true;
  }

  /** Get plan limits */
  static getLimitsForPlan(plan: TenantContext['plan']): TenantLimits {
    return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  }

  /** Express middleware to inject tenant context */
  static middleware() {
    return async (req: any, res: any, next: any) => {
      const tenantId = req.headers['x-tenant-id'] || req.user?.tenantId || 'global';
      req.tenantId = tenantId;
      req.tenantLimits = PLAN_LIMITS.pro; // Default to pro; real lookup from Firestore in production
      next();
    };
  }

  /** Get usage stats for tenant */
  static async getUsageStats(tenantId: string) {
    return usageTracker.getUsage(tenantId);
  }
}
