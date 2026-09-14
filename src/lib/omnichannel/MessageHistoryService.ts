/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  MESSAGE HISTORY SERVICE — Phase G                                   ║
 * ║                                                                      ║
 * ║  Replaces OmniConnector's in-memory `messageLogs` (max 500,         ║
 * ║  lost on restart — flagged in original audit as critical gap).      ║
 * ║                                                                      ║
 * ║  Persists every inbound/outbound message to NexusDB                 ║
 * ║  (Phase E abstraction — works on any configured DB_PROVIDER).        ║
 * ║                                                                      ║
 * ║  Provides the Unified Conversation Timeline:                        ║
 * ║  all messages across all channels for one customer, in one          ║
 * ║  chronological feed — the foundation for the Customer Journey View.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type { PlatformType } from '../integrations/OmniConnector';

export interface OmniMessageRecord {
  id?: string;
  customerId: string;       // canonical ID from CustomerIdentityService
  platform: PlatformType;
  channelId: string;        // raw platform-specific sender ID
  direction: 'inbound' | 'outbound';
  content: string;
  senderName?: string;
  intent?: string;
  orderId?: string;
  timestamp: string;        // ISO
}

export class MessageHistoryService {

  /**
   * Persist a single message (inbound from customer, or outbound reply).
   */
  static async record(msg: OmniMessageRecord): Promise<string> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.add('omni_messages', { ...msg, timestamp: msg.timestamp ?? new Date().toISOString() });
  }

  /**
   * Persist an inbound message + its AI reply in one call (most common case).
   */
  static async recordExchange(input: {
    customerId: string; platform: PlatformType; channelId: string; senderName?: string;
    inboundContent: string; outboundContent: string; intent?: string; orderId?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.batch([
      { type: 'set', collection: 'omni_messages', id: `${input.customerId}_${Date.now()}_in`, data: {
        customerId: input.customerId, platform: input.platform, channelId: input.channelId,
        direction: 'inbound', content: input.inboundContent, senderName: input.senderName,
        intent: input.intent, orderId: input.orderId, timestamp: now,
      }},
      { type: 'set', collection: 'omni_messages', id: `${input.customerId}_${Date.now()}_out`, data: {
        customerId: input.customerId, platform: input.platform, channelId: input.channelId,
        direction: 'outbound', content: input.outboundContent, timestamp: now,
      }},
    ]);
  }

  /**
   * Unified Conversation Timeline — all messages across all channels
   * for one customer, chronologically ordered. This is the data source
   * for the Customer Journey View (admin dashboard).
   */
  static async getTimeline(customerId: string, limit = 100): Promise<OmniMessageRecord[]> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.find('omni_messages', {
      where: [{ field: 'customerId', op: '==', value: customerId }],
      orderBy: 'timestamp', orderDir: 'desc',
      limit,
    }) as Promise<OmniMessageRecord[]>;
  }

  /**
   * Recent messages across ALL customers/channels — for Admin Omnichannel Hub
   * live feed. Replaces OmniConnector.getMessageLogs().
   */
  static async getRecent(limit = 50, platform?: PlatformType): Promise<OmniMessageRecord[]> {
    const { NexusDB } = await import('../database/NexusDB');
    const where = platform ? [{ field: 'platform' as const, op: '==' as const, value: platform }] : undefined;
    return NexusDB.find('omni_messages', {
      where, orderBy: 'timestamp', orderDir: 'desc', limit,
    }) as Promise<OmniMessageRecord[]>;
  }

  /**
   * Stats for Admin dashboard — platform counts, intent counts, last activity.
   * Replaces OmniConnector.getStats().
   */
  static async getStats(): Promise<{
    totalMessages: number;
    platformCounts: Record<string, number>;
    intentCounts: Record<string, number>;
    lastMessageAt: string | null;
  }> {
    const { NexusDB } = await import('../database/NexusDB');
    const recent = await NexusDB.find('omni_messages', {
      orderBy: 'timestamp', orderDir: 'desc', limit: 1000,
    }) as OmniMessageRecord[];

    const platformCounts: Record<string, number> = {};
    const intentCounts: Record<string, number> = {};
    for (const m of recent) {
      platformCounts[m.platform] = (platformCounts[m.platform] ?? 0) + 1;
      if (m.intent) intentCounts[m.intent] = (intentCounts[m.intent] ?? 0) + 1;
    }

    return {
      totalMessages: recent.length,
      platformCounts,
      intentCounts,
      lastMessageAt: recent[0]?.timestamp ?? null,
    };
  }
}
