/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SEGMENTATION ENGINE — Phase I                                       ║
 * ║                                                                      ║
 * ║  Bulk customer segmentation, built on top of BIEngine.scoreCustomer  ║
 * ║  (real LTV/churn/engagement formula, already production-quality)     ║
 * ║  which was previously only wired to a single-customer admin route.   ║
 * ║                                                                      ║
 * ║  This is NOT GrowthEngine.suggestCampaign(), which returned a        ║
 * ║  hardcoded fake `expectedROI: '+14%'` regardless of input — every    ║
 * ║  segment built here is computed from real order data per customer.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export type CustomerSegment = 'champion' | 'vip' | 'loyal' | 'new' | 'at_risk' | 'dormant';

export interface SegmentMember {
  userId: string;
  ltv: number;
  churnRisk: number;
  engagementScore: number;
  segment: CustomerSegment;
}

export interface SegmentSummary {
  segment: CustomerSegment;
  count: number;
  totalLtv: number;
  avgChurnRisk: number;
  members: string[]; // userIds — capped, see getSegment()
}

const ALL_SEGMENTS: CustomerSegment[] = ['champion', 'vip', 'loyal', 'new', 'at_risk', 'dormant'];

export class SegmentationEngine {

  /**
   * Score every customer who has placed at least one order, in bulk.
   * Built on BIEngine.scoreCustomer's real formula — not a fabricated
   * percentage. Caps at `maxCustomers` to avoid an unbounded scan; for
   * stores beyond a few thousand customers, this should move to a
   * scheduled batch job writing to a `customer_scores` collection rather
   * than computing on every request (documented in the Phase I changelog).
   */
  static async scoreAllCustomers(maxCustomers = 1000): Promise<SegmentMember[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const { BIEngine } = await import('../business-intelligence/analytics/BIEngine');

    // Distinct customers from recent orders — the population we can
    // meaningfully score (customers with zero orders have no signal here).
    const orders = await NexusDB.find('orders', { orderBy: 'createdAt', orderDir: 'desc', limit: 5000 });
    const userIds = Array.from(new Set(orders.map((o: any) => o.userId).filter(Boolean))).slice(0, maxCustomers);

    const results: SegmentMember[] = [];
    for (const userId of userIds) {
      try {
        const score = await BIEngine.scoreCustomer(userId);
        results.push({
          userId, ltv: score.ltv, churnRisk: score.churnRisk,
          engagementScore: score.engagementScore, segment: score.segment as CustomerSegment,
        });
      } catch { /* skip customers whose score computation fails — don't fail the whole batch */ }
    }
    return results;
  }

  /**
   * Get a summary of all segments — counts, total LTV, avg churn risk —
   * for the marketing dashboard's audience overview.
   */
  static async getSegmentSummaries(maxCustomers = 1000): Promise<SegmentSummary[]> {
    const scored = await this.scoreAllCustomers(maxCustomers);
    const summaries: SegmentSummary[] = [];

    for (const segment of ALL_SEGMENTS) {
      const members = scored.filter(c => c.segment === segment);
      summaries.push({
        segment,
        count: members.length,
        totalLtv: members.reduce((s, c) => s + c.ltv, 0),
        avgChurnRisk: members.length > 0 ? members.reduce((s, c) => s + c.churnRisk, 0) / members.length : 0,
        members: members.slice(0, 200).map(c => c.userId), // cap for payload size
      });
    }
    return summaries;
  }

  /** Get all userIds in a specific segment — used to build a campaign audience. */
  static async getSegmentMembers(segment: CustomerSegment, maxCustomers = 1000): Promise<SegmentMember[]> {
    const scored = await this.scoreAllCustomers(maxCustomers);
    return scored.filter(c => c.segment === segment);
  }
}
