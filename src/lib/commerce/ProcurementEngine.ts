/**
 * ProcurementEngine — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed. The real, working implementation is split across
 * `SupplierRepository` and `PurchaseOrderEngine`
 * (src/lib/procurement/) — this file exposes both under the single name
 * and method set the route expects.
 *
 * NOTE on confirmPO / receivePO: the real engine needs more than just a PO
 * id for these transitions (an expectedDeliveryDate to confirm; the actual
 * received quantities to receive). admin.routes.ts now passes req.body
 * through as a third argument — see the corresponding route fix — so a
 * caller CAN supply that detail. If they don't, we fall back to a
 * reasonable default (supplier's default lead time; "received exactly what
 * was ordered") rather than failing the request, but real fulfilment data
 * should be sent whenever it's known.
 */
import { SupplierRepository, Supplier } from '../procurement/SupplierRepository';
import { PurchaseOrderEngine, PurchaseOrder, POStatus } from '../procurement/PurchaseOrderEngine';

export type { Supplier, PurchaseOrder, POStatus };

export class ProcurementEngine {
  // ── Suppliers ────────────────────────────────────────────────────────
  static async listSuppliers(query: { activeOnly?: string | boolean } = {}): Promise<Supplier[]> {
    const activeOnly = query.activeOnly === undefined ? true : query.activeOnly !== 'false' && query.activeOnly !== false;
    return SupplierRepository.findAll(activeOnly);
  }

  static async addSupplier(body: Omit<Supplier, 'createdAt' | 'updatedAt'>): Promise<{ id: string }> {
    const id = await SupplierRepository.create(body);
    return { id };
  }

  static async updateSupplier(id: string, body: Partial<Supplier>): Promise<{ success: true }> {
    await SupplierRepository.update(id, body);
    return { success: true };
  }

  static async getSupplierProducts(id: string) {
    return SupplierRepository.getProducts(id);
  }

  // ── Purchase orders ─────────────────────────────────────────────────
  static async createPO(
    body: Omit<PurchaseOrder, 'status' | 'totalCost' | 'createdAt' | 'createdBy'>,
    uid?: string,
  ): Promise<{ id: string }> {
    const id = await PurchaseOrderEngine.create({ ...body, createdBy: uid ?? 'admin' } as any);
    return { id };
  }

  static async listPOs(status?: POStatus): Promise<PurchaseOrder[]> {
    return PurchaseOrderEngine.list(status);
  }

  static async getPOSummary() {
    return PurchaseOrderEngine.getSummary();
  }

  static async getPO(id: string): Promise<PurchaseOrder | null> {
    return PurchaseOrderEngine.getById(id);
  }

  static async sendPO(id: string, _uid?: string, _body?: any) {
    await PurchaseOrderEngine.markSent(id);
    return { success: true };
  }

  static async confirmPO(id: string, _uid?: string, body?: { expectedDeliveryDate?: string }) {
    let expectedDeliveryDate = body?.expectedDeliveryDate;
    if (!expectedDeliveryDate) {
      const po = await PurchaseOrderEngine.getById(id);
      const supplier = po ? await SupplierRepository.findById(po.supplierId) : null;
      const leadDays = supplier?.defaultLeadTimeDays ?? 14;
      expectedDeliveryDate = new Date(Date.now() + leadDays * 86400000).toISOString().slice(0, 10);
    }
    await PurchaseOrderEngine.markConfirmed(id, expectedDeliveryDate);
    return { success: true, expectedDeliveryDate };
  }

  static async receivePO(id: string, _uid?: string, body?: { received?: Array<{ productId: string; quantityReceived: number }> }) {
    let received = body?.received;
    if (!received) {
      const po = await PurchaseOrderEngine.getById(id);
      received = (po?.lineItems ?? []).map(l => ({ productId: l.productId, quantityReceived: l.quantityOrdered }));
    }
    return PurchaseOrderEngine.receiveStock(id, received);
  }

  static async cancelPO(id: string, _uid?: string, body?: { reason?: string }) {
    await PurchaseOrderEngine.cancel(id, body?.reason);
    return { success: true };
  }
}
