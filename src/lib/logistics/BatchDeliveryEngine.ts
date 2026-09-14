/**
 * BatchDeliveryEngine — thin facade
 *
 * `delivery.routes.ts` was written against a module of this name that
 * never existed. The real, working implementation is `OrderBatchingEngine`
 * (src/lib/delivery/OrderBatchingEngine.ts) — this file exposes it under
 * the name/shape the route expects.
 *
 * HONEST GAP: the real engine batches by proximity to a pickup point
 * (pickupLat/pickupLng), not by an explicit list of order ids — that's how
 * it decides which nearby orders to combine. The route was written passing
 * `orderIds` instead. We bridge this by using the caller's pickupLat/
 * pickupLng if supplied, otherwise looking up the first order in the list
 * and batching around ITS pickup point — which approximates, but does not
 * guarantee, that every id in `orderIds` ends up in the resulting batch.
 * For exact-id batching, the real engine would need a new method — file an
 * issue with the delivery team if that guarantee is required.
 */
import { OrderBatchingEngine } from '../delivery/OrderBatchingEngine';
import type { OrderBatch } from '../delivery/DeliveryTypes';

export type { OrderBatch };

export class BatchDeliveryEngine {
  static async createBatch(
    orderIds: string[] = [],
    body: { pickupLat?: number; pickupLng?: number; maxOrders?: number } = {},
  ): Promise<OrderBatch | null> {
    let { pickupLat, pickupLng } = body;

    if (pickupLat == null || pickupLng == null) {
      const firstId = orderIds[0];
      if (!firstId) throw new Error('createBatch requires either pickupLat/pickupLng or a non-empty orderIds list');
      const { OrderRepository } = await import('../database/repositories/OrderRepository');
      const order = await OrderRepository.findById(firstId);
      if (!order?.pickupLat || !order?.pickupLng) {
        throw new Error(`Order ${firstId} has no pickup coordinates to batch around`);
      }
      pickupLat = order.pickupLat;
      pickupLng = order.pickupLng;
    }

    return OrderBatchingEngine.createBatch(pickupLat, pickupLng, body.maxOrders ?? (orderIds.length || undefined));
  }

  static async listActiveBatches(): Promise<OrderBatch[]> {
    return OrderBatchingEngine.getActiveBatches();
  }
}
