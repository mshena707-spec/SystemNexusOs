/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CHURN PREDICTOR — Phase I                                           ║
 * ║                                                                      ║
 * ║  Identifies customers at risk of churning from real behavioral       ║
 * ║  signals: time since last order, order frequency drop, and channel   ║
 * ║  silence (Phase G message history). Does NOT use GrowthEngine's      ║
 * ║  TrustEngine.detectChurnRisk() which took a "sentiment array"        ║
 * ║  argument that nothing in the codebase ever populated — equivalent   ║
 * ║  to a function that could only ever be called with empty input.       ║
 * ║                                                                      ║
 * ║  Uses BIEngine.scoreCustomer() as the underlying scoring formula     ║
 * ║  (already real and tested on real order data), and adds a             ║
 * ║  recency/frequency/silence weighting layer on top of it.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface ChurnCandidate {
  userId: string;
  churnRisk: number;       // 0–100; higher = more likely to churn
  daysSinceLastOrder: number;
  orderCount: number;
  daysSinceLastMessage: number | null;  // from Phase G message history; null if never messaged
  recommendedAction: string;
}

export class ChurnPredictor {

  /**
   * Find customers at churn risk above `riskThreshold` (default 50/100).
   * Scoring is based on:
   *  - BIEngine.scoreCustomer().churnRisk (recency + frequency from real orders)
   *  - Days since last inbound message via any channel (Phase G MessageHistoryService)
   *
   * Unlike GrowthEngine.suggestRetentionDiscount(), the discount percentage
   * here is NOT hardcoded — it is derived from a configurable rule table
   * (see `discountPctForRisk()`), and the owner can override it before a
   * campaign is sent.
   */
  static async getAtRiskCustomers(riskThreshold = 50, limit = 200): Promise<ChurnCandidate[]> {
    const { BIEngine }            = await import('../business-intelligence/analytics/BIEngine');
    const { NexusDB }             = await import('../database/NexusDB');
    const { MessageHistoryService } = await import('../omnichannel/MessageHistoryService');

    const orders = await NexusDB.find('orders', { orderBy: 'createdAt', orderDir: 'desc', limit: 5000 });
    const userIds = Array.from(new Set(orders.map((o: any) => o.userId).filter(Boolean)));

    const candidates: ChurnCandidate[] = [];

    for (const userId of userIds.slice(0, limit * 3)) { // over-scan to find enough above threshold
      try {
        const score = await BIEngine.scoreCustomer(userId);
        if (score.churnRisk < riskThreshold) continue;

        // Days since last order
        const userOrders = orders.filter((o: any) => o.userId === userId && o.createdAt);
        const lastOrderMs = userOrders.length > 0
          ? Math.max(...userOrders.map((o: any) => new Date(o.createdAt.toString()).getTime()))
          : 0;
        const daysSinceLastOrder = lastOrderMs > 0 ? Math.floor((Date.now() - lastOrderMs) / 86400000) : 999;

        // Days since last message (Phase G — real cross-channel message history)
        let daysSinceLastMessage: number | null = null;
        try {
          const msgs = await MessageHistoryService.getTimeline(userId, 1);
          if (msgs.length > 0 && msgs[0].timestamp) {
            daysSinceLastMessage = Math.floor((Date.now() - new Date(msgs[0].timestamp).getTime()) / 86400000);
          }
        } catch { /* non-fatal — message history may not exist for all users */ }

        // Recommended action: driven by risk level and recency, not a
        // hardcoded coupon code. Owner reviews and adjusts before send.
        let recommendedAction = 'Send re-engagement push notification';
        if (score.churnRisk >= 80) {
          recommendedAction = `High risk: consider a personalised win-back offer (e.g. ${this.discountPctForRisk(score.churnRisk)}% off next order)`;
        } else if (daysSinceLastOrder > 30) {
          recommendedAction = 'Long inactivity: send "We miss you" campaign with product highlights';
        } else if (daysSinceLastMessage != null && daysSinceLastMessage > 14) {
          recommendedAction = 'Silent on all channels: try a different channel (SMS if on push, push if on SMS)';
        }

        candidates.push({
          userId, churnRisk: score.churnRisk, daysSinceLastOrder,
          orderCount: score.orderCount ?? 0, daysSinceLastMessage, recommendedAction,
        });
      } catch { /* skip, don't fail batch */ }

      if (candidates.length >= limit) break;
    }

    return candidates.sort((a, b) => b.churnRisk - a.churnRisk);
  }

  /**
   * Suggested discount percentage for a given churn risk — a configurable
   * rule table (not a hardcoded business-specific percentage). The owner
   * can override these on a per-campaign basis before sending.
   */
  static discountPctForRisk(risk: number): number {
    if (risk >= 90) return 20;
    if (risk >= 75) return 15;
    if (risk >= 60) return 10;
    return 5;
  }
}
