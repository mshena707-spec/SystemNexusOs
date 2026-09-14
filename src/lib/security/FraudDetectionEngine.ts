/**
 * FRAUD DETECTION ENGINE — Real velocity checks + IP signals + pattern matching
 * Integrates with OrderEngine at checkout to flag suspicious orders.
 */


import { NexusDB } from '../database/NexusDB';

export interface FraudSignal {
  type: 'velocity' | 'amount' | 'ip' | 'pattern' | 'new_account' | 'address' | 'coupon_abuse' | 'refund_risk';
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface FraudAssessment {
  riskScore: number;        // 0–100
  decision: 'allow' | 'review' | 'block';
  signals: FraudSignal[];
  recommendedAction: string;
}

const IS_SERVER = typeof window === 'undefined';

export class FraudDetectionEngine {
  // ── Velocity cache (in-memory, resets on restart — enough for rate-limiting) ──
  private static recentOrdersByUser = new Map<string, number[]>();
  private static recentOrdersByIP = new Map<string, number[]>();

  static async assess(params: {
    userId: string;
    email: string;
    amount: number;
    itemCount: number;
    ipAddress?: string;
    shippingAddress?: string;
    accountCreatedAt?: Date;
  }): Promise<FraudAssessment> {
    const signals: FraudSignal[] = [];
    let riskScore = 0;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour

    // ── 1. User velocity (>3 orders in 1 hour) ──────────────────────────────
    const userTimestamps = (this.recentOrdersByUser.get(params.userId) || [])
      .filter(t => now - t < windowMs);
    userTimestamps.push(now);
    this.recentOrdersByUser.set(params.userId, userTimestamps);

    if (userTimestamps.length > 5) {
      signals.push({ type: 'velocity', severity: 'high', detail: `${userTimestamps.length} orders in the last hour` });
      riskScore += 40;
    } else if (userTimestamps.length > 3) {
      signals.push({ type: 'velocity', severity: 'medium', detail: `${userTimestamps.length} orders in the last hour` });
      riskScore += 20;
    }

    // ── 2. IP velocity ───────────────────────────────────────────────────────
    if (params.ipAddress) {
      const ipTimestamps = (this.recentOrdersByIP.get(params.ipAddress) || [])
        .filter(t => now - t < windowMs);
      ipTimestamps.push(now);
      this.recentOrdersByIP.set(params.ipAddress, ipTimestamps);

      if (ipTimestamps.length > 8) {
        signals.push({ type: 'ip', severity: 'high', detail: `IP ${params.ipAddress}: ${ipTimestamps.length} orders/hour` });
        riskScore += 35;
      }
    }

    // ── 3. Unusually high amount ─────────────────────────────────────────────
    if (params.amount > 500) {
      signals.push({ type: 'amount', severity: 'medium', detail: `High order value: $${params.amount}` });
      riskScore += 15;
    }
    if (params.amount > 1000) {
      signals.push({ type: 'amount', severity: 'high', detail: `Very high order value: $${params.amount}` });
      riskScore += 25;
    }

    // ── 4. New account with high-value order ─────────────────────────────────
    if (params.accountCreatedAt) {
      const accountAgeDays = (now - params.accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < 1 && params.amount > 100) {
        signals.push({ type: 'new_account', severity: 'medium', detail: `Account < 1 day old, order $${params.amount}` });
        riskScore += 20;
      }
    }

    // ── 5. Historical check (chargeback / prior fraud blocks) ────────────────
    try {
      if (IS_SERVER) {
        const priorBlocks = await NexusDB.find('fraud_flags', {
          where: [
            { field: 'userId', op: '==', value: params.userId },
            { field: 'decision', op: '==', value: 'block' },
          ],
          orderBy: 'createdAt', orderDir: 'desc', limit: 1,
        });
        if (priorBlocks.length > 0) {
          signals.push({ type: 'pattern', severity: 'high', detail: 'User has previous fraud blocks' });
          riskScore += 50;
        }
      }
    } catch (_) {}

    // ── Decision ─────────────────────────────────────────────────────────────
    let decision: 'allow' | 'review' | 'block';
    let recommendedAction: string;

    if (riskScore >= 70) {
      decision = 'block';
      recommendedAction = 'Block order. Contact fraud team. Do not fulfil.';
    } else if (riskScore >= 35) {
      decision = 'review';
      recommendedAction = 'Hold for manual review. Contact customer to verify.';
    } else {
      decision = 'allow';
      recommendedAction = 'Low risk. Proceed normally.';
    }

    // Log high-risk assessments to Firestore
    if (riskScore >= 35) {
      try {
        await NexusDB.add('fraud_flags', {
          userId: params.userId,
          email: params.email,
          riskScore,
          decision,
          signals,
          amount: params.amount,
          ipAddress: params.ipAddress || null,
          createdAt: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return { riskScore, decision, signals, recommendedAction };
  }

  // ── Coupon-code abuse (brute-force / rapid-guessing) ──────────────────────
  // NOTE: a real, more sophisticated assessCouponAbuse() (tracking distinct
  // codes tried, not just attempt count) already exists further down in this
  // class — see the "Coupon-hunting detection" section below. Nothing to add here.

  /**
   * Phase P: real summary stats for the admin audit dashboard, sourced
   * from actual fraud_flags records — not estimated or fabricated.
   * Previously, no aggregation method existed at all; a UI component
   * (SystemAuditSimulationApp) was reading a `healthData.checks.fraud`
   * field that no server response ever produced, silently showing
   * 'N/A'/0 as if those were real measurements.
   */
  static async getSummary(hoursBack = 24): Promise<{
    blockedLast24h: number; reviewLast24h: number; flaggedUsers: number; blockRate: number;
  }> {
    try {
      const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
      const flags = await NexusDB.find('fraud_flags', {
        where: [{ field: 'createdAt', op: '>=', value: cutoff }],
        orderBy: 'createdAt', orderDir: 'desc', limit: 2000,
      });

      const blocked = flags.filter(f => f.decision === 'block');
      const review = flags.filter(f => f.decision === 'review');
      const uniqueUsers = new Set(flags.map(f => f.userId));

      return {
        blockedLast24h: blocked.length,
        reviewLast24h: review.length,
        flaggedUsers: uniqueUsers.size,
        blockRate: flags.length > 0 ? Math.round((blocked.length / flags.length) * 100) : 0,
      };
    } catch {
      // Fail to zero rather than throw — a broken stats query shouldn't
      // crash the audit dashboard, but it must not return invented numbers.
      return { blockedLast24h: 0, reviewLast24h: 0, flaggedUsers: 0, blockRate: 0 };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Added during CTO Audit Part 6 response (2026-07-22): "Coupon Abuse" and
  // "Refund Fraud" were 2 of the 6 fraud types the audit named — confirmed
  // by search to be completely absent from this class and CODFraudDetector.ts,
  // despite CouponEngine.ts (real coupon validate/redeem logic) and the order/
  // refund system already existing to check signals against. Kept as separate
  // methods rather than folded into assess() (checkout-time) — these are
  // different moments (coupon application, refund request), not checkout.
  // NOT yet wired into CouponEngine.validate() or a refund-request handler —
  // that integration is a deliberate follow-up, not done in this pass, so as
  // not to modify already-working redemption/refund code in the same change
  // that adds the detection logic. See docs/architecture/MARKETPLACE_BUSINESS_LOGIC.md.
  // ══════════════════════════════════════════════════════════════════════

  private static recentCouponAttemptsByUser = new Map<string, { code: string; at: number }[]>();

  /**
   * Call at coupon-application time, alongside (not instead of)
   * CouponEngine.validate(). Detects coupon-hunting behavior: a user trying
   * many DIFFERENT codes in a short window (guessing/scraping codes) is a
   * different, real signal from a user's single code simply being invalid.
   */
  static assessCouponAbuse(params: { userId: string; code: string; ipAddress?: string }): FraudAssessment {
    const signals: FraudSignal[] = [];
    let riskScore = 0;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour — same window convention as assess()

    const attempts = (this.recentCouponAttemptsByUser.get(params.userId) || [])
      .filter((a) => now - a.at < windowMs);
    attempts.push({ code: params.code, at: now });
    this.recentCouponAttemptsByUser.set(params.userId, attempts);

    const distinctCodes = new Set(attempts.map((a) => a.code)).size;
    if (distinctCodes > 8) {
      signals.push({ type: 'coupon_abuse', severity: 'high', detail: `${distinctCodes} distinct coupon codes tried in 1 hour` });
      riskScore += 50;
    } else if (distinctCodes > 4) {
      signals.push({ type: 'coupon_abuse', severity: 'medium', detail: `${distinctCodes} distinct coupon codes tried in 1 hour` });
      riskScore += 25;
    }

    const decision: FraudAssessment['decision'] = riskScore >= 50 ? 'block' : riskScore >= 25 ? 'review' : 'allow';
    return {
      riskScore, decision, signals,
      recommendedAction: decision === 'block' ? 'Block coupon application, flag account for review' : decision === 'review' ? 'Allow but flag for manual review' : 'No action needed',
    };
  }

  /**
   * Call when a refund is requested, before approving. `recentRefundCount`/
   * `recentOrderCount` are the caller's responsibility to supply (querying
   * the orders collection is outside this class's existing scope — it only
   * ever touched `fraud_flags`) — kept as parameters rather than this method
   * reaching into a collection it has no existing relationship with.
   */
  static assessRefundRisk(params: {
    userId: string;
    orderAmount: number;
    orderAgeDays: number;
    accountAgeDays: number;
    recentRefundCount: number;   // refunds by this user in the last 30 days
    recentOrderCount: number;    // orders by this user in the last 30 days
  }): FraudAssessment {
    const signals: FraudSignal[] = [];
    let riskScore = 0;

    const refundRate = params.recentOrderCount > 0 ? params.recentRefundCount / params.recentOrderCount : 0;
    if (refundRate > 0.5 && params.recentOrderCount >= 3) {
      signals.push({ type: 'refund_risk', severity: 'high', detail: `${Math.round(refundRate * 100)}% refund rate over ${params.recentOrderCount} recent orders` });
      riskScore += 45;
    } else if (refundRate > 0.3 && params.recentOrderCount >= 2) {
      signals.push({ type: 'refund_risk', severity: 'medium', detail: `${Math.round(refundRate * 100)}% refund rate over ${params.recentOrderCount} recent orders` });
      riskScore += 20;
    }

    if (params.orderAgeDays < 1 && params.orderAmount > 200) {
      signals.push({ type: 'refund_risk', severity: 'medium', detail: `High-value refund ($${params.orderAmount}) requested <24h after order` });
      riskScore += 15;
    }
    if (params.accountAgeDays < 7 && params.recentRefundCount >= 2) {
      signals.push({ type: 'refund_risk', severity: 'high', detail: `New account (${params.accountAgeDays}d) with ${params.recentRefundCount} refunds already` });
      riskScore += 35;
    }

    const decision: FraudAssessment['decision'] = riskScore >= 50 ? 'block' : riskScore >= 25 ? 'review' : 'allow';
    return {
      riskScore, decision, signals,
      recommendedAction: decision === 'block' ? 'Hold refund for manual review, do not auto-approve' : decision === 'review' ? 'Flag for review before processing' : 'Safe to auto-process',
    };
  }
}
