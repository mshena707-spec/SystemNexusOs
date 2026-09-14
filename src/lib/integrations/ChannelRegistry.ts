/**
 * ChannelRegistry — Extensible Social Media Plugin System
 *
 * PLUGIN ARCHITECTURE — How to add any new social platform (now or future):
 *
 *   1. Create: src/lib/integrations/adapters/yourplatform.ts
 *   2. Implement: IOmniConnector interface
 *   3. Register: ChannelRegistry.register(new YourAdapter(), features)
 *   4. Add webhook: POST /api/webhooks/yourplatform in server.ts
 *   5. Add ENV vars, toggle in FeatureContext
 *   DONE — zero changes to business logic, AI pipeline, or customer identity
 *
 * Supports:
 *   Inbound:  Customer messages → AI/human agent response
 *   Outbound: Campaigns, notifications, CSAT requests → to customers
 *   Handoff:  AI → Human agent (RepDashboard)
 *
 * Current platforms: WhatsApp, Messenger, Instagram, Telegram, Discord,
 *                    TikTok, Email, Web Chat
 * Future: LinkedIn, Viber, WeChat, Signal, Line, Slack, Twitter/X, etc.
 */

import { OmniConnector, IOmniConnector, PlatformType, UnifiedMessage } from './OmniConnector';
import { EventBus } from '../core/events/NexusEventBus';
import { NexusDB } from '../database/NexusDB';

export interface ChannelFeature {
  inbound: boolean;        // Can receive messages from customers
  outbound: boolean;       // Can send campaigns/notifications
  fileSharing: boolean;    // Can send images/files
  quickReplies: boolean;   // Supports button quick replies
  templateMessages: boolean; // Supports pre-approved templates
  realtime: boolean;       // WebSocket/webhook real-time
}

export interface RegisteredChannel {
  platformId: PlatformType;
  displayName: string;
  adapter: IOmniConnector;
  features: ChannelFeature;
  enabled: boolean;
  webhookPath: string;
  configuredAt: string;
}

class ChannelRegistryClass {
  private channels = new Map<PlatformType, RegisteredChannel>();

  /** Register a channel adapter with its capabilities */
  register(
    adapter: IOmniConnector,
    features: ChannelFeature,
    displayName?: string
  ): void {
    const platformId = adapter.platform;
    const webhookPath = `/api/webhooks/${platformId}`;

    const channel: RegisteredChannel = {
      platformId,
      displayName: displayName || platformId,
      adapter,
      features,
      enabled: true,
      webhookPath,
      configuredAt: new Date().toISOString(),
    };

    this.channels.set(platformId, channel);

    // Also register in OmniConnector
    OmniConnector.registerConnector(adapter);

    console.info(`[ChannelRegistry] ✅ Registered: ${platformId} (${webhookPath})`);
  }

  /** Get all registered channels */
  getAll(): RegisteredChannel[] {
    return Array.from(this.channels.values());
  }

  get(platformId: PlatformType): RegisteredChannel | undefined {
    return this.channels.get(platformId);
  }

  /** Enable/disable a channel at runtime (from FeatureManager) */
  setEnabled(platformId: PlatformType, enabled: boolean): void {
    const ch = this.channels.get(platformId);
    if (ch) {
      ch.enabled = enabled;
      EventBus.emit('channel.toggled', { platformId, enabled });
      console.info(`[ChannelRegistry] Channel ${platformId}: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }
  }

  /** Send outbound message through a channel (for campaigns) */
  async sendOutbound(platformId: PlatformType, recipientId: string, message: string, options?: {
    imageUrl?: string;
    quickReplies?: string[];
    templateName?: string;
  }): Promise<boolean> {
    const ch = this.channels.get(platformId);
    if (!ch || !ch.enabled) {
      console.warn(`[ChannelRegistry] Cannot send — channel ${platformId} not registered or disabled`);
      return false;
    }
    if (!ch.features.outbound) {
      console.warn(`[ChannelRegistry] Channel ${platformId} does not support outbound`);
      return false;
    }

    try {
      await ch.adapter.sendMessage(recipientId, message, options as Record<string, unknown>);
      // Log outbound
      await NexusDB.add('outbound_messages', {
        platformId, recipientId, message: message.slice(0, 500),
        sentAt: new Date().toISOString(), status: 'sent',
      });
      return true;
    } catch (err) {
      console.error(`[ChannelRegistry] Send failed on ${platformId}:`, err);
      await NexusDB.add('outbound_messages', {
        platformId, recipientId, message: message.slice(0, 500),
        sentAt: new Date().toISOString(), status: 'failed',
        error: String(err).slice(0, 200),
      });
      return false;
    }
  }

  /**
   * Broadcast campaign to multiple customers across multiple channels.
   * Respects per-customer channel preference stored in CustomerIdentityService.
   */
  async broadcastCampaign(campaignId: string, recipients: Array<{
    customerId: string;
    preferredChannel: PlatformType;
    channelId: string;    // platform-specific ID (phone for WhatsApp, chatId for Telegram)
    message: string;
  }>): Promise<{ sent: number; failed: number; skipped: number }> {
    let sent = 0, failed = 0, skipped = 0;

    for (const r of recipients) {
      const ch = this.channels.get(r.preferredChannel);
      if (!ch || !ch.enabled || !ch.features.outbound) {
        skipped++;
        continue;
      }

      const ok = await this.sendOutbound(r.preferredChannel, r.channelId, r.message);
      if (ok) sent++;
      else failed++;

      // Small delay to avoid API rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Update campaign stats
    await NexusDB.update('campaigns', campaignId, {
      lastBroadcastAt: new Date().toISOString(),
      lastBroadcastStats: { sent, failed, skipped },
    }).catch(() => {});

    return { sent, failed, skipped };
  }

  /** Trigger human handoff for a conversation */
  async requestHumanHandoff(platformId: PlatformType, customerId: string, reason: string): Promise<void> {
    // Mark conversation as needing human in DB
    await NexusDB.add('human_handoff_queue', {
      platformId, customerId, reason,
      requestedAt: new Date().toISOString(),
      status: 'pending',
    });

    // Notify RepDashboard via WebSocket
    EventBus.emit('chat.human_handoff_requested', {
      platformId, customerId, reason,
      timestamp: new Date().toISOString(),
    });

    // Notify customer
    await this.sendOutbound(platformId, customerId,
      '🙏 Connecting you with a human representative. Please hold on for a moment.');
  }

  getStats(): { total: number; enabled: number; platforms: string[] } {
    const all = this.getAll();
    return {
      total: all.length,
      enabled: all.filter(c => c.enabled).length,
      platforms: all.map(c => c.platformId),
    };
  }
}

export const ChannelRegistry = new ChannelRegistryClass();
export default ChannelRegistry;
