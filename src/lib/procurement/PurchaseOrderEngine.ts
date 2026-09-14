/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PURCHASE ORDER ENGINE — Phase J                                     ║
 * ║                                                                      ║
 * ║  Manages the lifecycle of a purchase order (PO): draft → sent →     ║
 * ║  confirmed → received (partially or fully) → closed.                ║
 * ║                                                                      ║
 * ║  On "receive" (stock arrival), `ProductRepository.decrementStock`   ║
 * ║  runs in reverse — stock is ADDED back. This is the first place      ║
 * ║  anywhere in the codebase where stock can go UP, not just down.     ║
 * ║  Previously, stock could only decrease (on order) and had no        ║
 * ║  mechanism to be replenished except a manual admin edit.            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type { Supplier } from './SupplierRepository';

export type POStatus = 'draft' | 'sent' | 'confirmed' | 'partially_received' | 'received' | 'cancelled';

export interface POLineItem {
  productId: string;
  productName: string;
  sku?: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostPrice: number;     // the actual landed cost per unit for this PO
  currency: 'BDT' | 'USD';
}

export interface PurchaseOrder {
  id?: string;
  supplierId: string;
  supplierName: string;       // denormalized for display without a join
  lineItems: POLineItem[];
  status: POStatus;
  totalCost: number;
  currency: 'BDT' | 'USD';
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  notes?: string;
  createdBy: string;
  createdAt?: string;
  sentAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
}

export class PurchaseOrderEngine {

  /** Create a PO draft. Call send() to mark it sent to the supplier. */
  static async create(input: Omit<PurchaseOrder, 'status' | 'totalCost' | 'createdAt'>): Promise<string> {
    const { NexusDB } = await import('../database/NexusDB');
    const totalCost = input.lineItems.reduce((s, l) => s + l.unitCostPrice * l.quantityOrdered, 0);
    return NexusDB.add('purchase_orders', {
      ...input,
      status: 'draft' as POStatus,
      totalCost,
      createdAt: new Date().toISOString(),
      lineItems: input.lineItems.map(l => ({ ...l, quantityReceived: 0 })),
    });
  }

  /** Mark PO as sent to supplier (email/phone/WhatsApp done externally by the buyer). */
  static async markSent(poId: string): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.update('purchase_orders', poId, { status: 'sent', sentAt: new Date().toISOString() });
  }

  /** Supplier confirms the PO and gives an expected delivery date. */
  static async markConfirmed(poId: string, expectedDeliveryDate: string): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.update('purchase_orders', poId, { status: 'confirmed', expectedDeliveryDate });
  }

  /**
   * Receive stock from a PO (partial or full).
   * For each line item received, increments the product's stock in the
   * `products` collection via NexusDB — the first path anywhere in the
   * system where stock can increase, not just decrease.
   * Also auto-records the COGS as an expense in Phase K's ExpenseTracker
   * (cost of the received goods is a real operating cost).
   */
  static async receiveStock(poId: string, received: Array<{ productId: string; quantityReceived: number }>): Promise<{ success: boolean; newStockLevels: Record<string, number> }> {
    const { NexusDB } = await import('../database/NexusDB');
    const po = await NexusDB.get('purchase_orders', poId) as PurchaseOrder | null;
    if (!po) return { success: false, newStockLevels: {} };
    if (po.status === 'cancelled' || po.status === 'received') {
      return { success: false, newStockLevels: {} };
    }

    const newStockLevels: Record<string, number> = {};
    const updatedLineItems = [...po.lineItems];
    let totalReceivedCost = 0;

    for (const recv of received) {
      const lineIdx = updatedLineItems.findIndex(l => l.productId === recv.productId);
      if (lineIdx === -1) continue;

      const line = updatedLineItems[lineIdx];
      const qty = Math.min(recv.quantityReceived, line.quantityOrdered - line.quantityReceived);
      if (qty <= 0) continue;

      // Increment stock via NexusDB — first stock-UP path in the codebase
      const product = await NexusDB.get('products', recv.productId);
      if (product) {
        const newStock = (product.stock ?? 0) + qty;
        await NexusDB.update('products', recv.productId, { stock: newStock });
        newStockLevels[recv.productId] = newStock;
      }

      updatedLineItems[lineIdx] = { ...line, quantityReceived: line.quantityReceived + qty };
      totalReceivedCost += line.unitCostPrice * qty;
    }

    // Determine new PO status
    const allReceived = updatedLineItems.every(l => l.quantityReceived >= l.quantityOrdered);
    const anyReceived = updatedLineItems.some(l => l.quantityReceived > 0);
    const newStatus: POStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status;

    await NexusDB.update('purchase_orders', poId, {
      lineItems: updatedLineItems, status: newStatus,
      ...(allReceived ? { actualDeliveryDate: new Date().toISOString(), receivedAt: new Date().toISOString() } : {}),
    });

    // Phase K integration: auto-record COGS for received goods
    if (totalReceivedCost > 0) {
      try {
        const { ExpenseTracker } = await import('../finance/ExpenseTracker');
        await ExpenseTracker.record({
          category: 'cogs', amount: totalReceivedCost, currency: po.currency,
          description: `Stock received from PO ${poId} (${po.supplierName})`,
          vendor: po.supplierName, incurredAt: new Date().toISOString(),
          recordedBy: 'system',
        });
      } catch (e) {
        console.warn('[PurchaseOrderEngine] COGS recording failed (non-fatal):', e);
      }
    }

    return { success: true, newStockLevels };
  }

  static async cancel(poId: string, reason?: string): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.update('purchase_orders', poId, { status: 'cancelled', cancelledAt: new Date().toISOString(), notes: reason });
  }

  static async list(status?: POStatus, limit = 100): Promise<PurchaseOrder[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const where = status ? [{ field: 'status' as const, op: '==' as const, value: status }] : undefined;
    return NexusDB.find('purchase_orders', { where, orderBy: 'createdAt', orderDir: 'desc', limit }) as Promise<PurchaseOrder[]>;
  }

  static async getById(poId: string): Promise<PurchaseOrder | null> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.get('purchase_orders', poId) as Promise<PurchaseOrder | null>;
  }

  static async getBySupplier(supplierId: string): Promise<PurchaseOrder[]> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.find('purchase_orders', {
      where: [{ field: 'supplierId', op: '==', value: supplierId }],
      orderBy: 'createdAt', orderDir: 'desc', limit: 200,
    }) as Promise<PurchaseOrder[]>;
  }

  /** Summary stats for admin dashboard: open orders, overdue, total committed spend */
  static async getSummary(): Promise<{
    draft: number; sent: number; confirmed: number; partial: number;
    totalCommittedSpend: number; overdueCount: number;
  }> {
    const { NexusDB } = await import('../database/NexusDB');
    const open = await NexusDB.find('purchase_orders', {
      where: [{ field: 'status', op: 'not-in', value: ['received', 'cancelled'] }],
      limit: 1000,
    }) as PurchaseOrder[];

    const today = new Date().toISOString().slice(0, 10);
    return {
      draft: open.filter(p => p.status === 'draft').length,
      sent: open.filter(p => p.status === 'sent').length,
      confirmed: open.filter(p => p.status === 'confirmed').length,
      partial: open.filter(p => p.status === 'partially_received').length,
      totalCommittedSpend: open.reduce((s, p) => s + p.totalCost, 0),
      overdueCount: open.filter(p => p.expectedDeliveryDate && p.expectedDeliveryDate < today && p.status !== 'received').length,
    };
  }
}
