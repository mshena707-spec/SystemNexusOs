/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PROFIT ENGINE — Phase K                                             ║
 * ║                                                                      ║
 * ║  Computes REAL profit, not just revenue. Prior to this phase, every  ║
 * ║  "profit" metric anywhere in the dashboard would have been revenue   ║
 * ║  in disguise — there was no cost-of-goods or expense data anywhere.  ║
 * ║                                                                      ║
 * ║    Gross Profit = Revenue − COGS (cost of items actually sold)       ║
 * ║    Net Profit    = Gross Profit − Operating Expenses                 ║
 * ║                                                                      ║
 * ║  COGS is computed from actual order line items × each product's      ║
 * ║  costPrice (Phase K addition to the Product model) — NOT an          ║
 * ║  assumed margin percentage.                                          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface ProfitReport {
  periodLabel: string;
  fromISO: string;
  toISO: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  operatingExpenses: number;
  operatingExpensesByCategory: Record<string, number>;
  netProfit: number;
  netMarginPct: number;
  ordersWithMissingCostPrice: number; // data-quality flag — see below
}

export class ProfitEngine {

  /**
   * Compute Cost of Goods Sold for a set of orders by looking up each
   * line item's product.costPrice. Orders referencing products that have
   * no costPrice set are still counted in revenue, but their COGS
   * contribution is $0 — flagged via ordersWithMissingCostPrice so the
   * dashboard can surface a "set your product costs" data-quality warning
   * instead of silently understating COGS.
   */
  static async computeCOGS(orders: Array<{ items?: any[] }>): Promise<{ cogs: number; ordersWithMissingCostPrice: number }> {
    const { ProductRepository } = await import('../database/repositories/ProductRepository');
    const productCache = new Map<string, number | undefined>(); // productId -> costPrice
    let cogs = 0;
    let ordersWithMissingCostPrice = 0;

    for (const order of orders) {
      let orderHasMissingCost = false;
      for (const item of order.items ?? []) {
        const productId = item.productId ?? item.id;
        const qty = item.quantity ?? item.qty ?? 1;
        if (!productId) continue;

        if (!productCache.has(productId)) {
          const product = await ProductRepository.findById(productId);
          productCache.set(productId, product?.costPrice);
        }
        const costPrice = productCache.get(productId);
        if (costPrice == null) { orderHasMissingCost = true; continue; }
        cogs += costPrice * qty;
      }
      if (orderHasMissingCost) ordersWithMissingCostPrice++;
    }

    return { cogs, ordersWithMissingCostPrice };
  }

  /**
   * Full profit report for a date range: revenue (from paid orders),
   * COGS (from actual line items), operating expenses (from
   * ExpenseTracker), gross/net profit and margins.
   */
  static async getProfitReport(fromISO: string, toISO: string, periodLabel: string): Promise<ProfitReport> {
    const { OrderRepository } = await import('../database/repositories/OrderRepository');
    const { ExpenseTracker } = await import('./ExpenseTracker');

    // Pull paid/delivered orders in range. OrderRepository doesn't expose a
    // generic date-range+status query, so we use findRecent and filter —
    // acceptable at current order volumes; revisit with a dedicated
    // composite index if order volume grows past a few thousand/period.
    const recentOrders = await OrderRepository.findRecent(2000);
    const ordersInRange = recentOrders.filter(o => {
      const createdAt = (o.createdAt ?? '').toString();
      const isPaid = o.status === 'Paid' || o.status === 'Delivered' || o.paymentStatus === 'success';
      return isPaid && createdAt >= fromISO && createdAt <= toISO;
    });

    const revenue = ordersInRange.reduce((sum, o) => sum + (o.total ?? 0), 0);
    const { cogs, ordersWithMissingCostPrice } = await this.computeCOGS(ordersInRange);

    const grossProfit = revenue - cogs;
    const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const operatingExpensesByCategory = await ExpenseTracker.getTotalsByCategory(fromISO, toISO);
    // COGS-category expenses (if separately logged) are excluded here to
    // avoid double-counting against the line-item-derived COGS above.
    const operatingExpenses = Object.entries(operatingExpensesByCategory)
      .filter(([cat]) => cat !== 'cogs')
      .reduce((sum, [, amt]) => sum + amt, 0);

    const netProfit = grossProfit - operatingExpenses;
    const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    return {
      periodLabel, fromISO, toISO,
      revenue, cogs, grossProfit, grossMarginPct,
      operatingExpenses, operatingExpensesByCategory, netProfit, netMarginPct,
      ordersWithMissingCostPrice,
    };
  }

  /** Convenience: this month vs last month profit comparison. */
  static async getMonthOverMonth(): Promise<{ current: ProfitReport; previous: ProfitReport }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(monthStart.getTime() - 1);

    const current = await this.getProfitReport(monthStart.toISOString(), now.toISOString(), 'This Month');
    const previous = await this.getProfitReport(lastMonthStart.toISOString(), lastMonthEnd.toISOString(), 'Last Month');
    return { current, previous };
  }

  /** Per-product profitability — which products actually make money. */
  static async getProductProfitability(limit = 20): Promise<Array<{
    productId: string; name: string; unitsSold: number; revenue: number; cogs: number; grossProfit: number; marginPct: number;
  }>> {
    const { OrderRepository } = await import('../database/repositories/OrderRepository');
    const { ProductRepository } = await import('../database/repositories/ProductRepository');

    const orders = await OrderRepository.findRecent(2000);
    const paidOrders = orders.filter(o => o.status === 'Paid' || o.status === 'Delivered');

    const byProduct = new Map<string, { unitsSold: number; revenue: number; name: string }>();
    for (const order of paidOrders) {
      for (const item of order.items ?? []) {
        const productId = item.productId ?? item.id;
        if (!productId) continue;
        const qty = item.quantity ?? item.qty ?? 1;
        const lineRevenue = (item.price ?? 0) * qty;
        const entry = byProduct.get(productId) ?? { unitsSold: 0, revenue: 0, name: item.name ?? productId };
        entry.unitsSold += qty;
        entry.revenue += lineRevenue;
        byProduct.set(productId, entry);
      }
    }

    const results = [];
    for (const [productId, data] of byProduct.entries()) {
      const product = await ProductRepository.findById(productId);
      const costPrice = product?.costPrice ?? 0;
      const cogs = costPrice * data.unitsSold;
      const grossProfit = data.revenue - cogs;
      results.push({
        productId, name: product?.name ?? data.name,
        unitsSold: data.unitsSold, revenue: data.revenue, cogs, grossProfit,
        marginPct: data.revenue > 0 ? (grossProfit / data.revenue) * 100 : 0,
      });
    }

    return results.sort((a, b) => b.grossProfit - a.grossProfit).slice(0, limit);
  }
}
