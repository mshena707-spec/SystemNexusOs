/**
 * GROWTH ENGINE — previously Phase 60/61, remediated in Phase I
 *
 * Status of each method:
 *
 *  FABRICATED → deprecated, replaced by Phase I:
 *   - GrowthEngine.suggestCampaign()  → used CampaignEngine.create/send()
 *     (returned hardcoded expectedROI: '+14%' regardless of audience)
 *   - GrowthEngine.suggestRetentionDiscount() → use ChurnPredictor.discountPctForRisk()
 *     (hardcoded 0.15/0.05 regardless of actual customer data or business context)
 *   - GrowthEngine.triggerCartRecoverySequence() → depends on AutonomousBusinessEngine
 *     .recoverAbandonedCarts(), which queries for carts marked 'abandoned' but nothing
 *     in the entire codebase ever marks a cart as abandoned — would always return 0
 *     results. Left deprecated rather than deleted for reference.
 *   - TrustEngine.detectChurnRisk() → use ChurnPredictor.getAtRiskCustomers()
 *     (took a sentimentTrend array that nothing in the codebase ever populated)
 *
 *  REAL → kept:
 *   - GrowthEngine.calculateViralCoefficient() — correct formula, no fabrication
 *   - GrowthEngine.generateFestivalCampaign()  — real AI call via NexusUnifiedCore
 */

import { AutonomousBusinessEngine } from './AutonomousBusinessEngine';

export class TrustEngine {
  /**
   * @deprecated Phase I: use ChurnPredictor.getAtRiskCustomers() instead.
   * This method took a sentimentTrend[] that nothing in the codebase ever
   * populated from real data — it could only ever be called with fabricated
   * or empty input, making its output meaningless regardless of accuracy.
   */
  static detectChurnRisk(sentimentTrend: number[]): boolean {
    const avg = sentimentTrend.length > 0 ? sentimentTrend.reduce((a,b)=>a+b, 0) / sentimentTrend.length : 0;
    return avg < 0.4;
  }
}

export class GrowthEngine {

  /**
   * @deprecated Phase I: use CampaignEngine.create() + CampaignEngine.send() instead.
   * This method returned a hardcoded `expectedROI: '+14%'` regardless of audience,
   * channel, or content. Phase I's CampaignEngine measures real attribution from
   * actual orders placed by campaign recipients within a configurable window.
   */
  static suggestCampaign(audienceSegment: string) {
    console.warn(`[GrowthEngine] suggestCampaign() is deprecated. Use CampaignEngine (Phase I).`);
    return {
      channel: 'whatsapp/email',
      copy: 'Use CampaignEngine.create() with real AI-generated content via generateFestivalCampaign() or the MarketingAgent.',
      expectedROI: 'UNMEASURED — use CampaignEngine.measureAttribution() after sending for real conversion data',
    };
  }

  /** Real formula: (successful signups) / (invites sent). Kept. */
  static calculateViralCoefficient(invitesSent: number, successfulSignups: number): number {
    if (invitesSent === 0) return 0;
    return successfulSignups / invitesSent;
  }

  /** Real AI call via NexusUnifiedCore. Kept. */
  static async generateFestivalCampaign(festivalName: string, targetAudience: string): Promise<string> {
    const { NexusUnifiedCore } = await import('../core/NexusUnifiedCore');
    const prompt = `Generate a 2-sentence viral marketing SMS campaign for ${festivalName} targeting ${targetAudience}. Include a call to action.`;
    const response = await NexusUnifiedCore.process(prompt, { agentRole: 'marketing_agent' });
    return response.text;
  }

  /**
   * Phase R: now delegates to AbandonedCartRecoveryEngine which creates real
   * coupons/loyalty bonuses and sends real notifications. Previously this was
   * a no-op because nothing ever marked carts as 'abandoned'. AutomationEngine
   * .runDailyJobs() now handles the marking; this method is available for
   * manual/ad-hoc recovery triggers.
   */
  static async triggerCartRecoverySequence(customerId?: string, cartId?: string, cartTotal?: number) {
    if (customerId && cartId && cartTotal !== undefined) {
      // Direct call with known cart — e.g. from a manual admin action
      const { AbandonedCartRecoveryEngine } = await import('./AbandonedCartRecoveryEngine' as any).catch(() =>
        import('../marketing/AbandonedCartRecoveryEngine')
      );
      return AbandonedCartRecoveryEngine.recover({ userId: customerId, cartId, cartTotal });
    }
    // Without specific cart params, log and return — bulk recovery is handled by the cron job.
    console.info('[GrowthEngine] triggerCartRecoverySequence: bulk recovery runs via AutomationEngine.runDailyJobs() cron. Pass customerId/cartId/cartTotal for a specific cart.');
    return null;
  }

  /**
   * @deprecated Phase I: use ChurnPredictor.discountPctForRisk(risk) instead.
   * The 15%/5% values here were hardcoded without any basis in this business's
   * actual customer economics or margin structure. ChurnPredictor uses the same
   * rule table concept but labels it as a configurable default, not a measurement.
   */
  static suggestRetentionDiscount(userActivityScore: number): number {
    console.warn('[GrowthEngine] suggestRetentionDiscount() is deprecated. Use ChurnPredictor.discountPctForRisk().');
    if (userActivityScore < 0.2) return 0.15;
    if (userActivityScore < 0.5) return 0.05;
    return 0;
  }
}
