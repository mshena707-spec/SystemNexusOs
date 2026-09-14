/**
 * PaymentReconciliationEngine — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed in the codebase. The real, working implementation already exists
 * as `ReconciliationEngine` (src/lib/payments/ReconciliationEngine.ts) —
 * this file just exposes it under the name/shape the route expects, instead
 * of duplicating its logic.
 */
import { ReconciliationEngine, ReconciliationReport, Discrepancy } from './ReconciliationEngine';

export type { ReconciliationReport, Discrepancy };

export class PaymentReconciliationEngine {
  /** POST /payments/reconcile — body may include { lookbackDays }. */
  static async reconcile(body: { lookbackDays?: number } = {}): Promise<ReconciliationReport> {
    return ReconciliationEngine.run(body.lookbackDays ?? 7);
  }

  static async getLatest(): Promise<ReconciliationReport | null> {
    return ReconciliationEngine.getLatest();
  }

  static async getDiscrepancies(days = 7): Promise<Discrepancy[]> {
    return ReconciliationEngine.getOpenDiscrepancies(days);
  }
}
