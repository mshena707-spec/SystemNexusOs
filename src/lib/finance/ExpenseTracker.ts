/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  EXPENSE TRACKER — Phase K                                           ║
 * ║                                                                      ║
 * ║  Records operating expenses (rent, salaries, marketing, software,    ║
 * ║  delivery fleet costs, etc.) so ProfitEngine and CashFlowEngine      ║
 * ║  have real expense data instead of treating revenue as profit.       ║
 * ║                                                                      ║
 * ║  This did not exist anywhere in the codebase before Phase K — BI     ║
 * ║  Engine (Phase prior) tracked revenue only, with zero notion of      ║
 * ║  cost of goods or operating expenses, so every "profit" number any   ║
 * ║  prior dashboard could have shown would have actually been revenue.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export type ExpenseCategory =
  | 'cogs' | 'rider_payout' | 'marketing' | 'software' | 'rent'
  | 'salaries' | 'payment_processing_fees' | 'refunds' | 'utilities' | 'other';

export interface Expense {
  id?: string;
  category: ExpenseCategory;
  amount: number;
  currency: 'BDT' | 'USD';
  description: string;
  vendor?: string;
  recurring?: boolean;
  recurrenceFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  incurredAt: string;     // ISO date the expense applies to (for monthly reports)
  recordedBy: string;     // uid or 'system' (auto-generated, e.g. rider payouts)
  createdAt?: string;
  receiptUrl?: string;
}

export class ExpenseTracker {

  /** Record a one-off or recurring expense. */
  static async record(input: Omit<Expense, 'createdAt'>): Promise<string> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.add('expenses', { ...input, createdAt: new Date().toISOString() });
  }

  /** Update an existing expense (e.g. correcting an amount). */
  static async update(id: string, data: Partial<Expense>): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.update('expenses', id, data);
  }

  /** Delete an expense (e.g. duplicate entry). */
  static async delete(id: string): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.delete('expenses', id);
  }

  /** Get expenses within a date range. */
  static async getInRange(fromISO: string, toISO: string): Promise<Expense[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const all = await NexusDB.find('expenses', {
      where: [{ field: 'incurredAt', op: '>=', value: fromISO }],
      orderBy: 'incurredAt', orderDir: 'desc', limit: 2000,
    }) as Expense[];
    return all.filter(e => e.incurredAt <= toISO);
  }

  /** Get total expenses by category within a date range — feeds ProfitEngine. */
  static async getTotalsByCategory(fromISO: string, toISO: string): Promise<Record<ExpenseCategory, number>> {
    const expenses = await this.getInRange(fromISO, toISO);
    const totals: Record<string, number> = {};
    for (const e of expenses) {
      totals[e.category] = (totals[e.category] ?? 0) + e.amount;
    }
    return totals as Record<ExpenseCategory, number>;
  }

  /** Get a flat total of all expenses within a date range. */
  static async getTotal(fromISO: string, toISO: string): Promise<number> {
    const expenses = await this.getInRange(fromISO, toISO);
    return expenses.reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Auto-record rider payouts as expenses, sourced from Phase B's
   * RiderPerformanceEngine data and Phase F's settled payment batches.
   * Idempotent: uses a deterministic ID per rider+period so re-running
   * doesn't double-count.
   */
  static async recordRiderPayout(riderId: string, periodLabel: string, amount: number, currency: 'BDT' | 'USD' = 'BDT'): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    const id = `payout_${riderId}_${periodLabel}`;
    await NexusDB.set('expenses', id, {
      category: 'rider_payout' as ExpenseCategory,
      amount, currency,
      description: `Rider payout for ${periodLabel}`,
      vendor: riderId,
      recordedBy: 'system',
      incurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }, true);
  }

  /**
   * Auto-record payment processing fees, sourced from Phase F's
   * PaymentRegistry — most providers charge a percentage fee per transaction.
   * Called by the same cron that runs SettlementEngine.
   */
  static async recordProcessingFee(provider: string, periodLabel: string, totalProcessed: number, feeRate: number): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    const feeAmount = totalProcessed * feeRate;
    if (feeAmount <= 0) return;
    const id = `fee_${provider}_${periodLabel}`;
    await NexusDB.set('expenses', id, {
      category: 'payment_processing_fees' as ExpenseCategory,
      amount: feeAmount, currency: 'BDT',
      description: `${provider} processing fee (${(feeRate*100).toFixed(2)}% of ${totalProcessed.toFixed(2)})`,
      vendor: provider,
      recordedBy: 'system',
      incurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }, true);
  }
}
