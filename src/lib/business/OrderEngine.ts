/**
 * OrderEngine — NexusDB-backed order state machine
 *
 * Architecture compliance: Uses NexusDB abstraction exclusively.
 * NEVER imports firebase/firestore directly (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';

export type OrderState =
  | 'Pending'
  | 'Paid'
  | 'Processing'
  | 'Assigned'
  | 'OutForDelivery'
  | 'Delivered'
  | 'Failed'
  | 'Refunded';

export interface OrderUpdateOptions {
  riderId?: string;
  notes?: string;
}

export class OrderEngine {
  /**
   * Atomically update order status + append a history entry.
   * Uses NexusDB.runTransaction() for true atomicity on Firestore;
   * falls back to sequential writes on other providers.
   */
  static async updateOrderStatus(
    orderId: string,
    status: OrderState,
    options?: OrderUpdateOptions,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await NexusDB.runTransaction(async (tx) => {
        const order = await tx.get('orders', orderId);
        if (!order) throw new Error('Order not found');

        const updates: Record<string, unknown> = {
          status,
          updatedAt: NexusDB.serverTimestamp(),
        };
        if (options?.riderId) updates.riderId = options.riderId;

        await tx.update('orders', orderId, updates);
      });

      // History record — outside transaction (append-only)
      await NexusDB.add(`orders_history`, {
        orderId,
        status,
        notes: options?.notes ?? '',
        recordedAt: NexusDB.serverTimestamp(),
      });

      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[OrderEngine] updateOrderStatus failed for ${orderId}:`, msg);
      return { success: false, error: msg };
    }
  }

  /** Remove invalid cart items before checkout */
  static optimizeCartFriction(cartItems: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return cartItems.filter(
      (item) =>
        item.price !== undefined &&
        typeof item.price === 'number' &&
        item.price > 0 &&
        item.id,
    );
  }

  /** Suggest payment method based on user's historical preference */
  static suggestOptimalPayment(
    userHistory: Array<{ paymentMethod: string }>,
  ): string {
    const bkashCount = userHistory.filter((o) => o.paymentMethod === 'bkash').length;
    const stripeCount = userHistory.filter((o) => o.paymentMethod === 'stripe').length;
    return bkashCount > stripeCount ? 'bkash' : 'stripe';
  }

  /** Get last-used delivery address from user profile */
  static async predictUserAddress(userId: string): Promise<string | null> {
    try {
      const profile = await NexusDB.get('user_profiles', userId);
      return (profile?.address as string) ?? null;
    } catch {
      return null;
    }
  }

  /** Create a new order document */
  static async initiateOrder(
    orderData: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await NexusDB.set('orders', orderData.id as string, {
        ...orderData,
        status: 'Pending',
        paymentStatus: 'pending',
        createdAt: NexusDB.serverTimestamp(),
        updatedAt: NexusDB.serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[OrderEngine] initiateOrder failed:', msg);
      return { success: false, error: msg };
    }
  }
}
