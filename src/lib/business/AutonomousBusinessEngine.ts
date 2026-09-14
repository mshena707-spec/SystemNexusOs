/**
 * AutonomousBusinessEngine — AI-driven cart recovery and dynamic pricing.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';
import { NexusUnifiedCore } from '../core/NexusUnifiedCore';
import { NotificationEngine } from '../integrations/NotificationEngine';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('AutonomousBusinessEngine');

const DEMAND_MULTIPLIERS: Record<string, number> = {
  high:   1.15,
  normal: 1.00,
  low:    0.90,
};

export class AutonomousBusinessEngine {
  /** Scan abandoned carts and send AI-generated recovery offers */
  static async recoverAbandonedCarts(): Promise<{ recovered: number }> {
    let recovered = 0;
    try {
      const abandonedCarts = await NexusDB.find('carts', {
        where: [{ field: 'status', op: '==', value: 'abandoned' }],
        limit: 100,
      });

      for (const cart of abandonedCarts) {
        try {
          const prompt = `User abandoned cart with items worth ${cart.total} BDT. Write a short urgency-driven recovery message offering 10% discount with code COMEBACK10. Max 2 sentences.`;
          const aiOffer = await NexusUnifiedCore.process(prompt, { agentRole: 'marketing_agent' });

          await NotificationEngine.notify({
            userId: cart.userId as string,
            channels: ['email', 'in_app'],
            title: 'You left something behind! 🛒',
            message: (aiOffer?.text as string) ?? 'Complete your order now and save 10% with code COMEBACK10.',
          });

          // Mark as recovery attempted
          await NexusDB.update('carts', cart.id as string, {
            recoveryAttempted: true,
            recoveryAttemptedAt: NexusDB.serverTimestamp(),
          });

          recovered++;
        } catch (cartErr) {
          log.warn(`Recovery failed for cart ${cart.id}`, { error: String(cartErr) });
        }
      }

      log.info(`Cart recovery complete. Recovered: ${recovered}`);
    } catch (err) {
      log.error('recoverAbandonedCarts failed', { error: String(err) });
    }
    return { recovered };
  }

  /** AI-assisted dynamic pricing with rules-based guardrails */
  static async generateDynamicPricing(
    productId: string,
    basePrice: number,
    demandLevel: 'high' | 'normal' | 'low',
  ): Promise<number> {
    const multiplier    = DEMAND_MULTIPLIERS[demandLevel] ?? 1;
    const suggestedPrice = Math.round(basePrice * multiplier * 100) / 100;

    try {
      const prompt = `Product ${productId}: base price ${basePrice} BDT, demand is ${demandLevel}. Suggest a psychologically effective price near ${suggestedPrice}. Output only the number, no text.`;
      const aiResp = await NexusUnifiedCore.process(prompt, { agentRole: 'master_analytics' });
      const parsed = parseFloat((aiResp?.text as string) ?? '');
      return isNaN(parsed) ? suggestedPrice : Math.round(parsed * 100) / 100;
    } catch {
      return suggestedPrice;
    }
  }

  /** Flag potential fraud order patterns */
  static async analyzeOrderRisk(
    orderId: string,
    orderData: Record<string, unknown>,
  ): Promise<{ riskScore: number; flags: string[] }> {
    const flags: string[] = [];
    let riskScore = 0;

    // Rule-based risk signals
    if ((orderData.amount as number) > 50_000) { flags.push('high_value'); riskScore += 30; }
    if (orderData.deliveryAddress === orderData.billingAddress) { riskScore -= 10; }
    if (!orderData.phoneVerified) { flags.push('unverified_phone'); riskScore += 20; }
    if (orderData.isNewUser && (orderData.amount as number) > 10_000) {
      flags.push('new_user_high_value'); riskScore += 25;
    }

    // Persist risk assessment
    await NexusDB.update('orders', orderId, {
      riskScore,
      riskFlags: flags,
      riskAssessedAt: NexusDB.serverTimestamp(),
    }).catch(() => {});

    return { riskScore: Math.min(100, Math.max(0, riskScore)), flags };
  }
}
