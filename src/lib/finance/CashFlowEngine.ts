/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CASH FLOW ENGINE — Phase K                                          ║
 * ║                                                                      ║
 * ║  Tracks actual cash movement, distinct from revenue recognition.     ║
 * ║  A sale being "Paid" in the orders collection does NOT mean the      ║
 * ║  money is in the merchant's bank account yet — Phase F's             ║
 * ║  SettlementEngine already tracks T+0/T+1/T+2 settlement delay per     ║
 * ║  provider. This engine is the first place that distinction is        ║
 * ║  actually surfaced as a business metric rather than buried in        ║
 * ║  payment-ops internals.                                              ║
 * ║                                                                      ║
 * ║    Cash In  = settled payment batches (Phase F SettlementEngine)     ║
 * ║    Cash Out = expenses (Phase K ExpenseTracker) + completed refunds  ║
 * ║               (Phase F RefundEngine) + rider payouts                 ║
 * ║    Net Cash Flow = Cash In − Cash Out                                ║
 * ║    Pending Cash  = payments that are "Paid" but not yet settled —    ║
 * ║                    real money the business is owed but doesn't have ║
 * ║                    in hand yet (a genuine cash-flow risk indicator)  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface CashFlowReport {
  periodLabel: string;
  fromISO: string;
  toISO: string;
  cashIn: number;            // settled payments only
  cashOut: number;           // expenses + completed refunds
  netCashFlow: number;
  pendingCashIn: number;     // paid-but-not-yet-settled — owed, not in hand
  refundsOut: number;
  expensesOut: number;
  byProvider: Record<string, { settled: number; pending: number }>;
}

export class CashFlowEngine {

  /**
   * Compute actual cash flow for a date range, distinguishing settled
   * (real cash in hand) from pending (recognized revenue, not yet liquid).
   */
  static async getCashFlowReport(fromISO: string, toISO: string, periodLabel: string): Promise<CashFlowReport> {
    const { NexusDB } = await import('../database/NexusDB');
    const { ExpenseTracker } = await import('./ExpenseTracker');

    // Settlement batches from Phase F — the real source of "cash actually received"
    const batches = await NexusDB.find('settlement_batches', { limit: 1000 }) as Array<{
      provider: string; batchDate: string; totalAmount: number; status: string;
    }>;

    const inRange = batches.filter(b => b.batchDate >= fromISO.slice(0,10) && b.batchDate <= toISO.slice(0,10));

    let cashIn = 0, pendingCashIn = 0;
    const byProvider: Record<string, { settled: number; pending: number }> = {};

    for (const b of inRange) {
      if (!byProvider[b.provider]) byProvider[b.provider] = { settled: 0, pending: 0 };
      if (b.status === 'settled') {
        cashIn += b.totalAmount;
        byProvider[b.provider].settled += b.totalAmount;
      } else {
        // pending, overdue, or partial — treat as not-yet-liquid
        pendingCashIn += b.totalAmount;
        byProvider[b.provider].pending += b.totalAmount;
      }
    }

    // Completed refunds (real cash leaving) from Phase F payments collection
    const payments = await NexusDB.find('payments', {
      where: [{ field: 'refundStatus', op: '==', value: 'completed' }],
      limit: 1000,
    });
    const refundsOut = payments
      .filter((p: any) => (p.lastRefundAt ?? '') >= fromISO && (p.lastRefundAt ?? '') <= toISO)
      .reduce((sum: number, p: any) => sum + (p.refundAmount ?? 0), 0);

    const expensesOut = await ExpenseTracker.getTotal(fromISO, toISO);
    const cashOut = refundsOut + expensesOut;

    return {
      periodLabel, fromISO, toISO,
      cashIn, cashOut, netCashFlow: cashIn - cashOut,
      pendingCashIn, refundsOut, expensesOut, byProvider,
    };
  }

  /** This month vs last month cash flow comparison. */
  static async getMonthOverMonth(): Promise<{ current: CashFlowReport; previous: CashFlowReport }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(monthStart.getTime() - 1);

    const current = await this.getCashFlowReport(monthStart.toISOString(), now.toISOString(), 'This Month');
    const previous = await this.getCashFlowReport(lastMonthStart.toISOString(), lastMonthEnd.toISOString(), 'Last Month');
    return { current, previous };
  }

  /**
   * Daily cash-flow time series for charting — last N days, split into
   * settled (cashIn) vs pending bars so the dashboard can visually show
   * "money recognized" vs "money actually in hand".
   */
  static async getDailySeries(days = 14): Promise<Array<{ date: string; settled: number; pending: number; expenses: number }>> {
    const { NexusDB } = await import('../database/NexusDB');
    const { ExpenseTracker } = await import('./ExpenseTracker');

    const batches = await NexusDB.find('settlement_batches', { limit: 1000 }) as Array<{
      batchDate: string; totalAmount: number; status: string;
    }>;

    const series: Array<{ date: string; settled: number; pending: number; expenses: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const dayBatches = batches.filter(b => b.batchDate === dateStr);
      const settled = dayBatches.filter(b => b.status === 'settled').reduce((s,b) => s + b.totalAmount, 0);
      const pending = dayBatches.filter(b => b.status !== 'settled').reduce((s,b) => s + b.totalAmount, 0);
      const expenses = await ExpenseTracker.getTotal(`${dateStr}T00:00:00.000Z`, `${dateStr}T23:59:59.999Z`);
      series.push({ date: dateStr, settled, pending, expenses });
    }
    return series;
  }

  /**
   * Cash-flow risk flag: if pending cash (owed but not received) grows
   * much faster than settled cash over a period, that's an early warning
   * sign of a settlement backlog or provider payout problem — surfaced
   * here so the owner sees it before it becomes a liquidity crisis.
   */
  static async getRiskFlags(): Promise<Array<{ severity: 'low'|'medium'|'high'; message: string }>> {
    const { SettlementEngine } = await import('../payments/SettlementEngine');
    const summary = await SettlementEngine.getSummary();
    const flags: Array<{ severity: 'low'|'medium'|'high'; message: string }> = [];

    if (summary.overdue > 0) {
      flags.push({
        severity: 'high',
        message: `${summary.overdue} settlement batch(es) totaling $${summary.totalPendingAmount.toFixed(2)} are overdue — check provider payout status`,
      });
    }
    const pendingRatio = summary.pending / Math.max(1, summary.pending + summary.settled);
    if (pendingRatio > 0.4) {
      flags.push({
        severity: 'medium',
        message: `${(pendingRatio*100).toFixed(0)}% of recent batches are still pending settlement — cash-in-hand may lag recognized revenue significantly`,
      });
    }
    return flags;
  }
}
