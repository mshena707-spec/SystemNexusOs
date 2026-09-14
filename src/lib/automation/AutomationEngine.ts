/**
 * AUTOMATION ENGINE — Real event-driven automation
 * Wire business events to notifications, AI responses, and data updates.
 *
 * Usage: AutomationEngine.triggerEvent('order.created', { orderId, userId, items })
 */

import { NotificationEngine } from '../notifications/NotificationEngine';
import { NexusUnifiedCore } from '../core/NexusUnifiedCore';

export type AutomationEvent =
  | 'order.created'
  | 'order.paid'
  | 'order.dispatched'
  | 'order.delivered'
  | 'order.cancelled'
  | 'delivery.failed'
  | 'customer.inactive'
  | 'cart.abandoned'
  | 'low.stock'
  | 'fraud.detected'
  | 'rider.assigned'
  | string; // allow custom events from owner-defined workflows

export type WorkflowHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface WorkflowDefinition {
  id:          string;
  eventName:   string;
  name:        string;
  description: string;
  enabled:     boolean;
  handler:     WorkflowHandler;
  /** Run AFTER the built-in handler (true) or INSTEAD of it (false). Default: true */
  additive:    boolean;
}

export class AutomationEngine {

  // ── Custom workflow registry ──────────────────────────────────────────────
  // Owner/developer registers custom workflows here. They run alongside
  // (or instead of) the built-in handlers.
  private static _customWorkflows = new Map<string, WorkflowDefinition[]>();

  /**
   * Register a custom workflow that fires on a named event.
   *
   * @example
   * // Send a custom WhatsApp message on every delivered order
   * AutomationEngine.registerWorkflow({
   *   id:          'whatsapp_delivery_confirm',
   *   eventName:   'order.delivered',
   *   name:        'WhatsApp delivery confirmation',
   *   description: 'Send WhatsApp message via third-party API on delivery',
   *   enabled:     true,
   *   additive:    true,   // runs AFTER the built-in handler
   *   handler: async (payload) => {
   *     await WhatsAppClient.send(payload.userId, `Your order is delivered!`);
   *   },
   * });
   */
  static registerWorkflow(def: WorkflowDefinition): void {
    const existing = this._customWorkflows.get(def.eventName) ?? [];
    existing.push(def);
    this._customWorkflows.set(def.eventName, existing);
    console.log(`[AutomationEngine] Workflow registered: ${def.id} for event ${def.eventName}`);
  }

  static unregisterWorkflow(workflowId: string): void {
    for (const [event, defs] of this._customWorkflows) {
      this._customWorkflows.set(event, defs.filter(d => d.id !== workflowId));
    }
  }

  static listWorkflows(): WorkflowDefinition[] {
    const all: WorkflowDefinition[] = [];
    for (const defs of this._customWorkflows.values()) all.push(...defs);
    return all;
  }

  // ── Event dispatch ────────────────────────────────────────────────────────

  static async triggerEvent(eventName: AutomationEvent, payload: any): Promise<void> {
    console.log(`[AutomationEngine] Event: ${eventName}`, payload);

    // Run custom non-additive workflows first (they replace built-in)
    const customWorkflows = (this._customWorkflows.get(eventName) ?? []).filter(w => w.enabled);
    const replacements    = customWorkflows.filter(w => !w.additive);

    if (replacements.length > 0) {
      // Custom non-additive workflows replace built-in entirely
      for (const wf of replacements) {
        try { await wf.handler(payload); }
        catch (e) { console.error(`[AutomationEngine][${wf.id}] failed:`, e); }
      }
    } else {
      // Run built-in handler
      try {
        await this._runBuiltInHandler(eventName, payload);
      } catch (e) {
        console.error(`[AutomationEngine] Built-in handler failed for ${eventName}:`, e);
      }
    }

    // Always run additive custom workflows
    for (const wf of customWorkflows.filter(w => w.additive)) {
      try { await wf.handler(payload); }
      catch (e) { console.error(`[AutomationEngine][${wf.id}] failed:`, e); }
    }
  }

  private static async _runBuiltInHandler(eventName: string, payload: any): Promise<void> {
    switch (eventName) {
      case 'order.created':     await this.handleOrderCreated(payload);     break;
      case 'order.paid':        await this.handleOrderPaid(payload);        break;
      case 'order.dispatched':  await this.handleOrderDispatched(payload);  break;
      case 'order.delivered':   await this.handleOrderDelivered(payload);   break;
      case 'delivery.failed':   await this.handleDeliveryFailed(payload);   break;
      case 'customer.inactive': await this.handleInactiveCustomer(payload); break;
      case 'cart.abandoned':    await this.handleAbandonedCart(payload);    break;
      case 'low.stock':         await this.handleLowStock(payload);         break;
      case 'fraud.detected':    await this.handleFraudDetected(payload);    break;
      case 'rider.assigned':    await this.handleRiderAssigned(payload);    break;
      default:
        console.warn(`[AutomationEngine] No built-in handler for event: ${eventName}`);
    }
  }

  private static async handleOrderCreated(payload: { orderId: string; userId: string; totalAmount: number }) {
    await NotificationEngine.notifyOrderPlaced(payload.orderId, payload.userId);

    await NotificationEngine.saveInApp(
      'admin', '🛒 New Order',
      `Order #${payload.orderId.slice(0, 8)} placed — $${payload.totalAmount.toFixed(2)}`,
      `/admin/orders/${payload.orderId}`
    );

    // Phase W: attempt smart multi-factor auto-assignment
    // Reads pickupLat/Lng from the order document in Firestore; silently skips
    // if coordinates are missing (manual dispatch via admin panel covers these).
    try {
      const { db } = await import('../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      const orderSnap = await getDoc(doc(db, 'orders', payload.orderId));
      const order = orderSnap.data();
      if (order?.pickupLat != null && order?.pickupLng != null) {
        const { SmartRiderAssignmentEngine } = await import('../logistics/SmartRiderAssignmentEngine');
        const result = await SmartRiderAssignmentEngine.assignOrder(
          payload.orderId, order.pickupLat, order.pickupLng, 'system_auto',
        );
        if (result.success && result.riderId) {
          await NotificationEngine.saveInApp(
            'admin', '🏍️ Rider Auto-Assigned',
            `Rider ${result.riderId.slice(0, 8)} assigned to order #${payload.orderId.slice(0, 8)} (${result.method}, ETA ${result.estimatedPickupMinutes ?? '?'} min)`,
            `/admin/orders/${payload.orderId}`
          );
        }
      }
    } catch (e) {
      console.warn('[AutomationEngine] Smart auto-assignment failed for order', payload.orderId, e);
    }
  }


  private static async handleOrderPaid(payload: { orderId: string; userId: string }) {
    await NotificationEngine.notifyOrderPaid(payload.orderId, payload.userId);
  }

  private static async handleOrderDispatched(payload: {
    orderId: string; userId: string; riderName: string; phone?: string;
  }) {
    await NotificationEngine.notifyOrderDispatched(
      payload.orderId, payload.userId, payload.riderName, payload.phone
    );
  }

  private static async handleOrderDelivered(payload: { orderId: string; userId: string }) {
    await NotificationEngine.notifyOrderDelivered(payload.orderId, payload.userId);
  }

  private static async handleDeliveryFailed(payload: {
    orderId: string; userId: string; riderId: string; reason: string;
  }) {
    // Notify customer
    await NotificationEngine.notify({
      userId: payload.userId,
      title: '⚠️ Delivery Attempted',
      message: `We tried to deliver order #${payload.orderId.slice(0, 8)} but couldn't complete it. We'll try again soon.`,
      channels: ['push', 'in_app'],
      link: `/orders/${payload.orderId}`,
    });

    // Notify admin
    await NotificationEngine.saveInApp(
      'admin', '❌ Delivery Failed',
      `Order #${payload.orderId.slice(0, 8)}: ${payload.reason}`,
      `/admin/orders/${payload.orderId}`
    );
  }

  private static async handleInactiveCustomer(payload: { userId: string; name: string; daysSinceVisit: number }) {
    try {
      const prompt = `User "${payload.name}" hasn't visited in ${payload.daysSinceVisit} days. Write a very short, friendly welcome-back push notification (max 20 words). Offer a discount code COMEBACK5 for 5% off.`;
      const aiResp = await NexusUnifiedCore.process(prompt, { agentRole: 'marketing_agent' });

      await NotificationEngine.notify({
        userId: payload.userId,
        title: '👋 We miss you!',
        message: aiResp.text || `Come back & save 5% with code COMEBACK5!`,
        channels: ['push', 'in_app'],
        link: '/store/global',
      });
    } catch (e) {
      console.error('[AutomationEngine] Inactive customer notification failed:', e);
    }
  }

  private static async handleAbandonedCart(payload: {
    userId: string; cartTotal: number; cartId: string;
  }) {
    try {
      // Phase R: replaced hardcoded "SAVE10" coupon reference (which didn't exist
      // in any coupon system) with real AbandonedCartRecoveryEngine — issues a
      // genuine CouponEngine coupon or LoyaltyEngine bonus based on customer tier.
      const { AbandonedCartRecoveryEngine } = await import('../marketing/AbandonedCartRecoveryEngine');
      await AbandonedCartRecoveryEngine.recover(payload);
    } catch (e) {
      console.error('[AutomationEngine] Abandoned cart recovery failed:', e);
    }
  }

  private static async handleLowStock(payload: { productId: string; productName: string; stockLeft: number }) {
    await NotificationEngine.saveInApp(
      'admin',
      '⚠️ Low Stock Alert',
      `"${payload.productName}" has only ${payload.stockLeft} units left.`,
      `/admin/products/${payload.productId}`
    );
  }

  private static async handleFraudDetected(payload: { orderId: string; userId: string; reason: string }) {
    await NotificationEngine.saveInApp(
      'admin',
      '🚨 Fraud Alert',
      `Order #${payload.orderId.slice(0, 8)} flagged: ${payload.reason}`,
      `/admin/orders/${payload.orderId}`
    );
  }

  private static async handleRiderAssigned(payload: {
    orderId: string; riderId: string; riderName: string; userId: string;
  }) {
    await NotificationEngine.notify({
      userId: payload.userId,
      title: '🚴 Rider Assigned',
      message: `${payload.riderName} has been assigned to your order #${payload.orderId.slice(0, 8)}.`,
      channels: ['push', 'in_app'],
      link: `/orders/${payload.orderId}/track`,
    });
  }

  // ─── Scheduled Jobs (called by node-cron in server.ts) ───────────────────
  static async runDailyJobs(): Promise<void> {
    console.log('[AutomationEngine] Running daily automation jobs...');

    try {
      // 1. Inactive customer sweep (7+ days)
      const { db } = await import('../../firebase');
      const { collection, query, where, getDocs } = await import('firebase/firestore');

      const threshold = new Date();
      threshold.setDate(threshold.getDate() - 7);

      const q = query(collection(db, 'user_profiles'), where('lastLogin', '<', threshold));
      const snap = await getDocs(q);

      for (const userDoc of snap.docs) {
        const data = userDoc.data();
        await this.triggerEvent('customer.inactive', {
          userId: userDoc.id,
          name: data.displayName || 'friend',
          daysSinceVisit: 7,
        });
      }

      // 2. Low stock check
      const productsSnap = await getDocs(
        query(collection(db, 'products'), where('stock', '<', 5))
      );
      for (const prodDoc of productsSnap.docs) {
        const d = prodDoc.data();
        await this.triggerEvent('low.stock', {
          productId: prodDoc.id, productName: d.name, stockLeft: d.stock,
        });
      }

      // 3. Abandoned carts (older than 2 hours, still not converted)
      const cartThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const cartsSnap = await getDocs(
        query(collection(db, 'carts'), where('status', '==', 'active'), where('updatedAt', '<', cartThreshold))
      );
      for (const cartDoc of cartsSnap.docs) {
        const d = cartDoc.data();
        await this.triggerEvent('cart.abandoned', {
          userId: d.userId, cartTotal: d.total, cartId: cartDoc.id,
        });
        // Mark cart as 'abandoned' so we don't re-trigger
        const { doc, updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'carts', cartDoc.id), { status: 'abandoned' });
      }

      console.log('[AutomationEngine] Daily jobs complete.');
    } catch (e) {
      console.error('[AutomationEngine] Daily job error:', e);
    }
  }
}
