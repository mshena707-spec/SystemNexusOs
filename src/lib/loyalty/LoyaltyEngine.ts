/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  LOYALTY POINTS ENGINE — Phase R                                     ║
 * ║                                                                       ║
 * ║  Completely absent before Phase R — no loyalty infrastructure        ║
 * ║  existed anywhere in the codebase (confirmed in Phase Q gap audit).  ║
 * ║                                                                       ║
 * ║  DESIGN:                                                              ║
 * ║  Points are earned on order completion (server-side event) and       ║
 * ║  redeemed against a future order (server-side redemption endpoint).  ║
 * ║  Each transaction is NexusDB-persisted and ImmutableAuditLog-logged. ║
 * ║  Balance is computed from the transaction log (not a mutable field)  ║
 * ║  so it can be verified / rebuilt at any time.                       ║
 * ║                                                                       ║
 * ║  TIERS (based on lifetime earned points):                            ║
 * ║    Bronze  0–999    Silver  1000–4999                                ║
 * ║    Gold    5000–14999   Platinum  15000+                             ║
 * ║                                                                       ║
 * ║  SCOPE NOTE:                                                          ║
 * ║  Points are awarded server-side via the /api/loyalty/award route     ║
 * ║  (called after order payment confirmation) and redeemed via          ║
 * ║  /api/loyalty/redeem. The client-side CheckoutModal does not yet     ║
 * ║  call redeem automatically — same documented gap as coupon wiring.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { NexusDB } from '../database/NexusDB';
import { AuditLog } from '../security/audit/ImmutableAuditLog';

export type LoyaltyTxType = 'earn_order' | 'redeem_order' | 'earn_referral' | 'earn_bonus' | 'admin_adjust' | 'expire';
export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  type: LoyaltyTxType;
  points: number;         // positive = earned, negative = spent/expired
  referenceId: string;    // orderId, campaignId, or 'admin'
  note: string;
  createdAt: string;
}

export interface LoyaltyBalance {
  customerId: string;
  currentPoints: number;
  lifetimeEarned: number;
  tier: LoyaltyTier;
  nextTier: LoyaltyTier | null;
  pointsToNextTier: number | null;
}

const IS_SERVER = typeof window === 'undefined';
declare const process: { env: Record<string, string | undefined> };

// Earn rate: 1 point per 10 BDT/USD spent (configurable via env)
const POINTS_PER_CURRENCY_UNIT = IS_SERVER ? parseFloat(process.env.LOYALTY_POINTS_PER_UNIT ?? '0.1') : 0.1;
// Minimum points for redemption
const MIN_REDEEM_POINTS = IS_SERVER ? parseInt(process.env.LOYALTY_MIN_REDEEM ?? '100') : 100;
// Point monetary value: 1 point = 0.01 BDT/USD
const POINT_VALUE = IS_SERVER ? parseFloat(process.env.LOYALTY_POINT_VALUE ?? '0.01') : 0.01;

const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
  platinum: 15000,
};

function computeTier(lifetimeEarned: number): LoyaltyTier {
  if (lifetimeEarned >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (lifetimeEarned >= TIER_THRESHOLDS.gold) return 'gold';
  if (lifetimeEarned >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

function nextTierInfo(tier: LoyaltyTier, lifetimeEarned: number): { nextTier: LoyaltyTier | null; pointsToNextTier: number | null } {
  const order: LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum'];
  const idx = order.indexOf(tier);
  if (idx === order.length - 1) return { nextTier: null, pointsToNextTier: null };
  const next = order[idx + 1];
  return { nextTier: next, pointsToNextTier: TIER_THRESHOLDS[next] - lifetimeEarned };
}

export class LoyaltyEngine {
  /** Points earned = floor(orderAmount × POINTS_PER_CURRENCY_UNIT). */
  static pointsForOrder(orderAmount: number): number {
    return Math.floor(orderAmount * POINTS_PER_CURRENCY_UNIT);
  }

  /** Monetary value of N points for display / discount application. */
  static pointsToValue(points: number): number {
    return Math.round(points * POINT_VALUE * 100) / 100;
  }

  /** Award points after an order is confirmed. Idempotent on orderId. */
  static async awardForOrder(customerId: string, orderId: string, orderAmount: number): Promise<{ pointsAwarded: number; newBalance: LoyaltyBalance }> {
    // Idempotency: don't award twice for the same order
    const existing = await NexusDB.find('loyalty_transactions', {
      where: [
        { field: 'customerId', op: '==', value: customerId },
        { field: 'referenceId', op: '==', value: orderId },
        { field: 'type', op: '==', value: 'earn_order' },
      ],
      limit: 1,
    });
    if (existing.length > 0) {
      const bal = await this.getBalance(customerId);
      return { pointsAwarded: 0, newBalance: bal };
    }

    const pointsAwarded = this.pointsForOrder(orderAmount);
    if (pointsAwarded <= 0) {
      return { pointsAwarded: 0, newBalance: await this.getBalance(customerId) };
    }

    const tx: Omit<LoyaltyTransaction, 'id'> = {
      customerId, type: 'earn_order', points: pointsAwarded,
      referenceId: orderId, note: `Earned for order ${orderId} (${orderAmount})`,
      createdAt: new Date().toISOString(),
    };
    await NexusDB.add('loyalty_transactions', tx);

    await AuditLog.record(
      'admin.action', { id: customerId, type: 'user' },
      { customerId, orderId, pointsAwarded, orderAmount },
      { action: 'loyalty.earn_order', resource: `loyalty/${customerId}`, outcome: 'success' },
    );

    return { pointsAwarded, newBalance: await this.getBalance(customerId) };
  }

  /** Award bonus points (referral, campaign, admin). */
  static async awardBonus(customerId: string, points: number, type: Exclude<LoyaltyTxType, 'earn_order' | 'redeem_order'>, referenceId: string, note: string, actorId = 'system'): Promise<void> {
    if (points <= 0) throw new Error('Bonus points must be positive');
    const tx: Omit<LoyaltyTransaction, 'id'> = {
      customerId, type, points, referenceId, note,
      createdAt: new Date().toISOString(),
    };
    await NexusDB.add('loyalty_transactions', tx);
    await AuditLog.record(
      'admin.action', { id: actorId, type: actorId === 'system' ? 'system' : 'user' },
      { customerId, points, type, referenceId, note },
      { action: 'loyalty.award_bonus', resource: `loyalty/${customerId}`, outcome: 'success' },
    );
  }

  /**
   * Redeem N points against an order. Returns the monetary discount value.
   * Validates balance before deducting.
   */
  static async redeem(customerId: string, points: number, orderId: string): Promise<{ discountValue: number }> {
    if (points < MIN_REDEEM_POINTS) {
      throw new Error(`Minimum redemption is ${MIN_REDEEM_POINTS} points`);
    }
    const balance = await this.getBalance(customerId);
    if (balance.currentPoints < points) {
      throw new Error(`Insufficient points: have ${balance.currentPoints}, requested ${points}`);
    }

    const tx: Omit<LoyaltyTransaction, 'id'> = {
      customerId, type: 'redeem_order', points: -points,
      referenceId: orderId, note: `Redeemed ${points} pts for order ${orderId}`,
      createdAt: new Date().toISOString(),
    };
    await NexusDB.add('loyalty_transactions', tx);

    await AuditLog.record(
      'admin.action', { id: customerId, type: 'user' },
      { customerId, pointsRedeemed: points, orderId },
      { action: 'loyalty.redeem', resource: `loyalty/${customerId}`, outcome: 'success' },
    );

    return { discountValue: this.pointsToValue(points) };
  }

  /** Compute balance from transaction log. Source of truth. */
  static async getBalance(customerId: string): Promise<LoyaltyBalance> {
    const txns = await NexusDB.find('loyalty_transactions', {
      where: [{ field: 'customerId', op: '==', value: customerId }],
      limit: 10000,
    }) as unknown as LoyaltyTransaction[];

    let currentPoints = 0;
    let lifetimeEarned = 0;
    for (const t of txns) {
      currentPoints += t.points;
      if (t.points > 0) lifetimeEarned += t.points;
    }
    currentPoints = Math.max(0, currentPoints);

    const tier = computeTier(lifetimeEarned);
    const { nextTier, pointsToNextTier } = nextTierInfo(tier, lifetimeEarned);

    return { customerId, currentPoints, lifetimeEarned, tier, nextTier, pointsToNextTier };
  }

  /** Get recent transactions for a customer (for UI display). */
  static async getTransactions(customerId: string, limit = 20): Promise<LoyaltyTransaction[]> {
    return await NexusDB.find('loyalty_transactions', {
      where: [{ field: 'customerId', op: '==', value: customerId }],
      orderBy: 'createdAt', orderDir: 'desc', limit,
    }) as unknown as LoyaltyTransaction[];
  }
}
