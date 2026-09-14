/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║               NEXUS EVENT BUS (Foundation Layer)             ║
 * ║  Decoupled event-driven communication between all modules.   ║
 * ║  In-process now. Redis Streams / NATS in Phase 4.            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE PRINCIPLE:
 *   No module directly calls another module.
 *   All cross-module communication goes through the EventBus.
 *   This prevents tight coupling and enables async evolution.
 *
 * USAGE:
 *   // Publish
 *   EventBus.emit('order.created', { orderId, userId, amount });
 *
 *   // Subscribe
 *   EventBus.on('order.created', async (event) => {
 *     await NotificationEngine.notifyOrderPlaced(event.data.orderId, event.data.userId);
 *   });
 *
 *   // One-time
 *   EventBus.once('system.ready', () => console.log('System online'));
 */

import { logger } from '../logging/NexusLogger';
import { NexusConfig } from '../config/NexusConfig';

const log = logger.child('EventBus');

// ── Event type catalog (type-safe) ───────────────────────────────────────
export type NexusEventType =
  // Order lifecycle
  | 'order.created'
  | 'order.paid'
  | 'order.dispatched'
  | 'order.delivered'
  | 'order.cancelled'
  | 'order.refunded'
  // Rider
  | 'rider.assigned'
  | 'rider.location.updated'
  | 'rider.delivery.failed'
  // Customer
  | 'customer.registered'
  | 'customer.inactive'
  | 'customer.cart.abandoned'
  | 'customer.vip.promoted'
  // Inventory
  | 'product.low_stock'
  | 'product.out_of_stock'
  | 'product.restocked'
  // Security
  | 'fraud.detected'
  | 'fraud.blocked'
  | 'security.breach_attempt'
  | 'auth.login.failed'
  | 'auth.login.success'
  // AI / Agent
  | 'ai.request.started'
  | 'ai.request.completed'
  | 'ai.request.failed'
  | 'ai.provider.unhealthy'
  | 'agent.task.started'
  | 'agent.task.completed'
  | 'agent.task.failed'
  | 'agent.approval.required'
  // Memory
  | 'memory.written'
  | 'memory.evicted'
  | 'memory.corrupted'
  // System
  | 'system.ready'
  | 'system.shutdown'
  | 'system.health.degraded'
  | 'system.health.recovered'
  | 'system.config.changed'
  // Omnichannel
  | 'message.received'
  | 'message.sent'
  | 'message.failed'
  // Payments
  | 'payment.confirmed'
  | 'payment.failed'
  | 'payment.refunded'
  // Business intelligence
  | 'analytics.event'
  | 'campaign.triggered'
  // Wildcard for extensibility
  | string;

export interface NexusEvent<T = any> {
  id: string;
  type: NexusEventType;
  source: string;         // Module that emitted the event
  timestamp: number;
  data: T;
  meta?: {
    traceId?: string;
    userId?: string;
    sessionId?: string;
    retryCount?: number;
    correlationId?: string;
  };
}

export type EventHandler<T = any> = (event: NexusEvent<T>) => void | Promise<void>;

interface Subscription {
  id: string;
  type: NexusEventType;
  handler: EventHandler;
  once: boolean;
  source: string;         // Which module subscribed
}

// ── Dead Letter Queue (failed events) ────────────────────────────────────
interface DeadLetterEntry {
  event: NexusEvent;
  error: string;
  failedAt: number;
  retryCount: number;
}

// ── Event Bus implementation ──────────────────────────────────────────────
class NexusEventBusImpl {
  private subscriptions = new Map<NexusEventType, Subscription[]>();
  private history: NexusEvent[] = [];
  private deadLetterQueue: DeadLetterEntry[] = [];
  private maxHistory = 500;
  private maxDLQ = 200;
  private metrics = {
    emitted: 0,
    handled: 0,
    failed: 0,
    dlqSize: 0,
  };

  /** Subscribe to an event type */
  on<T = any>(type: NexusEventType, handler: EventHandler<T>, source = 'unknown'): string {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sub: Subscription = { id, type, handler: handler as EventHandler, once: false, source };

    if (!this.subscriptions.has(type)) this.subscriptions.set(type, []);
    this.subscriptions.get(type)!.push(sub);

    log.debug(`Subscribed: ${source} → ${type}`, { subscriptionId: id });
    return id;
  }

  /** Subscribe once — auto-removed after first trigger */
  once<T = any>(type: NexusEventType, handler: EventHandler<T>, source = 'unknown'): string {
    const id = `sub_once_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sub: Subscription = { id, type, handler: handler as EventHandler, once: true, source };

    if (!this.subscriptions.has(type)) this.subscriptions.set(type, []);
    this.subscriptions.get(type)!.push(sub);
    return id;
  }

  /** Unsubscribe by subscription ID */
  off(subscriptionId: string): boolean {
    for (const [type, subs] of this.subscriptions.entries()) {
      const idx = subs.findIndex(s => s.id === subscriptionId);
      if (idx !== -1) {
        subs.splice(idx, 1);
        if (subs.length === 0) this.subscriptions.delete(type);
        log.debug(`Unsubscribed: ${subscriptionId}`);
        return true;
      }
    }
    return false;
  }

  /** Emit an event — fires all matching handlers */
  async emit<T = any>(
    type: NexusEventType,
    data: T,
    source = 'system',
    meta?: NexusEvent['meta'],
  ): Promise<void> {
    const event: NexusEvent<T> = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      source,
      timestamp: Date.now(),
      data,
      meta,
    };

    this.metrics.emitted++;

    // Store in history
    this.history.unshift(event);
    if (this.history.length > this.maxHistory) this.history.pop();

    const subs = this.subscriptions.get(type) || [];
    const wildcardSubs = this.subscriptions.get('*') || [];
    const allSubs = [...subs, ...wildcardSubs];

    if (allSubs.length === 0) {
      log.debug(`Event emitted with no subscribers: ${type}`, { eventId: event.id });
      return;
    }

    log.debug(`Emitting: ${type}`, { eventId: event.id, source, subscribers: allSubs.length });

    // Execute all handlers
    const toRemove: string[] = [];
    for (const sub of allSubs) {
      try {
        await sub.handler(event);
        this.metrics.handled++;
        if (sub.once) toRemove.push(sub.id);
      } catch (err) {
        this.metrics.failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`Handler failed for ${type}`, err instanceof Error ? err : undefined, {
          subscriptionId: sub.id,
          source: sub.source,
          eventId: event.id,
        });

        // Add to DLQ
        this.deadLetterQueue.unshift({
          event,
          error: errorMsg,
          failedAt: Date.now(),
          retryCount: (event.meta?.retryCount ?? 0),
        });
        if (this.deadLetterQueue.length > this.maxDLQ) this.deadLetterQueue.pop();
        this.metrics.dlqSize = this.deadLetterQueue.length;
      }
    }

    // Cleanup once subscriptions
    for (const id of toRemove) this.off(id);
  }

  /** Fire-and-forget (non-blocking emit) */
  emitAsync<T = any>(type: NexusEventType, data: T, source = 'system', meta?: NexusEvent['meta']): void {
    this.emit(type, data, source, meta).catch(err => {
      log.error(`Async emit failed: ${type}`, err);
    });
  }

  /** Wait for an event (Promise-based) */
  waitFor<T = any>(type: NexusEventType, timeoutMs = 30000): Promise<NexusEvent<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(subId);
        reject(new Error(`EventBus.waitFor timeout: ${type} (${timeoutMs}ms)`));
      }, timeoutMs);

      const subId = this.once<T>(type, (event) => {
        clearTimeout(timer);
        resolve(event);
      }, 'waitFor');
    });
  }

  /** Retry failed events from DLQ */
  async retryDLQ(maxRetries = 3): Promise<{ retried: number; failed: number }> {
    const toRetry = this.deadLetterQueue.filter(e => e.retryCount < maxRetries);
    let retried = 0, failed = 0;

    for (const entry of toRetry) {
      try {
        const retryEvent = { ...entry.event, meta: { ...entry.event.meta, retryCount: entry.retryCount + 1 } };
        await this.emit(retryEvent.type, retryEvent.data, `${retryEvent.source}:retry`, retryEvent.meta);
        this.deadLetterQueue.splice(this.deadLetterQueue.indexOf(entry), 1);
        retried++;
      } catch (_) {
        entry.retryCount++;
        failed++;
      }
    }

    this.metrics.dlqSize = this.deadLetterQueue.length;
    return { retried, failed };
  }

  /** Get event history (for admin dashboard) */
  getHistory(limit = 50, typeFilter?: NexusEventType): NexusEvent[] {
    return this.history
      .filter(e => !typeFilter || e.type === typeFilter)
      .slice(0, limit);
  }

  /** Get DLQ entries */
  getDLQ(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }

  /** Get metrics */
  getMetrics() {
    return {
      ...this.metrics,
      subscriptions: Object.fromEntries(
        Array.from(this.subscriptions.entries()).map(([k, v]) => [k, v.length])
      ),
      historySize: this.history.length,
    };
  }

  /** List all active subscriptions */
  listSubscriptions(): Array<{ type: string; source: string; once: boolean }> {
    const result: Array<{ type: string; source: string; once: boolean }> = [];
    for (const [type, subs] of this.subscriptions.entries()) {
      for (const sub of subs) {
        result.push({ type, source: sub.source, once: sub.once });
      }
    }
    return result;
  }
}

/** Global EventBus singleton */
export const EventBus = new NexusEventBusImpl();

// ── Wire automation events on load ─────────────────────────────────────────
// These are wired at SystemBoot. Exported here for documentation.
export const STANDARD_EVENT_WIRING = `
  order.created       → NotificationEngine.notifyOrderPlaced
  order.paid          → NotificationEngine.notifyOrderPaid + OrderEngine.startFulfillment
  order.dispatched    → NotificationEngine.notifyOrderDispatched
  order.delivered     → NotificationEngine.notifyOrderDelivered + Analytics.recordDelivery
  fraud.detected      → NotificationEngine.notifyAdmin + OrderEngine.holdOrder
  customer.inactive   → AutomationEngine.sendWinback
  customer.cart.abandoned → AutomationEngine.sendAbandonedCartEmail
  product.low_stock   → NotificationEngine.notifyAdmin + SupplyChain.triggerReorder
  ai.provider.unhealthy → ProviderRegistry.reportFailure + SelfHealingEngine.repair
  agent.approval.required → NotificationEngine.notifyOwner
`;
