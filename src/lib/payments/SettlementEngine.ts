/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SETTLEMENT ENGINE — Phase F                                         ║
 * ║                                                                      ║
 * ║  Tracks the lifecycle of funds from "customer paid" to               ║
 * ║  "funds in merchant bank account".                                   ║
 * ║                                                                      ║
 * ║  Different providers settle on different schedules:                 ║
 * ║    Stripe: T+0 (near-instant to Stripe balance, then payout)        ║
 * ║    bKash:  T+1                                                       ║
 * ║    Nagad:  T+1 (manual back-office for refunds)                      ║
 * ║    Rocket: T+2                                                       ║
 * ║                                                                      ║
 * ║  This engine:                                                        ║
 * ║   - Computes expected settlement date per payment                    ║
 * ║   - Groups successful payments into daily settlement batches         ║
 * ║   - Tracks actual vs expected settlement (for reconciliation)        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { PaymentRegistry } from './PaymentRegistry';
import type { PaymentProvider } from './IPaymentAdapter';

export interface SettlementBatch {
  id?: string;
  provider: PaymentProvider;
  batchDate: string;          // YYYY-MM-DD — the date payments were made
  expectedSettlementDate: string;
  orderIds: string[];
  totalAmount: number;
  currency: string;
  status: 'pending' | 'settled' | 'partial' | 'overdue';
  actualSettledAmount?: number;
  settledAt?: string;
  createdAt?: string;
}

export class SettlementEngine {

  /**
   * Compute the expected settlement date for a payment based on provider's
   * settlement delay. Excludes weekends (Friday/Saturday — Bangladesh weekend).
   */
  static computeExpectedSettlementDate(provider: PaymentProvider, paidDate: Date = new Date()): string {
    const adapter = PaymentRegistry.get(provider);
    let businessDaysRemaining = adapter.settlementDelayDays;
    const result = new Date(paidDate);

    while (businessDaysRemaining > 0) {
      result.setDate(result.getDate() + 1);
      const dayOfWeek = result.getDay(); // 0=Sun, 5=Fri, 6=Sat
      // Bangladesh weekend: Friday(5) and Saturday(6)
      if (dayOfWeek !== 5 && dayOfWeek !== 6) {
        businessDaysRemaining--;
      }
    }
    return result.toISOString().slice(0, 10);
  }

  /**
   * Build settlement batches for a given date — groups all successful
   * payments by provider into daily batches with expected settlement dates.
   * Called by daily cron.
   */
  static async buildDailyBatches(forDate?: string): Promise<SettlementBatch[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const targetDate = forDate ?? new Date().toISOString().slice(0, 10);

    // Fetch all successful payments (verified, not yet settled)
    const payments = await NexusDB.find('payments', {
      where: [{ field: 'status', op: '==', value: 'success' }],
      limit: 1000,
    });

    // Group by provider + payment date
    const groups = new Map<string, typeof payments>();
    for (const p of payments) {
      const paidDateStr = (p.verifiedAt ?? p.createdAt ?? '').slice(0, 10);
      if (paidDateStr !== targetDate) continue; // only this date's batch
      const key = `${p.provider}_${paidDateStr}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const batches: SettlementBatch[] = [];

    for (const [key, group] of groups.entries()) {
      const [provider, batchDate] = key.split('_');
      const totalAmount = group.reduce((sum, p) => sum + (p.amount ?? 0), 0);
      const orderIds = group.map(p => p.orderId);

      const batch: SettlementBatch = {
        provider: provider as PaymentProvider,
        batchDate,
        expectedSettlementDate: this.computeExpectedSettlementDate(provider as PaymentProvider, new Date(batchDate)),
        orderIds,
        totalAmount,
        currency: group[0]?.currency ?? 'BDT',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      // Persist (idempotent: use deterministic ID per provider+date)
      const batchId = `settle_${provider}_${batchDate}`;
      await NexusDB.set('settlement_batches', batchId, batch, true);
      batches.push({ ...batch, id: batchId });
    }

    return batches;
  }

  /**
   * Mark a settlement batch as settled (called manually by admin or via
   * provider settlement report import).
   */
  static async markSettled(batchId: string, actualSettledAmount: number): Promise<{ success: boolean; status: SettlementBatch['status'] }> {
    const { NexusDB } = await import('../database/NexusDB');
    const batch = await NexusDB.get('settlement_batches', batchId);
    if (!batch) return { success: false, status: 'pending' };

    const status: SettlementBatch['status'] =
      Math.abs(actualSettledAmount - batch.totalAmount) < 0.01 ? 'settled' :
      actualSettledAmount > 0 ? 'partial' : 'pending';

    await NexusDB.update('settlement_batches', batchId, {
      status,
      actualSettledAmount,
      settledAt: new Date().toISOString(),
    });

    return { success: true, status };
  }

  /**
   * Find overdue batches — expected settlement date has passed but status
   * is still "pending". Called by daily cron for alerting.
   */
  static async findOverdueBatches(): Promise<SettlementBatch[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const today = new Date().toISOString().slice(0, 10);

    const pending = await NexusDB.find('settlement_batches', {
      where: [{ field: 'status', op: '==', value: 'pending' }],
      limit: 200,
    }) as SettlementBatch[];

    const overdue = pending.filter(b => b.expectedSettlementDate < today);

    // Mark as overdue
    for (const b of overdue) {
      await NexusDB.update('settlement_batches', (b as any).id, { status: 'overdue' });
    }

    return overdue.map(b => ({ ...b, status: 'overdue' as const }));
  }

  /**
   * Get settlement summary for admin dashboard.
   */
  static async getSummary(): Promise<{
    pending: number; settled: number; overdue: number; partial: number;
    totalPendingAmount: number; byProvider: Record<string, { pending: number; settled: number; amount: number }>;
  }> {
    const { NexusDB } = await import('../database/NexusDB');
    const batches = await NexusDB.find('settlement_batches', { limit: 500 }) as SettlementBatch[];

    const summary = {
      pending: 0, settled: 0, overdue: 0, partial: 0,
      totalPendingAmount: 0,
      byProvider: {} as Record<string, { pending: number; settled: number; amount: number }>,
    };

    for (const b of batches) {
      summary[b.status]++;
      if (b.status === 'pending' || b.status === 'overdue') summary.totalPendingAmount += b.totalAmount;

      if (!summary.byProvider[b.provider]) summary.byProvider[b.provider] = { pending: 0, settled: 0, amount: 0 };
      if (b.status === 'settled') summary.byProvider[b.provider].settled++;
      else summary.byProvider[b.provider].pending++;
      summary.byProvider[b.provider].amount += b.totalAmount;
    }

    return summary;
  }
}
