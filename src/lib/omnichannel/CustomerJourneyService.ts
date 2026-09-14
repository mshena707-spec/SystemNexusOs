/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CUSTOMER JOURNEY SERVICE — Phase G                                  ║
 * ║                                                                      ║
 * ║  Aggregates a 360° view of one customer:                             ║
 * ║   - Identity (all linked channels)                                   ║
 * ║   - Conversation timeline (all platforms, chronological)             ║
 * ║   - Order history                                                    ║
 * ║   - Preferences (from Phase C ConversationMemory)                    ║
 * ║   - Payment history (from Phase F)                                   ║
 * ║                                                                      ║
 * ║  This is the data source for Admin → Omnichannel Hub →               ║
 * ║  "Customer Journey View" tab.                                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { CustomerIdentityService, type CustomerIdentity } from './CustomerIdentityService';
import { MessageHistoryService, type OmniMessageRecord } from './MessageHistoryService';

export interface JourneyEvent {
  type: 'message' | 'order' | 'payment' | 'preference';
  timestamp: string;
  platform?: string;
  summary: string;
  detail?: Record<string, any>;
}

export interface CustomerJourney {
  identity: CustomerIdentity;
  timeline: JourneyEvent[];
  orderCount: number;
  totalSpend: number;
  preferences: Record<string, string>;
}

export class CustomerJourneyService {

  /**
   * Build a full 360° journey for one customer, merging messages, orders,
   * payments, and preferences into a single chronological timeline.
   */
  static async getJourney(customerId: string): Promise<CustomerJourney | null> {
    const identity = await CustomerIdentityService.getById(customerId);
    if (!identity) return null;

    const { NexusDB } = await import('../database/NexusDB');
    const { ConversationMemory } = await import('../memory/brain/ConversationMemory');

    const [messages, orders, prefs] = await Promise.all([
      MessageHistoryService.getTimeline(customerId, 200),
      NexusDB.find('orders', { where: [{ field: 'userId', op: '==', value: customerId }], orderBy: 'createdAt', orderDir: 'desc', limit: 50 }),
      ConversationMemory.getPreferences(customerId),
    ]);

    const events: JourneyEvent[] = [];

    for (const m of messages) {
      events.push({
        type: 'message',
        timestamp: m.timestamp,
        platform: m.platform,
        summary: m.direction === 'inbound'
          ? `Customer (${m.platform}): ${m.content.slice(0, 100)}`
          : `Reply (${m.platform}): ${m.content.slice(0, 100)}`,
        detail: { intent: m.intent, orderId: m.orderId, direction: m.direction },
      });
    }

    let totalSpend = 0;
    for (const o of orders) {
      totalSpend += o.total ?? 0;
      events.push({
        type: 'order',
        timestamp: o.createdAt ?? '',
        summary: `Order #${(o.id ?? '').slice(0,8)} — ${o.status} — ${o.total ?? 0} ${o.currency ?? 'BDT'}`,
        detail: { orderId: o.id, status: o.status, total: o.total },
      });
    }

    // Payments
    const payments = await NexusDB.find('payments', { where: [{ field: 'orderId', op: 'in', value: orders.map((o:any)=>o.id).slice(0,30) || [''] }], limit: 50 }).catch(() => []);
    for (const p of payments) {
      events.push({
        type: 'payment',
        timestamp: p.verifiedAt ?? p.createdAt ?? '',
        summary: `Payment via ${p.provider} — ${p.status} — ${p.amount} ${p.currency}`,
        detail: { provider: p.provider, status: p.status, amount: p.amount },
      });
    }

    // Preferences as a single summary event at the start (not timestamped to timeline order)
    const preferenceMap: Record<string, string> = {};
    for (const p of prefs) preferenceMap[p.key] = p.value;

    // Sort chronologically (newest first)
    events.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));

    return {
      identity,
      timeline: events,
      orderCount: orders.length,
      totalSpend: Math.round(totalSpend * 100) / 100,
      preferences: preferenceMap,
    };
  }

  /**
   * Search for a customer journey by phone, email, or any channel ID.
   * Used by admin search bar.
   */
  static async search(query: string): Promise<CustomerIdentity[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const all = await NexusDB.find('customer_identities', { limit: 1000 }) as CustomerIdentity[];
    const q = query.toLowerCase().trim();

    return all.filter(c =>
      c.customerId.toLowerCase().includes(q) ||
      c.primaryPhone?.includes(q) ||
      c.primaryEmail?.toLowerCase().includes(q) ||
      c.displayName?.toLowerCase().includes(q) ||
      c.channels?.some(ch => ch.channelId.toLowerCase().includes(q) || ch.displayName?.toLowerCase().includes(q))
    ).slice(0, 20);
  }
}
