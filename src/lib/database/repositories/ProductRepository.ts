/**
 * PRODUCT REPOSITORY — Phase E
 * All product DB access through NexusDB.
 */
import { NexusDB } from '../NexusDB';

const COLLECTION = 'products';

export interface Product {
  id?: string;
  name: string;
  price: number;
  costPrice?: number;   // Phase K: cost of goods (wholesale/manufacturing cost) — used for gross margin calculation
  category: string;
  stock: number;
  // Phase J: procurement fields
  supplierId?: string;        // links to suppliers collection (who WE buy this from)
  sku?: string;               // supplier's stock-keeping unit identifier
  reorderPoint?: number;      // stock level that triggers a reorder notification
  leadTimeDays?: number;      // how many days this supplier takes to deliver (overrides supplier default)
  storeId?: string;           // links to micro_stores collection (which VENDOR sells this) — undefined = platform-owned product
  imageUrl?: string;
  description?: string;
  rating?: number;
  createdAt?: any;
  updatedAt?: any;
}

export class ProductRepository {
  static async findById(id: string): Promise<Product | null> {
    return NexusDB.get(COLLECTION, id) as Promise<Product | null>;
  }

  static async findAll(limit = 100): Promise<Product[]> {
    return NexusDB.find(COLLECTION, { limit }) as Promise<Product[]>;
  }

  static async findByCategory(category: string, limit = 50): Promise<Product[]> {
    return NexusDB.find(COLLECTION, {
      where: [{ field: 'category', op: '==', value: category }],
      limit,
    }) as Promise<Product[]>;
  }

  static async findByStore(storeId: string, limit = 200): Promise<Product[]> {
    return NexusDB.find(COLLECTION, {
      where: [{ field: 'storeId', op: '==', value: storeId }],
      limit,
    }) as Promise<Product[]>;
  }

  static async create(product: Product): Promise<string> {
    return NexusDB.add(COLLECTION, product);
  }

  static async update(id: string, data: Partial<Product>): Promise<void> {
    return NexusDB.update(COLLECTION, id, data);
  }

  static async delete(id: string): Promise<void> {
    return NexusDB.delete(COLLECTION, id);
  }

  static async decrementStock(id: string, qty: number): Promise<void> {
    const product = await this.findById(id);
    if (!product) throw new Error(`Product ${id} not found`);
    const newStock = Math.max(0, (product.stock ?? 0) - qty);
    await NexusDB.update(COLLECTION, id, { stock: newStock });

    // Phase J: check if this sale pushed stock to/below the reorder point,
    // and fire a real admin notification if so. Dynamic import avoids a
    // circular dependency (StockAlertEngine reads from products via NexusDB).
    try {
      const { StockAlertEngine } = await import('../../procurement/StockAlertEngine');
      await StockAlertEngine.checkAfterDecrement(id, newStock);
    } catch (e) {
      console.warn('[ProductRepository] Stock alert check failed (non-fatal):', e);
    }
  }
}
