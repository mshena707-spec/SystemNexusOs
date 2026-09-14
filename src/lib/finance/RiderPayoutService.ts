/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  RIDER PAYOUT SERVICE                                                ║
 * ║                                                                      ║
 * ║  Unlike the other facades in this batch, no real implementation of  ║
 * ║  this existed anywhere in the codebase — admin.routes.ts called a   ║
 * ║  module that was never written. This is a genuine, from-scratch     ║
 * ║  implementation, built on top of the real OrderRepository /         ║
 * ║  RiderPerformanceEngine / ExpenseTracker modules that DO exist.     ║
 * ║                                                                      ║
 * ║  Payout formula (documented, not hidden):                           ║
 * ║    base = deliveredOrders × PER_DELIVERY_FEE_BDT                    ║
 * ║    bonus = base × 10%   if performanceScore >= 90 (grade S/A)       ║
 * ║          = base × 0%    otherwise                                   ║
 * ║    total = base + bonus                                             ║
 * ║                                                                      ║
 * ║  HONEST LIMITATIONS:                                                 ║
 * ║   - PER_DELIVERY_FEE_BDT is a flat placeholder rate (env-overridable)║
 * ║     — a real business needs to set this per its own economics.      ║
 * ║   - OrderRepository.findByRider() caps at 50 orders (existing repo  ║
 * ║     limit), so a rider with a very high delivery volume over the    ║
 * ║     requested period may be undercounted. Raise that repository's   ║
 * ║     limit if this is used for real payroll.                         ║
 * ║   - This computes a payout preview and records it as an expense;    ║
 * ║     it does NOT move real money. Wire it to a payment provider      ║
 * ║     payout API before relying on it for actual disbursement.        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const PER_DELIVERY_FEE_BDT = parseFloat((typeof process !== 'undefined' && process.env?.RIDER_PER_DELIVERY_FEE_BDT) || '60');
const BONUS_SCORE_THRESHOLD = 90;
const BONUS_RATE = 0.10;

export interface RiderPayoutReport {
  riderId: string;
  periodDays: number;
  deliveries: number;
  performanceScore: number;
  grade: string;
  baseBDT: number;
  bonusBDT: number;
  totalBDT: number;
  expenseId: string;
  computedAt: string;
}

export class RiderPayoutService {
  static async calculate(riderId: string, periodDays = 7): Promise<RiderPayoutReport> {
    if (!riderId) throw new Error('riderId is required');

    const { OrderRepository } = await import('../database/repositories/OrderRepository');
    const { RiderPerformanceEngine } = await import('../delivery/RiderPerformanceEngine');
    const { ExpenseTracker } = await import('./ExpenseTracker');

    const delivered = await OrderRepository.findByRider(riderId, 'Delivered');
    const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
    const inPeriod = delivered.filter(o => {
      const ts = o.deliveredAt?.toMillis?.() ?? (o.deliveredAt ? new Date(o.deliveredAt).getTime() : 0);
      return ts >= cutoff;
    });

    const period: 'today' | '7d' | '30d' = periodDays <= 1 ? 'today' : periodDays <= 7 ? '7d' : '30d';
    const performance = await RiderPerformanceEngine.getPerformance(riderId, period).catch(() => null);
    const performanceScore = performance?.performanceScore ?? 0;
    const grade = performance?.grade ?? 'C';

    const deliveries = inPeriod.length;
    const baseBDT = Math.round(deliveries * PER_DELIVERY_FEE_BDT * 100) / 100;
    const bonusBDT = performanceScore >= BONUS_SCORE_THRESHOLD ? Math.round(baseBDT * BONUS_RATE * 100) / 100 : 0;
    const totalBDT = Math.round((baseBDT + bonusBDT) * 100) / 100;

    const expenseId = await ExpenseTracker.record({
      category: 'rider_payout',
      amount: totalBDT,
      currency: 'BDT',
      description: `Rider payout — ${riderId} — ${deliveries} deliveries over ${periodDays}d (grade ${grade})`,
      incurredAt: new Date().toISOString().slice(0, 10),
      recordedBy: 'system',
    });

    return {
      riderId,
      periodDays,
      deliveries,
      performanceScore,
      grade,
      baseBDT,
      bonusBDT,
      totalBDT,
      expenseId,
      computedAt: new Date().toISOString(),
    };
  }
}
