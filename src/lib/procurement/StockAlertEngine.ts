/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  STOCK ALERT ENGINE — Phase J                                        ║
 * ║                                                                      ║
 * ║  Monitors stock levels against reorder points and computes daily     ║
 * ║  sales velocity (DSV) from actual order history, then calls          ║
 * ║  InventoryAI.predictRestockDate() — the only existing, real         ║
 * ║  inventory function in the codebase, which was never wired to       ║
 * ║  real data or any admin route before Phase J.                        ║
 * ║                                                                      ║
 * ║  "Reorder point" is a new optional field on the Product model       ║
 * ║  (Phase J extension). Products without a reorder point set are       ║
 * ║  flagged for data-quality follow-up (same pattern as Phase K's      ║
 * ║  missing costPrice warning) rather than silently using an assumed    ║
 * ║  default that would hide the missing configuration.                  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface StockAlert {
  productId: string;
  productName: string;
  currentStock: number;
  reorderPoint: number | null;
  dailySalesVelocity: number;     // actual DSV from last 30 days of orders
  daysOfStockRemaining: number;   // currentStock / dailySalesVelocity (999 if DSV = 0)
  aiAdjustedRestockDays: number;  // from InventoryAI.predictRestockDate() — seasonality-aware
  severity: 'critical' | 'warning' | 'info' | 'no_reorder_point';
  supplierId?: string;
  supplierName?: string;
  recommendedOrderQty: number;    // DSV × leadTimeDays — enough to cover lead time + buffer
}

export class StockAlertEngine {

  /**
   * Compute real Daily Sales Velocity for a product from the last 30 days
   * of actual paid orders. Returns 0 if no sales data exists.
   */
  static async computeDSV(productId: string, lookbackDays = 30): Promise<number> {
    const { NexusDB } = await import('../database/NexusDB');
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    const orders = await NexusDB.find('orders', {
      where: [{ field: 'createdAt', op: '>=', value: cutoff }],
      limit: 2000,
    });

    const paidOrders = orders.filter((o: any) =>
      o.status === 'Paid' || o.status === 'Delivered'
    );

    let totalQty = 0;
    for (const order of paidOrders) {
      for (const item of order.items ?? []) {
        if ((item.productId ?? item.id) === productId) {
          totalQty += item.quantity ?? item.qty ?? 1;
        }
      }
    }

    return totalQty / lookbackDays;
  }

  /**
   * Run stock alerts across all products, computing real DSV and calling
   * InventoryAI.predictRestockDate() for each product that has stock data.
   * Products with no reorder point configured are flagged as 'no_reorder_point'
   * rather than silently skipped or given an assumed default.
   */
  static async runAlerts(limit = 500): Promise<StockAlert[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const { InventoryAI } = await import('../business/InventoryAI');
    const { SupplierRepository } = await import('./SupplierRepository');

    const products = await NexusDB.find('products', { limit }) as Array<{
      id: string; name: string; stock: number; reorderPoint?: number;
      supplierId?: string; leadTimeDays?: number;
    }>;

    const supplierCache = new Map<string, { name: string }>();
    const alerts: StockAlert[] = [];

    for (const product of products) {
      const dsv = await this.computeDSV(product.id);
      const daysRemaining = dsv > 0 ? (product.stock / dsv) : 999;

      // Wire to real InventoryAI (first time it's called from real data)
      const aiAdjustedDays = await InventoryAI.predictRestockDate(product.id, product.stock, dsv).catch(() => daysRemaining);

      // Supplier lookup (cached)
      let supplierName: string | undefined;
      if (product.supplierId) {
        if (!supplierCache.has(product.supplierId)) {
          const s = await SupplierRepository.findById(product.supplierId).catch(() => null);
          supplierCache.set(product.supplierId, { name: s?.name ?? 'Unknown' });
        }
        supplierName = supplierCache.get(product.supplierId)?.name;
      }

      const leadTimeDays = product.leadTimeDays ?? 7; // default 7 days if not set
      // Recommended order: enough to cover lead time + 50% buffer
      const recommendedOrderQty = dsv > 0 ? Math.ceil(dsv * leadTimeDays * 1.5) : 0;

      let severity: StockAlert['severity'] = 'info';
      if (!product.reorderPoint && product.reorderPoint !== 0) {
        severity = 'no_reorder_point';
      } else if (product.stock <= product.reorderPoint) {
        severity = aiAdjustedDays <= 3 ? 'critical' : 'warning';
      }

      alerts.push({
        productId: product.id, productName: product.name,
        currentStock: product.stock, reorderPoint: product.reorderPoint ?? null,
        dailySalesVelocity: Math.round(dsv * 100) / 100, daysOfStockRemaining: Math.round(daysRemaining),
        aiAdjustedRestockDays: Math.round(aiAdjustedDays),
        severity, supplierId: product.supplierId, supplierName,
        recommendedOrderQty,
      });
    }

    // Sort: critical → warning → no_reorder_point → info
    const ORDER: Record<string, number> = { critical: 0, warning: 1, no_reorder_point: 2, info: 3 };
    return alerts.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  }

  /**
   * Check a single product after stock decrements (called by ProductRepository
   * on every sale) and fire an alert notification if below reorder point.
   * This closes the loop between "stock ran out" and "notify someone to order more."
   */
  static async checkAfterDecrement(productId: string, newStock: number): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    const product = await NexusDB.get('products', productId) as { name?: string; reorderPoint?: number; supplierId?: string } | null;
    if (!product) return;

    const reorderPoint = product.reorderPoint;
    if (reorderPoint == null || newStock > reorderPoint) return; // not yet at reorder point

    try {
      await NexusDB.add('notifications', {
        userId: 'admin',
        title: `📦 Reorder Point Hit: ${product.name ?? productId}`,
        body: `Stock is now ${newStock} units — at or below reorder point of ${reorderPoint}. Check the Procurement dashboard to raise a purchase order.`,
        type: 'stock_alert', severity: newStock === 0 ? 'high' : 'medium',
        productId, read: false,
      });
    } catch { /* non-blocking */ }
  }
}
