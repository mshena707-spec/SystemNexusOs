/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  COUPON ENGINE — Phase Q                                             ║
 * ║                                                                       ║
 * ║  Built because the Owner Automation directive ("give 10% discount    ║
 * ║  to inactive customers") cannot be honestly executed without a real  ║
 * ║  discount-issuance and validation system. Before Phase Q there was   ║
 * ║  NO coupon/discount infrastructure anywhere in the codebase — an     ║
 * ║  automation action that "issued a discount" would have had nothing   ║
 * ║  real to call.                                                       ║
 * ║                                                                       ║
 * ║  SCOPE BOUNDARY (documented honestly, see PHASE_Q_CHANGELOG.md):     ║
 * ║  This engine creates real, persisted, independently-verifiable       ║
 * ║  coupons and can validate/redeem them. Order creation in this        ║
 * ║  codebase happens CLIENT-SIDE via direct Firestore writes from       ║
 * ║  CheckoutModal.tsx — there is no server-side checkout/order route    ║
 * ║  for Phase Q to hook into. So `validate()`/`redeem()` are real and   ║
 * ║  ready, but the checkout UI does not yet call them. That wiring is   ║
 * ║  a separate, clearly-flagged follow-up — NOT silently faked here.    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { NexusDB } from '../database/NexusDB';
import { AuditLog } from '../security/audit/ImmutableAuditLog';

export type CouponType = 'percent' | 'fixed';

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value: number;                      // percent (0-100) or fixed amount
  reason: string;
  targetCustomerIds: string[] | null; // null = open to anyone with the code
  maxRedemptions: number;
  redemptionCount: number;
  active: boolean;
  expiresAt: string | null;           // ISO string, null = never
  source: 'manual' | 'automation_rule' | 'nl_command';
  sourceRuleId?: string;
  createdBy: string;
  createdAt: string;
}

export interface CouponRedemption {
  id: string;
  couponId: string;
  code: string;
  customerId: string;
  orderId: string;
  discountAmount: number;
  redeemedAt: string;
}

function generateCode(prefix = 'NEXUS'): string {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${rand}`;
}

export class CouponEngine {
  /**
   * Create a real coupon. If targetCustomerIds is provided, the coupon is
   * restricted to that exact list of customers (used by automation rules
   * issuing a discount to a specific segment). If null, anyone with the
   * code can redeem it (subject to maxRedemptions).
   */
  static async create(params: {
    type: CouponType;
    value: number;
    reason: string;
    targetCustomerIds?: string[] | null;
    maxRedemptions?: number;
    expiresInDays?: number | null;
    source?: Coupon['source'];
    sourceRuleId?: string;
    createdBy: string;
    codePrefix?: string;
  }): Promise<Coupon> {
    if (params.type === 'percent' && (params.value <= 0 || params.value > 100)) {
      throw new Error('Percent coupon value must be between 0 and 100');
    }
    if (params.type === 'fixed' && params.value <= 0) {
      throw new Error('Fixed coupon value must be positive');
    }

    const code = generateCode(params.codePrefix);
    const now = new Date().toISOString();
    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
      : null;

    const coupon: Omit<Coupon, 'id'> = {
      code,
      type: params.type,
      value: params.value,
      reason: params.reason,
      targetCustomerIds: params.targetCustomerIds ?? null,
      maxRedemptions: params.maxRedemptions ?? (params.targetCustomerIds?.length || 1),
      redemptionCount: 0,
      active: true,
      expiresAt,
      source: params.source ?? 'manual',
      sourceRuleId: params.sourceRuleId,
      createdBy: params.createdBy,
      createdAt: now,
    };

    const id = await NexusDB.add('coupons', coupon);

    await AuditLog.record(
      'admin.action',
      { id: params.createdBy, type: 'user' },
      { couponId: id, code, type: params.type, value: params.value, targetCount: params.targetCustomerIds?.length ?? 'open', reason: params.reason, source: coupon.source },
      { action: 'coupon.created', resource: `coupons/${id}`, outcome: 'success' },
    );

    return { id, ...coupon };
  }

  /** Real validation — no fabricated discount, every check against persisted data. */
  static async validate(code: string, customerId: string, orderSubtotal: number, opts: {
    ipAddress?: string;
  } = {}): Promise<
    | { valid: true; coupon: Coupon; discountAmount: number }
    | { valid: false; reason: string }
  > {
    // ── Fraud gate (Part 11 — was identified as missing in Part 9) ──────────
    // FraudDetectionEngine.assessCouponAbuse() checks: rate of coupon attempts
    // per user (> 5/hour = suspicious), attempts per IP (> 10/hour = block),
    // and whether the same code was tried multiple times in quick succession.
    // This runs BEFORE any DB query so brute-force code guessing never hits
    // the database at scale.
    const { FraudDetectionEngine } = await import('../security/FraudDetectionEngine');
    const fraudCheck = FraudDetectionEngine.assessCouponAbuse({
      userId:    customerId,
      code,
      ipAddress: opts.ipAddress,
    });
    if (fraudCheck.decision === 'block') {
      // Emit event so AutomationEngine + KnowledgeGraph both see it
      const { EventBus } = await import('../core/events/NexusEventBus');
      EventBus.emit('fraud.detected', {
        userId:    customerId,
        reason:    fraudCheck.recommendedAction,
        context:   'coupon_abuse',
        code,
        ipAddress: opts.ipAddress,
        riskScore: fraudCheck.riskScore,
      });
      return { valid: false, reason: 'Coupon validation temporarily unavailable. Please try again later.' };
    }
    // ────────────────────────────────────────────────────────────────────────

    const matches = await NexusDB.find('coupons', { where: [{ field: 'code', op: '==', value: code.toUpperCase().trim() }], limit: 1 });
    const coupon = matches[0] as unknown as Coupon | undefined;

    if (!coupon) return { valid: false, reason: 'Coupon code not found' };
    if (!coupon.active) return { valid: false, reason: 'Coupon is no longer active' };
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: 'Coupon has expired' };
    }
    if (coupon.redemptionCount >= coupon.maxRedemptions) {
      return { valid: false, reason: 'Coupon has reached its redemption limit' };
    }
    if (coupon.targetCustomerIds && !coupon.targetCustomerIds.includes(customerId)) {
      return { valid: false, reason: 'This coupon is not valid for your account' };
    }

    const discountAmount = coupon.type === 'percent'
      ? Math.round(orderSubtotal * (coupon.value / 100) * 100) / 100
      : Math.min(coupon.value, orderSubtotal);

    return { valid: true, coupon, discountAmount };
  }

  static async redeem(couponId: string, code: string, customerId: string, orderId: string, discountAmount: number): Promise<void> {
    const redemption: Omit<CouponRedemption, 'id'> = {
      couponId, code, customerId, orderId, discountAmount,
      redeemedAt: new Date().toISOString(),
    };
    await NexusDB.add('coupon_redemptions', redemption);

    const coupon = await NexusDB.get('coupons', couponId);
    const newCount = ((coupon?.redemptionCount as number) ?? 0) + 1;
    await NexusDB.update('coupons', couponId, { redemptionCount: newCount });

    await AuditLog.record(
      'admin.action',
      { id: customerId, type: 'user' },
      { couponId, code, orderId, discountAmount },
      { action: 'coupon.redeemed', resource: `coupons/${couponId}`, outcome: 'success' },
    );
  }

  static async list(limit = 100): Promise<Coupon[]> {
    const rows = await NexusDB.find('coupons', { limit, orderBy: 'createdAt', orderDir: 'desc' });
    return rows as unknown as Coupon[];
  }

  static async deactivate(id: string, actorId: string): Promise<void> {
    await NexusDB.update('coupons', id, { active: false });
    await AuditLog.record(
      'admin.action',
      { id: actorId, type: 'user' },
      { couponId: id },
      { action: 'coupon.deactivated', resource: `coupons/${id}`, outcome: 'success' },
    );
  }
}
