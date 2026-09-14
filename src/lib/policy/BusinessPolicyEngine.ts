/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  BUSINESS POLICY ENGINE                                                  ║
 * ║                                                                          ║
 * ║  Closes the gap identified in CTO Audit Parts 9 & 10:                   ║
 * ║  "ABACEngine is real access-control policy, not a general business-rule  ║
 * ║   engine. Return/delivery/discount policy is a genuine, real gap."       ║
 * ║                                                                          ║
 * ║  SCOPE: Business rules that govern what customers CAN do with orders     ║
 * ║  (return, refund, cancel, reschedule), what discounts apply under what   ║
 * ║  conditions, and what SLAs riders are held to. NOT access control —      ║
 * ║  that remains ABACEngine's domain.                                       ║
 * ║                                                                          ║
 * ║  DESIGN: Owner creates policy documents in the DB via the admin UI.      ║
 * ║  The engine evaluates them at runtime against a context object.          ║
 * ║  Policies are priority-ordered; first matching policy wins.              ║
 * ║                                                                          ║
 * ║  BUILT-IN POLICIES (initial set, all override-able by owner):            ║
 * ║  • Return window: 7 days from delivery                                   ║
 * ║  • Refund: full refund if returned within window, 50% after              ║
 * ║  • Free delivery: orders above 500 BDT                                   ║
 * ║  • Rider SLA: 45 minutes from assignment                                 ║
 * ║  • Loyalty discount: 5% for VIP customers                                ║
 * ║  • Fraud hold: orders flagged as fraud are held for 24h manual review    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { NexusDB } from '../database/NexusDB';
import { EventBus } from '../core/events/NexusEventBus';
import { logger } from '../core/logging/NexusLogger';
import { AuditLog } from '../security/audit/ImmutableAuditLog';

const log = logger.child('BusinessPolicyEngine');

// ── Types ────────────────────────────────────────────────────────────────────

export type PolicyDomain =
  | 'return'
  | 'refund'
  | 'delivery'
  | 'discount'
  | 'sla'
  | 'fraud_hold'
  | 'cancellation';

export type PolicyConditionOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in' | 'contains';

export interface PolicyCondition {
  field:    string;                   // e.g. 'order.daysSinceDelivery', 'customer.segment'
  operator: PolicyConditionOperator;
  value:    unknown;
}

export interface PolicyAction {
  type:   string;                     // e.g. 'allow_return', 'apply_discount', 'hold_for_review'
  params: Record<string, unknown>;    // e.g. { refundPct: 100 }, { discountPct: 5 }
}

export interface BusinessPolicy {
  id:          string;
  name:        string;
  domain:      PolicyDomain;
  priority:    number;               // lower = higher priority; first match wins
  active:      boolean;
  conditions:  PolicyCondition[];    // AND logic: all must match
  actions:     PolicyAction[];
  description: string;
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

export interface PolicyEvaluationResult {
  matched:     boolean;
  policyId?:   string;
  policyName?: string;
  actions:     PolicyAction[];
  reason:      string;
}

export interface PolicyContext {
  order?: {
    id:              string;
    total:           number;
    status:          string;
    paymentStatus?:  string;
    createdAt?:      string;
    deliveredAt?:    string;
    daysSinceDelivery?: number;
  };
  customer?: {
    id:             string;
    segment?:       string;    // 'vip' | 'loyal' | 'new' | 'at_risk'
    ltv?:           number;
    churnRisk?:     number;
    fraudFlagged?:  boolean;
  };
  product?: {
    id:             string;
    category?:      string;
    price?:         number;
    returnable?:    boolean;
  };
  rider?: {
    id:             string;
    minutesSinceAssignment?: number;
  };
  delivery?: {
    distanceKm?:    number;
    subtotal?:      number;
  };
  [key: string]: unknown;
}

const POLICIES_COL = 'business_policies';

// ── Built-in default policies ─────────────────────────────────────────────────

const DEFAULT_POLICIES: Omit<BusinessPolicy, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name:     'Standard return window',
    domain:   'return',
    priority: 100,
    active:   true,
    description: 'Allow returns within 7 days of delivery',
    createdBy: 'system',
    conditions: [{ field: 'order.daysSinceDelivery', operator: '<=', value: 7 }],
    actions:    [{ type: 'allow_return', params: { refundPct: 100, requirePhoto: false } }],
  },
  {
    name:     'Late return partial refund',
    domain:   'return',
    priority: 200,
    active:   true,
    description: 'Allow returns between 8–14 days with 50% refund',
    createdBy: 'system',
    conditions: [
      { field: 'order.daysSinceDelivery', operator: '>', value: 7 },
      { field: 'order.daysSinceDelivery', operator: '<=', value: 14 },
    ],
    actions: [{ type: 'allow_return', params: { refundPct: 50, requirePhoto: true } }],
  },
  {
    name:     'Return window closed',
    domain:   'return',
    priority: 300,
    active:   true,
    description: 'Deny returns after 14 days',
    createdBy: 'system',
    conditions: [{ field: 'order.daysSinceDelivery', operator: '>', value: 14 }],
    actions:    [{ type: 'deny_return', params: { reason: 'Return window has closed (14 days from delivery)' } }],
  },
  {
    name:     'Free delivery above threshold',
    domain:   'delivery',
    priority: 100,
    active:   true,
    description: 'Free delivery on orders above 500 BDT',
    createdBy: 'system',
    conditions: [{ field: 'delivery.subtotal', operator: '>=', value: 500 }],
    actions:    [{ type: 'free_delivery', params: {} }],
  },
  {
    name:     'VIP loyalty discount',
    domain:   'discount',
    priority: 100,
    active:   true,
    description: '5% discount for VIP customers',
    createdBy: 'system',
    conditions: [{ field: 'customer.segment', operator: '==', value: 'vip' }],
    actions:    [{ type: 'apply_discount', params: { discountPct: 5, label: 'VIP Member Discount' } }],
  },
  {
    name:     'Rider SLA breach',
    domain:   'sla',
    priority: 100,
    active:   true,
    description: 'Flag delivery as SLA-breached if rider exceeds 45 minutes from assignment',
    createdBy: 'system',
    conditions: [{ field: 'rider.minutesSinceAssignment', operator: '>', value: 45 }],
    actions:    [{ type: 'flag_sla_breach', params: { alertOps: true, compensateCustomer: false } }],
  },
  {
    name:     'Fraud hold',
    domain:   'fraud_hold',
    priority: 10,
    active:   true,
    description: 'Hold orders from fraud-flagged customers for 24h manual review',
    createdBy: 'system',
    conditions: [{ field: 'customer.fraudFlagged', operator: '==', value: true }],
    actions:    [{ type: 'hold_for_review', params: { holdHours: 24, notifyOps: true } }],
  },
];

// ── Engine ────────────────────────────────────────────────────────────────────

export class BusinessPolicyEngine {

  private static _initialized = false;
  private static _cache = new Map<string, BusinessPolicy[]>();

  /** Seed the DB with built-in policies on first boot if they don't exist. */
  static async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    try {
      const existing = await NexusDB.find(POLICIES_COL, { limit: 1 });
      if ((existing as any[]).length > 0) return; // already seeded

      for (const p of DEFAULT_POLICIES) {
        const id  = `policy_${p.domain}_${p.priority}_${Date.now()}`;
        const now = new Date().toISOString();
        await NexusDB.set(POLICIES_COL, id, { ...p, id, createdAt: now, updatedAt: now } as unknown as Record<string, unknown>);
      }
      log.info(`BusinessPolicyEngine: seeded ${DEFAULT_POLICIES.length} built-in policies`);
    } catch (e) {
      log.error('Policy initialization failed', e instanceof Error ? e : undefined);
    }
  }

  // ── Evaluation ──────────────────────────────────────────────────────────────

  /**
   * Evaluate the first matching policy in the given domain against a context.
   *
   * @example
   * const result = await BusinessPolicyEngine.evaluate('return', {
   *   order: { id: 'ord_1', daysSinceDelivery: 5, ... },
   *   customer: { id: 'cust_1' },
   * });
   * if (result.matched) {
   *   const { refundPct } = result.actions[0].params;
   * }
   */
  static async evaluate(domain: PolicyDomain, context: PolicyContext): Promise<PolicyEvaluationResult> {
    const noMatch: PolicyEvaluationResult = {
      matched: false, actions: [],
      reason:  `No active policy matched for domain '${domain}'`,
    };

    try {
      const policies = await this._loadPolicies(domain);

      for (const policy of policies) {
        if (this._matchesAll(policy.conditions, context)) {
          log.info('Policy matched', { policyId: policy.id, domain, name: policy.name });

          // Emit for AutomationEngine / KnowledgeGraph
          EventBus.emit('policy.matched', {
            policyId:   policy.id,
            policyName: policy.name,
            domain,
            context: { orderId: (context.order as any)?.id, customerId: (context.customer as any)?.id },
          });

          return {
            matched:     true,
            policyId:    policy.id,
            policyName:  policy.name,
            actions:     policy.actions,
            reason:      policy.name,
          };
        }
      }

      return noMatch;
    } catch (e) {
      log.error('Policy evaluation failed', e instanceof Error ? e : undefined);
      return noMatch;
    }
  }

  // ── Convenience helpers ─────────────────────────────────────────────────────

  static async canReturn(orderId: string, daysSinceDelivery: number, customerId: string): Promise<{
    allowed: boolean;
    refundPct: number;
    requirePhoto: boolean;
    reason: string;
  }> {
    const result = await this.evaluate('return', {
      order:    { id: orderId, daysSinceDelivery, total: 0, status: 'delivered' },
      customer: { id: customerId },
    });

    if (!result.matched) return { allowed: false, refundPct: 0, requirePhoto: false, reason: result.reason };

    const action = result.actions[0];
    if (action.type === 'deny_return') {
      return { allowed: false, refundPct: 0, requirePhoto: false, reason: (action.params.reason as string) || 'Not eligible for return' };
    }

    return {
      allowed:      true,
      refundPct:    (action.params.refundPct as number) ?? 100,
      requirePhoto: (action.params.requirePhoto as boolean) ?? false,
      reason:       result.policyName || 'Eligible for return',
    };
  }

  static async getDeliveryDiscount(subtotal: number): Promise<{ freeDelivery: boolean }> {
    const result = await this.evaluate('delivery', { delivery: { subtotal } });
    return { freeDelivery: result.matched && result.actions[0]?.type === 'free_delivery' };
  }

  static async getCustomerDiscount(customerSegment: string): Promise<{ discountPct: number; label: string }> {
    const result = await this.evaluate('discount', { customer: { id: 'unknown', segment: customerSegment } });
    if (!result.matched) return { discountPct: 0, label: '' };
    const action = result.actions.find(a => a.type === 'apply_discount');
    return {
      discountPct: (action?.params.discountPct as number) ?? 0,
      label:       (action?.params.label as string) ?? '',
    };
  }

  // ── Policy management (owner/admin) ────────────────────────────────────────

  static async createPolicy(policy: Omit<BusinessPolicy, 'id' | 'createdAt' | 'updatedAt'>, createdBy: string): Promise<string> {
    const id  = `policy_${policy.domain}_${Date.now()}`;
    const now = new Date().toISOString();
    await NexusDB.set(POLICIES_COL, id, { ...policy, id, createdBy, createdAt: now, updatedAt: now } as unknown as Record<string, unknown>);
    this._cache.delete(policy.domain); // invalidate cache
    await AuditLog.record('admin.action', { id: createdBy, type: 'user' }, { policyId: id, domain: policy.domain },
      { action: 'policy.created', resource: POLICIES_COL, outcome: 'success' });
    return id;
  }

  static async updatePolicy(policyId: string, updates: Partial<BusinessPolicy>, updatedBy: string): Promise<void> {
    await NexusDB.update(POLICIES_COL, policyId, { ...updates, updatedAt: new Date().toISOString() });
    // Invalidate the domain cache
    for (const [domain] of this._cache) this._cache.delete(domain);
    await AuditLog.record('admin.action', { id: updatedBy, type: 'user' }, { policyId, updates },
      { action: 'policy.updated', resource: POLICIES_COL, outcome: 'success' });
  }

  static async listPolicies(domain?: PolicyDomain): Promise<BusinessPolicy[]> {
    const where = domain ? [{ field: 'domain', op: '==' as const, value: domain }] : [];
    const raw = await NexusDB.find(POLICIES_COL, { where, orderBy: 'priority', orderDir: 'asc' as const, limit: 200 });
    return raw as unknown as BusinessPolicy[];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private static async _loadPolicies(domain: PolicyDomain): Promise<BusinessPolicy[]> {
    const cached = this._cache.get(domain);
    if (cached) return cached;

    const raw = await NexusDB.find(POLICIES_COL, {
      where: [
        { field: 'domain',  op: '==',   value: domain },
        { field: 'active',  op: '==',   value: true  },
      ],
      orderBy: 'priority',
      orderDir: 'asc',
      limit: 100,
    });

    const policies = raw as unknown as BusinessPolicy[];
    this._cache.set(domain, policies);
    // Cache TTL: invalidate after 5 minutes
    setTimeout(() => this._cache.delete(domain), 5 * 60 * 1000);
    return policies;
  }

  private static _matchesAll(conditions: PolicyCondition[], context: PolicyContext): boolean {
    return conditions.every(c => this._matchesCondition(c, context));
  }

  private static _matchesCondition(condition: PolicyCondition, context: PolicyContext): boolean {
    const fieldValue = this._getFieldValue(condition.field, context);
    const { operator, value } = condition;

    switch (operator) {
      case '==':      return fieldValue === value;
      case '!=':      return fieldValue !== value;
      case '>':       return typeof fieldValue === 'number' && fieldValue > (value as number);
      case '>=':      return typeof fieldValue === 'number' && fieldValue >= (value as number);
      case '<':       return typeof fieldValue === 'number' && fieldValue < (value as number);
      case '<=':      return typeof fieldValue === 'number' && fieldValue <= (value as number);
      case 'in':      return Array.isArray(value) && value.includes(fieldValue);
      case 'not_in':  return Array.isArray(value) && !value.includes(fieldValue);
      case 'contains':return typeof fieldValue === 'string' && fieldValue.includes(value as string);
      default:        return false;
    }
  }

  /** Resolve dot-notation field paths like 'order.daysSinceDelivery' */
  private static _getFieldValue(fieldPath: string, context: PolicyContext): unknown {
    const parts = fieldPath.split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
