/**
 * OMNICHANNEL OS — Phase G
 * Central router for all social media / messaging platform integrations.
 *
 * Supported platforms (real implementations):
 *   - WhatsApp Business Cloud API
 *   - Facebook Messenger
 *   - Instagram DM
 *   - Telegram Bot
 *   - Discord Bot
 *   - TikTok Business Messaging
 *   - Email (SMTP + inbound webhook)
 *   - Web Chat (built-in)
 *
 * PLUGIN ARCHITECTURE — Adding a new platform requires ZERO changes here:
 *   1. Create src/lib/integrations/adapters/yourplatform.ts implementing IOmniConnector
 *   2. Register it in server.ts: OmniConnector.registerConnector(new YourAdapter())
 *   3. Add a webhook route: POST /api/webhooks/yourplatform
 *   4. Add env vars to .env
 *
 * NO CHANNEL-SPECIFIC BUSINESS LOGIC lives in this file. All routing,
 * identity resolution, memory, and persistence are channel-agnostic —
 * driven entirely by the IOmniConnector contract and UnifiedMessage shape.
 *
 * Phase G additions:
 *   - Message history persisted via MessageHistoryService (NexusDB) —
 *     replaces the old in-memory `messageLogs` (max 500, lost on restart)
 *   - Cross-channel customer identity via CustomerIdentityService —
 *     a customer on WhatsApp + Telegram + web app is ONE customer
 *   - Unified Conversation Timeline + Customer Journey View
 */

import { NexusUnifiedCore } from '../core/NexusUnifiedCore';

export type PlatformType =
  | 'whatsapp'
  | 'messenger'
  | 'instagram'
  | 'telegram'
  | 'discord'
  | 'tiktok'
  | 'email'
  | 'web'
  | string; // extensible for future platforms

export interface UnifiedMessage {
  id: string;
  platform: PlatformType;
  senderId: string;     // normalized: "wa_<phone>", "tg_<id>", "fb_<id>", etc.
  senderName: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface UnifiedOutboundMessage {
  to: string;           // same format as senderId
  content: string;
  platform: PlatformType;
  options?: Record<string, any>;
}

export interface IOmniConnector {
  platform: PlatformType;
  connect(credentials?: any): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(recipientId: string, content: string, options?: any): Promise<boolean>;
  onMessage(callback: (msg: UnifiedMessage) => void): void;
  handleWebhookPayload?(payload: any): Promise<void>;
}

/**
 * Message log entry for Admin → Omnichannel Hub
 */
export interface OmniMessageLog {
  id: string;
  platform: PlatformType;
  senderId: string;
  senderName: string;
  content: string;
  reply: string;
  timestamp: number;
  orderId?: string;      // if AI detected an order in this message
  intent?: string;       // e.g. "order_inquiry", "complaint", "new_order"
}

class OmniConnectorManager {
  private connectors = new Map<PlatformType, IOmniConnector>();
  /**
   * Phase G: in-memory log REMOVED as primary store. All message history is
   * now persisted via MessageHistoryService (NexusDB) — see
   * persistRoutedMessage(). This array is kept ONLY as a last-resort
   * fallback for getRecent()/getStats() if NexusDB is unreachable, capped tiny.
   */
  private fallbackLogs: OmniMessageLog[] = [];
  private readonly FALLBACK_CAP = 20;

  /** Register a platform connector. Call from server.ts at startup. */
  registerConnector(connector: IOmniConnector) {
    this.connectors.set(connector.platform, connector);
    connector.onMessage(this.routeToAI.bind(this));
    console.log(`[OmniHub] Registered: ${connector.platform}`);
  }

  getConnector(platform: PlatformType): IOmniConnector | undefined {
    return this.connectors.get(platform);
  }

  getRegisteredPlatforms(): PlatformType[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Route an inbound message from any platform through the AI brain and reply.
   * Phase G: resolves cross-channel customer identity FIRST, then injects
   * conversation context (Phase C) keyed by the canonical customerId so a
   * customer's history is shared across WhatsApp, Telegram, web, etc.
   */
  private async routeToAI(message: UnifiedMessage) {
    console.log(`[OmniHub] ${message.platform} | ${message.senderName}: ${message.content.slice(0, 80)}`);

    let reply = '';
    let intent = 'general';
    let customerId = message.senderId; // fallback if identity resolution fails

    try {
      // Phase G: resolve cross-channel identity
      const { CustomerIdentityService } = await import('../omnichannel/CustomerIdentityService');
      const identity = await CustomerIdentityService.resolve({
        platform: message.platform,
        channelId: message.senderId,
        displayName: message.senderName,
        phone: message.metadata?.phone,
        email: message.metadata?.email,
      });
      customerId = identity.customerId;
    } catch (e) {
      console.warn('[OmniHub] Identity resolution failed, using raw channelId:', e);
    }

    try {
      // Phase C: inject conversation context keyed by canonical customerId
      const { ConversationMemory } = await import('../memory/brain/ConversationMemory');
      const sessionId = `omni_${customerId}`;
      await ConversationMemory.getSession(sessionId, customerId, 'customer_support', message.platform);
      const convCtx = ConversationMemory.getContextString(sessionId, 6);

      const aiResponse = await NexusUnifiedCore.process(
        convCtx ? `${message.content}\n\n${convCtx}` : message.content,
        {
          userId: customerId,
          agentRole: 'customer_support',
          systemInstruction: `You are a helpful customer support assistant for a business. 
The customer is writing from ${message.platform}. 
Be concise, friendly, and helpful. Detect if they want to place an order, check order status, or ask about products.`,
        }
      );

      reply = aiResponse.text;

      // Append turns to shared conversation memory
      await ConversationMemory.appendTurn(sessionId, { role: 'user', content: message.content, timestamp: Date.now() });
      await ConversationMemory.appendTurn(sessionId, { role: 'assistant', content: reply, timestamp: Date.now(), modelUsed: aiResponse.modelName });

      // Basic intent detection
      const lower = message.content.toLowerCase();
      if (lower.includes('order') && (lower.includes('place') || lower.includes('buy') || lower.includes('want'))) {
        intent = 'new_order';
      } else if (lower.includes('order') && (lower.includes('status') || lower.includes('where') || lower.includes('track'))) {
        intent = 'order_inquiry';
      } else if (lower.includes('complaint') || lower.includes('problem') || lower.includes('issue') || lower.includes('wrong')) {
        intent = 'complaint';
      } else if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) {
        intent = 'price_inquiry';
      }

      // Send reply back through the same channel
      const adapter = this.connectors.get(message.platform);
      if (adapter) {
        await adapter.sendMessage(message.senderId, reply);
      }
    } catch (e) {
      console.error(`[OmniHub] AI routing failed for ${message.platform}:`, e);
      reply = 'Sorry, our support system is temporarily unavailable. Please try again shortly.';
      const adapter = this.connectors.get(message.platform);
      if (adapter) {
        await adapter.sendMessage(message.senderId, reply);
      }
    }

    // Phase G: persist to unified conversation timeline (NexusDB)
    await this.persistRoutedMessage(message, reply, intent, customerId);
  }

  /**
   * Phase G: Persist the inbound message + AI reply to MessageHistoryService
   * (NexusDB) under the canonical customerId. Falls back to a tiny in-memory
   * cache only if the write fails (e.g. DB unreachable at boot).
   */
  private async persistRoutedMessage(message: UnifiedMessage, reply: string, intent: string, customerId: string): Promise<void> {
    try {
      const { MessageHistoryService } = await import('../omnichannel/MessageHistoryService');
      await MessageHistoryService.recordExchange({
        customerId,
        platform: message.platform,
        channelId: message.senderId,
        senderName: message.senderName,
        inboundContent: message.content,
        outboundContent: reply,
        intent,
        orderId: message.metadata?.orderId,
      });
    } catch (e) {
      console.error('[OmniHub] Failed to persist message history, using fallback cache:', e);
      this.fallbackLogs.unshift({
        id: message.id || Date.now().toString(),
        platform: message.platform, senderId: message.senderId, senderName: message.senderName,
        content: message.content, reply, timestamp: message.timestamp, intent,
      });
      if (this.fallbackLogs.length > this.FALLBACK_CAP) this.fallbackLogs.pop();
    }
  }

  /**
   * Get message logs for Admin Omnichannel Hub dashboard.
   * Phase G: reads from persistent MessageHistoryService (NexusDB).
   */
  async getMessageLogs(limit = 50, platform?: PlatformType): Promise<OmniMessageLog[]> {
    try {
      const { MessageHistoryService } = await import('../omnichannel/MessageHistoryService');
      const records = await MessageHistoryService.getRecent(limit * 2, platform);
      const byCustomerTime = new Map<string, OmniMessageLog>();
      for (const r of records) {
        const key = `${r.customerId}_${r.timestamp}`;
        const existing = byCustomerTime.get(key) ?? {
          id: (r as any).id ?? key, platform: r.platform, senderId: r.channelId,
          senderName: r.senderName ?? r.customerId, content: '', reply: '',
          timestamp: new Date(r.timestamp).getTime(), intent: r.intent,
        };
        if (r.direction === 'inbound') existing.content = r.content;
        else existing.reply = r.content;
        byCustomerTime.set(key, existing);
      }
      const merged = Array.from(byCustomerTime.values()).sort((a,b) => b.timestamp - a.timestamp);
      return merged.slice(0, limit);
    } catch (e) {
      console.warn('[OmniHub] getMessageLogs falling back to in-memory cache:', e);
      let logs = this.fallbackLogs;
      if (platform) logs = logs.filter(l => l.platform === platform);
      return logs.slice(0, limit);
    }
  }

  /**
   * Get summary stats for dashboard.
   * Phase G: reads from persistent MessageHistoryService (NexusDB).
   */
  async getStats() {
    try {
      const { MessageHistoryService } = await import('../omnichannel/MessageHistoryService');
      const stats = await MessageHistoryService.getStats();
      return { ...stats, activePlatforms: this.getRegisteredPlatforms() };
    } catch (e) {
      console.warn('[OmniHub] getStats falling back to in-memory cache:', e);
      const platformCounts: Record<string, number> = {};
      const intentCounts: Record<string, number> = {};
      for (const log of this.fallbackLogs) {
        platformCounts[log.platform] = (platformCounts[log.platform] || 0) + 1;
        if (log.intent) intentCounts[log.intent] = (intentCounts[log.intent] || 0) + 1;
      }
      return {
        totalMessages: this.fallbackLogs.length,
        activePlatforms: this.getRegisteredPlatforms(),
        platformCounts, intentCounts,
        lastMessageAt: this.fallbackLogs[0]?.timestamp || null,
      };
    }
  }

  /** Send a manual message from admin to a specific user/platform */
  async sendManual(platform: PlatformType, userId: string, content: string, options?: any): Promise<boolean> {
    const adapter = this.connectors.get(platform);
    if (!adapter) {
      console.error(`[OmniHub] No adapter for platform: ${platform}`);
      return false;
    }
    return adapter.sendMessage(userId, content, options);
  }

  /** Broadcast a message to all active platforms (specific channel in each) */
  async broadcast(content: string, targetUserIds: Record<PlatformType, string>) {
    const results: Record<string, boolean> = {};
    for (const [platform, userId] of Object.entries(targetUserIds)) {
      results[platform] = await this.sendManual(platform as PlatformType, userId, content);
    }
    return results;
  }

  /**
   * Phase G: Admin test/dry-run entry point — pushes a synthetic message
   * through the EXACT SAME pipeline as a real webhook (identity resolution,
   * shared memory, AI, persistent history), without requiring a configured
   * external adapter for the platform. Used by the Omnichannel Hub's
   * "Live Pipeline Test" panel.
   *
   * If a real adapter IS registered for the platform, sendMessage() will
   * actually attempt to deliver the reply (adapters fall back to dry-run
   * logging when not configured, so this is always safe to call).
   */
  async processTestMessage(input: { platform: PlatformType; senderId: string; senderName?: string; content: string }): Promise<void> {
    await this.routeToAI({
      id: `test_${Date.now()}`,
      platform: input.platform,
      senderId: input.senderId,
      senderName: input.senderName ?? `Test User (${input.platform})`,
      content: input.content,
      timestamp: Date.now(),
    });
  }
}

export const OmniConnector = new OmniConnectorManager();
