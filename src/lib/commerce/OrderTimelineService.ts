/**
 * OrderTimelineService — Order Status History & Customer Tracking
 *
 * WHY: Customers demand real-time updates.
 *      "Where is my order?" is the #1 support inquiry in e-commerce.
 *      Amazon/Daraz send email+SMS at every status change.
 *
 * vs World-class:
 *   Amazon: 7-stage timeline, proactive notifications, map tracking
 *   FedEx:  GPS tracking, delivery exceptions, rescheduling
 *   Daraz:  WhatsApp notifications at each stage
 *
 * Stages: placed → confirmed → processing → packed → dispatched
 *         → out_for_delivery → delivered (or cancelled/returned)
 */

import { NexusDB } from '../database/NexusDB';
import { EventBus } from '../core/events/NexusEventBus';
import { nexusWS } from '../realtime/NexusWebSocket';

export type OrderStatus =
  | 'placed'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'processing'
  | 'packed'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'return_requested'
  | 'return_in_transit'
  | 'refunded';

export interface TimelineEvent {
  status: OrderStatus;
  timestamp: string;
  description: string;
  location?: string;
  actor?: string;          // 'system' | 'vendor' | 'rider' | 'customer'
  riderName?: string;
  riderPhone?: string;
  eta?: string;            // ISO timestamp for expected delivery
  lat?: number;
  lng?: number;
  metadata?: Record<string, unknown>;
}

export interface OrderTimeline {
  orderId: string;
  currentStatus: OrderStatus;
  events: TimelineEvent[];
  estimatedDelivery?: string;
  actualDelivery?: string;
  deliveryAttempts: number;
  createdAt: string;
  updatedAt: string;
}

// Status descriptions (in Bangla + English)
const STATUS_DESCRIPTIONS: Record<OrderStatus, { en: string; bn: string }> = {
  placed:              { en: 'Order placed successfully',     bn: 'অর্ডার সফলভাবে দেওয়া হয়েছে' },
  payment_pending:     { en: 'Waiting for payment',          bn: 'পেমেন্টের অপেক্ষায়' },
  payment_confirmed:   { en: 'Payment confirmed',            bn: 'পেমেন্ট নিশ্চিত হয়েছে' },
  processing:          { en: 'Order is being prepared',      bn: 'অর্ডার প্রস্তুত হচ্ছে' },
  packed:              { en: 'Order packed and ready',        bn: 'প্যাক করা হয়েছে' },
  dispatched:          { en: 'Order dispatched for delivery', bn: 'ডেলিভারির জন্য পাঠানো হয়েছে' },
  out_for_delivery:    { en: 'Rider is on the way',          bn: 'রাইডার আসছেন' },
  delivered:           { en: 'Order delivered',              bn: 'ডেলিভারি সম্পন্ন' },
  cancelled:           { en: 'Order cancelled',              bn: 'অর্ডার বাতিল' },
  return_requested:    { en: 'Return requested',             bn: 'রিটার্নের অনুরোধ করা হয়েছে' },
  return_in_transit:   { en: 'Return in transit',            bn: 'রিটার্ন চলছে' },
  refunded:            { en: 'Refund processed',             bn: 'রিফান্ড সম্পন্ন' },
};

const TIMELINE_COL = 'order_timelines';

export class OrderTimelineService {

  // ── Initialize timeline when order is created ─────────────────────────

  static async initialize(orderId: string, estimatedDelivery?: string): Promise<void> {
    const timeline: OrderTimeline = {
      orderId,
      currentStatus: 'placed',
      events: [{
        status: 'placed',
        timestamp: new Date().toISOString(),
        description: STATUS_DESCRIPTIONS.placed.en,
        actor: 'system',
      }],
      estimatedDelivery,
      deliveryAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await NexusDB.set(TIMELINE_COL, orderId, timeline as unknown as Record<string, unknown>);
  }

  // ── Add status event ─────────────────────────────────────────────────────

  static async addEvent(
    orderId: string,
    status: OrderStatus,
    options: {
      description?: string;
      location?: string;
      actor?: string;
      riderName?: string;
      riderPhone?: string;
      eta?: string;
      lat?: number;
      lng?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<void> {
    const timeline = await NexusDB.get(TIMELINE_COL, orderId) as OrderTimeline | null;
    if (!timeline) {
      await this.initialize(orderId);
    }

    const event: TimelineEvent = {
      status,
      timestamp: new Date().toISOString(),
      description: options.description ?? STATUS_DESCRIPTIONS[status].en,
      location: options.location,
      actor: options.actor ?? 'system',
      riderName: options.riderName,
      riderPhone: options.riderPhone,
      eta: options.eta,
      lat: options.lat,
      lng: options.lng,
      metadata: options.metadata,
    };

    const updatedTimeline: OrderTimeline = timeline || {
      orderId,
      currentStatus: 'placed' as OrderStatus,
      events: [],
      deliveryAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const events = [...(updatedTimeline.events || []), event];

    const updates: Partial<OrderTimeline> = {
      currentStatus: status,
      events,
      updatedAt: new Date().toISOString(),
    };

    if (status === 'delivered') {
      updates.actualDelivery = event.timestamp;
    }
    if (status === 'out_for_delivery') {
      updates.deliveryAttempts = (updatedTimeline.deliveryAttempts || 0) + 1;
    }

    await NexusDB.update(TIMELINE_COL, orderId, updates as unknown as Record<string, unknown>);

    // Update main order status
    await NexusDB.update('orders', orderId, {
      status,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});

    // Push real-time update to customer
    nexusWS.pushOrderUpdate(orderId, {
      status,
      message: STATUS_DESCRIPTIONS[status].en,
      eta: options.eta ? (parseInt(options.eta, 10) || undefined) : undefined,
    });

    // Emit for notification sending
    EventBus.emit('order.status_changed', {
      orderId,
      status,
      previousStatus: updatedTimeline.currentStatus,
      event,
    });

    // Trigger CSAT after delivery
    if (status === 'delivered') {
      EventBus.emit('order.delivered', { orderId });
    }
  }

  // ── Get timeline ─────────────────────────────────────────────────────────

  static async get(orderId: string): Promise<OrderTimeline | null> {
    return NexusDB.get(TIMELINE_COL, orderId) as Promise<OrderTimeline | null>;
  }

  // ── Get user-facing tracking view ─────────────────────────────────────────

  static async getTrackingView(orderId: string): Promise<{
    currentStatus: OrderStatus;
    currentDescription: string;
    currentDescriptionBN: string;
    completedStages: OrderStatus[];
    estimatedDelivery?: string;
    rider?: { name?: string; phone?: string; lat?: number; lng?: number };
    timeline: Array<{ status: string; description: string; time: string; done: boolean }>;
  } | null> {
    const timeline = await this.get(orderId);
    if (!timeline) return null;

    const STAGES: OrderStatus[] = [
      'placed', 'payment_confirmed', 'processing', 'packed', 'dispatched', 'out_for_delivery', 'delivered'
    ];

    const currentStageIndex = STAGES.indexOf(timeline.currentStatus);
    const completedStages = STAGES.slice(0, currentStageIndex + 1);

    const lastRiderEvent = [...timeline.events]
      .reverse()
      .find(e => e.riderName);

    return {
      currentStatus: timeline.currentStatus,
      currentDescription: STATUS_DESCRIPTIONS[timeline.currentStatus]?.en ?? timeline.currentStatus,
      currentDescriptionBN: STATUS_DESCRIPTIONS[timeline.currentStatus]?.bn ?? timeline.currentStatus,
      completedStages,
      estimatedDelivery: timeline.estimatedDelivery,
      rider: lastRiderEvent ? {
        name: lastRiderEvent.riderName,
        phone: lastRiderEvent.riderPhone,
        lat: lastRiderEvent.lat,
        lng: lastRiderEvent.lng,
      } : undefined,
      timeline: STAGES.map(stage => {
        const event = timeline.events.find(e => e.status === stage);
        return {
          status: stage,
          description: STATUS_DESCRIPTIONS[stage]?.en ?? stage,
          time: event?.timestamp ?? '',
          done: completedStages.includes(stage),
        };
      }),
    };
  }
}
