/**
 * ORDER REPOSITORY — Phase E
 * All order DB access through NexusDB. Zero Firestore imports.
 */
import { NexusDB, type FindOptions } from '../NexusDB';

const COLLECTION = 'orders';

export interface Order {
  id?: string;
  userId: string;
  riderId?: string;
  items: any[];
  total: number;
  status: string;
  paymentStatus?: 'pending' | 'success' | 'failed' | 'refunded'; // written by PaymentRoutes & PaymentRegistry
  deliveryAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
  paymentMethod?: string;
  stripeSessionId?: string;
  batchId?: string;
  slaMinutes?: number;
  storeIds?: string[];  // distinct vendor micro_stores represented among this order's items (a cart can mix stores)
  createdAt?: any;
  updatedAt?: any;
  assignedAt?: any;
  deliveredAt?: any;
}

export class OrderRepository {
  /** Human-readable order id for display/preview purposes (not the NexusDB document id). */
  static generateOrderId(): string {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ORD-${datePart}-${randPart}`;
  }

  static async findById(id: string): Promise<Order | null> {
    return NexusDB.get(COLLECTION, id) as Promise<Order | null>;
  }

  static async findByUser(userId: string, opts?: { limit?: number; status?: string }): Promise<Order[]> {
    const where: FindOptions['where'] = [{ field: 'userId', op: '==', value: userId }];
    if (opts?.status) where.push({ field: 'status', op: '==', value: opts.status });
    return NexusDB.find(COLLECTION, {
      where,
      orderBy: 'createdAt',
      orderDir: 'desc',
      limit: opts?.limit ?? 20,
    }) as Promise<Order[]>;
  }

  static async findByRider(riderId: string, status?: string): Promise<Order[]> {
    const where: FindOptions['where'] = [{ field: 'riderId', op: '==', value: riderId }];
    if (status) where.push({ field: 'status', op: '==', value: status });
    return NexusDB.find(COLLECTION, { where, orderBy: 'assignedAt', orderDir: 'desc', limit: 50 }) as Promise<Order[]>;
  }

  static async findByStore(storeId: string, limit = 100): Promise<Order[]> {
    return NexusDB.find(COLLECTION, {
      where: [{ field: 'storeIds', op: 'array-contains', value: storeId }],
      orderBy: 'createdAt',
      orderDir: 'desc',
      limit,
    }) as Promise<Order[]>;
  }

  static async findPending(limit = 20): Promise<Order[]> {
    return NexusDB.find(COLLECTION, {
      where: [{ field: 'status', op: 'in', value: ['Pending', 'Confirmed'] }],
      orderBy: 'createdAt',
      orderDir: 'asc',
      limit,
    }) as Promise<Order[]>;
  }

  static async findUnassigned(limit = 20): Promise<Order[]> {
    return NexusDB.find(COLLECTION, {
      where: [{ field: 'status', op: '==', value: 'Confirmed' }],
      orderBy: 'createdAt',
      orderDir: 'asc',
      limit,
    }) as Promise<Order[]>;
  }

  static async findRecent(limit = 100): Promise<Order[]> {
    return NexusDB.find(COLLECTION, {
      orderBy: 'createdAt',
      orderDir: 'desc',
      limit,
    }) as Promise<Order[]>;
  }

  static async create(order: Order): Promise<string> {
    return NexusDB.add(COLLECTION, order);
  }

  static async update(id: string, data: Partial<Order>): Promise<void> {
    return NexusDB.update(COLLECTION, id, data);
  }

  static async updateStatus(id: string, status: string, extra?: Partial<Order>): Promise<void> {
    return NexusDB.update(COLLECTION, id, { status, ...(extra ?? {}) });
  }

  static async assignRider(orderId: string, riderId: string): Promise<void> {
    return NexusDB.update(COLLECTION, orderId, { riderId, status: 'Assigned' });
  }

  static async batchUpdateStatus(orderIds: string[], status: string): Promise<void> {
    await NexusDB.batch(orderIds.map(id => ({
      type: 'update' as const,
      collection: COLLECTION,
      id,
      data: { status },
    })));
  }
}
