/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  DELIVERY TIMELINE — Phase B                                ║
 * ║                                                             ║
 * ║  Immutable event log for every order's delivery lifecycle.  ║
 * ║  Appended on every status change. Never modified.           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import type { OrderDeliveryStatus, DeliveryTimelineEvent, DeliveryTimeline, GpsPoint } from './DeliveryTypes';

export class DeliveryTimelineService {
  /**
   * Append a new event to an order's timeline.
   * Called any time order status changes.
   */
  static async appendEvent(
    orderId: string,
    status: OrderDeliveryStatus,
    options: {
      note?: string;
      coord?: GpsPoint;
      riderId?: string;
    } = {}
  ): Promise<void> {
    const { db } = await import('../../firebase');
    const { collection, addDoc, doc, updateDoc, serverTimestamp } = await import('firebase/firestore');

    const event: Record<string, any> = {
      orderId,
      status,
      timestamp: serverTimestamp(),
      note: options.note ?? null,
      riderId: options.riderId ?? null,
    };
    if (options.coord) {
      event.lat = options.coord.lat;
      event.lng = options.coord.lng;
    }

    // Append to timeline sub-collection
    await addDoc(collection(db, 'delivery_timeline'), event);

    // Also update the order's top-level status + timestamp
    const orderUpdate: Record<string, any> = {
      status,
      updatedAt: serverTimestamp(),
    };
    if (status === 'Assigned')        orderUpdate.assignedAt     = serverTimestamp();
    if (status === 'PickedUp')        orderUpdate.pickedUpAt     = serverTimestamp();
    if (status === 'InTransit')       orderUpdate.inTransitAt    = serverTimestamp();
    if (status === 'NearDestination') orderUpdate.nearDestAt     = serverTimestamp();
    if (status === 'Delivered')       orderUpdate.deliveredAt    = serverTimestamp();
    if (status === 'Failed')          orderUpdate.failedAt       = serverTimestamp();
    if (options.riderId)              orderUpdate.riderId        = options.riderId;

    await updateDoc(doc(db, 'orders', orderId), orderUpdate);
  }

  /**
   * Fetch full timeline for an order (ordered chronologically).
   */
  static async getTimeline(orderId: string): Promise<DeliveryTimeline> {
    const { db } = await import('../../firebase');
    const { collection, query, where, orderBy, getDocs } = await import('firebase/firestore');

    const q = query(
      collection(db, 'delivery_timeline'),
      where('orderId', '==', orderId),
      orderBy('timestamp', 'asc')
    );
    const snap = await getDocs(q);

    const events: DeliveryTimelineEvent[] = snap.docs.map(d => {
      const data = d.data();
      return {
        status: data.status,
        timestamp: data.timestamp?.toDate?.() ?? new Date(),
        note: data.note ?? undefined,
        lat: data.lat ?? undefined,
        lng: data.lng ?? undefined,
        riderId: data.riderId ?? undefined,
      };
    });

    return { orderId, events };
  }

  /**
   * Compute elapsed minutes between two status events.
   */
  static getElapsedMinutes(timeline: DeliveryTimeline, from: OrderDeliveryStatus, to: OrderDeliveryStatus): number | null {
    const fromEvent = timeline.events.find(e => e.status === from);
    const toEvent   = timeline.events.find(e => e.status === to);
    if (!fromEvent || !toEvent) return null;
    return (toEvent.timestamp.getTime() - fromEvent.timestamp.getTime()) / 60_000;
  }
}
