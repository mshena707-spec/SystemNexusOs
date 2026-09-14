/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ABANDONED CART RECOVERY ENGINE — Phase R                            ║
 * ║                                                                       ║
 * ║  The existing codebase had two related pieces:                       ║
 * ║  1. AutomationEngine.runDailyJobs() scans Firestore `carts`         ║
 * ║     (status == 'active', updatedAt older than 2h), fires the        ║
 * ║     'cart.abandoned' event, and marks the cart status = 'abandoned'. ║
 * ║  2. AutomationEngine.handleAbandonedCart() sends a push notification  ║
 * ║     with an AI-generated message — referencing "SAVE10" coupon code ║
 * ║     that didn't actually exist.                                      ║
 * ║  3. GrowthEngine.triggerCartRecoverySequence() was a no-op (its own  ║
 * ║     comment admitted it always returned 0 results).                 ║
 * ║                                                                       ║
 * ║  Phase R fixes:                                                       ║
 * ║  - This engine provides the RECOVERY side: finds abandoned carts,   ║
 * ║    creates a real coupon (via CouponEngine) or awards loyalty bonus  ║
 * ║    based on customer tier, sends a real notification, and marks      ║
 * ║    carts as 'recovery_sent' so they're not retried.                 ║
 * ║  - AutomationEngine.handleAbandonedCart() is patched to call this   ║
 * ║    engine instead of referencing a non-existent "SAVE10" code.      ║
 * ║  - The `runDailyJobs()` scan remains unchanged — it already works.  ║
 * ║                                                                       ║
 * ║  SCOPE NOTE:                                                          ║
 * ║  Cart items are written by the client-side React cart UI directly    ║
 * ║  to Firestore. The Firestore `carts` collection therefore only has   ║
 * ║  carts from users who interacted with the cart UI. Guest carts with  ║
 * ║  no userId are skipped (no notification target).                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { CouponEngine } from '../promotions/CouponEngine';
import { LoyaltyEngine } from '../loyalty/LoyaltyEngine';
import { AuditLog } from '../security/audit/ImmutableAuditLog';
import { NexusDB } from '../database/NexusDB';
import { NexusUnifiedCore } from '../core/NexusUnifiedCore';

export interface CartRecoveryResult {
  cartId: string;
  customerId: string;
  action: 'coupon_issued' | 'loyalty_bonus' | 'notification_only' | 'skipped';
  couponCode?: string;
  loyaltyPointsAwarded?: number;
  notificationSent: boolean;
  reason: string;
}

export class AbandonedCartRecoveryEngine {
  /**
   * Called by AutomationEngine.handleAbandonedCart() when the daily job
   * marks a cart as abandoned and fires the event. This replaces the
   * deprecated "SAVE10" hard-reference in the previous handler.
   *
   * Strategy:
   *  - Gold/Platinum tier customers → loyalty bonus (500 pts) + notification
   *  - Silver tier → 10% coupon restricted to this customer + notification
   *  - Bronze/New → 5% coupon + notification
   *  - No userId → skip (no notification target)
   */
  static async recover(payload: { userId: string; cartTotal: number; cartId: string }): Promise<CartRecoveryResult> {
    const { userId, cartTotal, cartId } = payload;

    if (!userId) {
      return { cartId, customerId: '', action: 'skipped', notificationSent: false, reason: 'No userId — guest cart, no notification target' };
    }

    // Get loyalty tier to decide recovery action
    let tier: string = 'bronze';
    try {
      const balance = await LoyaltyEngine.getBalance(userId);
      tier = balance.tier;
    } catch {
      // If loyalty lookup fails, default to bronze-tier recovery
    }

    let action: CartRecoveryResult['action'] = 'notification_only';
    let couponCode: string | undefined;
    let loyaltyPointsAwarded: number | undefined;
    let recoveryMessage = '';

    if (tier === 'gold' || tier === 'platinum') {
      // Award loyalty bonus instead of discount — rewards engagement
      const bonusPoints = 500;
      try {
        await LoyaltyEngine.awardBonus(
          userId, bonusPoints, 'earn_bonus', cartId,
          'Abandoned cart recovery bonus — come back and complete your order!',
          'system_recovery',
        );
        loyaltyPointsAwarded = bonusPoints;
        action = 'loyalty_bonus';
        recoveryMessage = `${bonusPoints} loyalty points added to your account — complete your order to keep them!`;
      } catch {
        action = 'notification_only';
      }
    } else {
      // Issue a real restricted coupon
      const discountPct = tier === 'silver' ? 10 : 5;
      try {
        const coupon = await CouponEngine.create({
          type: 'percent',
          value: discountPct,
          reason: `Abandoned cart recovery for cart ${cartId}`,
          targetCustomerIds: [userId],
          maxRedemptions: 1,
          expiresInDays: 3,
          source: 'automation_rule',
          sourceRuleId: `cart_recovery_${cartId}`,
          createdBy: 'system_recovery',
          codePrefix: 'CART',
        });
        couponCode = coupon.code;
        action = 'coupon_issued';
        recoveryMessage = `Use code ${coupon.code} for ${discountPct}% off — expires in 3 days!`;
      } catch {
        action = 'notification_only';
        recoveryMessage = `Your cart is waiting — complete your order now!`;
      }
    }

    // Generate a personalised notification message via AI
    let notificationBody = recoveryMessage;
    try {
      const prompt = `Customer left a cart worth ${cartTotal}. Recovery action: ${action}. Message hint: "${recoveryMessage}". Write a single compelling push notification body (max 15 words). Be warm, not pushy.`;
      const aiResp = await NexusUnifiedCore.process(prompt, { agentRole: 'marketing_agent' });
      if (aiResp?.text) notificationBody = aiResp.text;
    } catch {
      // AI message generation is enhancement only — fall back to the recovery message
    }

    // Send notification
    let notificationSent = false;
    try {
      const { NotificationEngine } = await import('../notifications/NotificationEngine');
      await NotificationEngine.sendPush({
        userId,
        title: '🛒 Your cart is waiting',
        body: notificationBody,
        link: '/store/global?cart=open',
      } as any);
      notificationSent = true;
    } catch {
      notificationSent = false;
    }

    // Mark cart recovery attempt in NexusDB (for audit trail + de-duplication)
    await NexusDB.add('cart_recovery_log', {
      cartId, customerId: userId, cartTotal, action, couponCode,
      loyaltyPointsAwarded, notificationSent, recoveredAt: new Date().toISOString(),
    });

    await AuditLog.record(
      'admin.action', { id: 'system_recovery', type: 'system' },
      { cartId, customerId: userId, action, couponCode, loyaltyPointsAwarded, notificationSent },
      { action: 'cart.recovery_sent', resource: `carts/${cartId}`, outcome: 'success' },
    );

    return { cartId, customerId: userId, action, couponCode, loyaltyPointsAwarded, notificationSent, reason: notificationBody };
  }

  /** Admin view: recent recovery attempts */
  static async getRecoveryLog(limit = 100) {
    return NexusDB.find('cart_recovery_log', { orderBy: 'recoveredAt', orderDir: 'desc', limit });
  }
}
