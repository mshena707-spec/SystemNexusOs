/**
 * FinancialReportEngine — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed. The real, working implementation is `FinancialReportsEngine`
 * (src/lib/reports/FinancialReportsEngine.ts) — this file exposes it under
 * the name/shape the route expects, converting the "YYYY-MM" period string
 * the route receives into the (year, month) the real engine takes.
 */
import { FinancialReportsEngine, FinancialReport } from '../reports/FinancialReportsEngine';

export type { FinancialReport };

export class FinancialReportEngine {
  /** POST /financial-reports/generate — body: { period: "YYYY-MM" }. */
  static async generate(period: string, _uid?: string): Promise<FinancialReport> {
    const match = /^(\d{4})-(\d{2})$/.exec(period ?? '');
    if (!match) {
      throw new Error(`Invalid period "${period}" — expected "YYYY-MM"`);
    }
    const [, yearStr, monthStr] = match;
    return FinancialReportsEngine.generateMonthlyReport(parseInt(yearStr, 10), parseInt(monthStr, 10));
  }
}
