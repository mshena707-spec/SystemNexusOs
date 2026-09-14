/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SUPPLIER REPOSITORY — Phase J                                       ║
 * ║                                                                      ║
 * ║  Manages supplier records — the master data layer for Phase J's     ║
 * ║  procurement OS. A supplier is any external party (manufacturer,    ║
 * ║  distributor, wholesaler) who provides products for resale.         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface Supplier {
  id?: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  defaultLeadTimeDays: number;    // how many days from PO to stock arrival
  defaultPaymentTermsDays: number; // net-30, net-60, etc.
  currency: 'BDT' | 'USD';
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export class SupplierRepository {

  static async findById(id: string): Promise<Supplier | null> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.get('suppliers', id) as Promise<Supplier | null>;
  }

  static async findAll(activeOnly = true): Promise<Supplier[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const where = activeOnly ? [{ field: 'active' as const, op: '==' as const, value: true }] : undefined;
    return NexusDB.find('suppliers', { where, orderBy: 'name', orderDir: 'asc', limit: 500 }) as Promise<Supplier[]>;
  }

  static async create(supplier: Omit<Supplier, 'createdAt' | 'updatedAt'>): Promise<string> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.add('suppliers', { ...supplier, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  static async update(id: string, data: Partial<Supplier>): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.update('suppliers', id, { ...data, updatedAt: new Date().toISOString() });
  }

  static async deactivate(id: string): Promise<void> {
    return this.update(id, { active: false });
  }

  /** Get all products supplied by a given supplier — via the Product model's supplierId field. */
  static async getProducts(supplierId: string): Promise<any[]> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.find('products', { where: [{ field: 'supplierId', op: '==', value: supplierId }], limit: 500 });
  }
}
