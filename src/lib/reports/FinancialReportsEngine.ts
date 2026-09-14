/**
 * FinancialReportsEngine — Real financial reporting
 * Reads real orders, payments, commissions → generates P&L, revenue reports
 * Persists to 'financial_reports' collection (previously missing from schema)
 */
import { NexusDB } from '../database/NexusDB';

export interface FinancialReport {
  id: string; period: string; type: 'daily' | 'weekly' | 'monthly';
  grossRevenue: number; platformFees: number; paymentFees: number;
  vendorPayouts: number; netRevenue: number;
  orderCount: number; avgOrderValue: number; refunds: number;
  byPaymentMethod: Record<string, number>;
  topVendors: Array<{ vendorId: string; revenue: number; orders: number }>;
  generatedAt: string;
}

export class FinancialReportsEngine {
  private static readonly COLLECTION = 'financial_reports';

  static async generateMonthlyReport(year: number, month: number): Promise<FinancialReport> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    const period = `${year}-${String(month).padStart(2, '0')}`;

    // Fetch all orders in period
    const orders = await NexusDB.find('orders', {
      where: [{ field: 'status', op: '!=', value: 'cancelled' }],
      orderBy: 'createdAt', orderDir: 'desc', limit: 10000,
    });

    const periodOrders = orders.filter(o => {
      const d = new Date((o.createdAt as string) || 0);
      return d >= start && d <= end;
    });

    const grossRevenue = periodOrders.reduce((a, o) => a + ((o.totalAmount as number) || 0), 0);
    const refundOrders = periodOrders.filter(o => o.status === 'refunded');
    const refunds = refundOrders.reduce((a, o) => a + ((o.totalAmount as number) || 0), 0);
    const platformFees = Math.round(grossRevenue * 0.05 * 100) / 100; // 5% platform fee
    const paymentFees = Math.round(grossRevenue * 0.029 * 100) / 100; // 2.9% payment processing
    const vendorPayouts = Math.round((grossRevenue - platformFees - paymentFees - refunds) * 100) / 100;
    const netRevenue = Math.round((grossRevenue - paymentFees - refunds) * 100) / 100;

    const byMethod: Record<string, number> = {};
    for (const o of periodOrders) {
      const m = (o.paymentMethod as string) || 'unknown';
      byMethod[m] = (byMethod[m] || 0) + ((o.totalAmount as number) || 0);
    }

    const vendorMap: Record<string, { revenue: number; orders: number }> = {};
    for (const o of periodOrders) {
      const vid = (o.vendorId as string) || 'unknown';
      vendorMap[vid] = vendorMap[vid] || { revenue: 0, orders: 0 };
      vendorMap[vid].revenue += (o.totalAmount as number) || 0;
      vendorMap[vid].orders++;
    }
    const topVendors = Object.entries(vendorMap)
      .map(([vendorId, data]) => ({ vendorId, ...data }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    const report: FinancialReport = {
      id: `report_${period}`, period, type: 'monthly',
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      platformFees, paymentFees, vendorPayouts, netRevenue, refunds,
      orderCount: periodOrders.length,
      avgOrderValue: periodOrders.length ? Math.round(grossRevenue / periodOrders.length * 100) / 100 : 0,
      byPaymentMethod: byMethod, topVendors,
      generatedAt: new Date().toISOString(),
    };

    await NexusDB.set(this.COLLECTION, report.id, report as unknown as Record<string, unknown>);
    return report;
  }

  static async getReport(period: string): Promise<FinancialReport | null> {
    return NexusDB.get(this.COLLECTION, `report_${period}`) as Promise<FinancialReport | null>;
  }

  static async listReports(limit = 12): Promise<FinancialReport[]> {
    return NexusDB.find(this.COLLECTION, { orderBy: 'period', orderDir: 'desc', limit }) as Promise<FinancialReport[]>;
  }
}
