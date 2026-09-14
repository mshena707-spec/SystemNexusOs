/**
 * Discord Bot Adapter — Real implementation via Discord REST API + Webhook
 *
 * Setup:
 *  1. Create app at discord.com/developers/applications
 *  2. Bot → Add Bot → Copy token
 *  3. OAuth2 → Generate URL with bot + applications.commands scopes
 *  4. Invite bot to your server
 *  5. Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID in .env
 *  6. Register webhook: POST /api/webhooks/discord  (for interactions)
 *
 * Note: For DM-based customer support, Discord uses Interactions (slash commands)
 * or listening to messages in a specific channel.
 */
import { IOmniConnector, PlatformType, UnifiedMessage } from '../OmniConnector';

const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordAdapter implements IOmniConnector {
  platform: PlatformType = 'discord';
  private botToken: string;
  private applicationId: string;
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  constructor() {
    const env = (process as any)?.env || {};
    this.botToken = env.DISCORD_BOT_TOKEN || '';
    this.applicationId = env.DISCORD_APPLICATION_ID || '';
  }

  async connect(): Promise<boolean> {
    if (!this.botToken) {
      console.warn('[DiscordAdapter] DISCORD_BOT_TOKEN not set. Running in dry-run mode.');
      return false;
    }
    try {
      const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });
      const data = await res.json();
      if (data.username) {
        console.log(`[DiscordAdapter] Connected as ${data.username}#${data.discriminator}`);
        return true;
      }
      return false;
    } catch (e) {
      console.error('[DiscordAdapter] Connection failed:', e);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    console.log('[DiscordAdapter] Disconnected.');
  }

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Handle incoming Discord interaction (slash command or button click).
   * Register POST /api/webhooks/discord in server.ts.
   */
  async handleWebhookPayload(payload: any): Promise<void> {
    if (!this.messageHandler) return;

    // Type 1 = PING (Discord sends this to verify endpoint)
    if (payload.type === 1) return;

    // Type 2 = APPLICATION_COMMAND (slash command)
    if (payload.type === 2) {
      const userId = payload.member?.user?.id || payload.user?.id;
      const username = payload.member?.user?.username || payload.user?.username;
      const content = payload.data?.options?.[0]?.value || payload.data?.name || '';

      this.messageHandler({
        id: payload.id,
        platform: this.platform,
        senderId: `dc_${userId}`,
        senderName: username || userId,
        content,
        timestamp: Date.now(),
        metadata: {
          channelId: payload.channel_id,
          guildId: payload.guild_id,
          interactionToken: payload.token,
        },
      });
    }

    // Type 3 = MESSAGE_COMPONENT (button, select menu)
    if (payload.type === 3) {
      const userId = payload.member?.user?.id || payload.user?.id;
      this.messageHandler({
        id: payload.id,
        platform: this.platform,
        senderId: `dc_${userId}`,
        senderName: payload.member?.user?.username || userId,
        content: payload.data?.custom_id || '',
        timestamp: Date.now(),
        metadata: { interactionToken: payload.token, channelId: payload.channel_id },
      });
    }
  }

  /**
   * Send a message to a Discord channel or DM.
   * For slash command responses, use sendInteractionReply instead.
   */
  async sendMessage(userId: string, content: string): Promise<boolean> {
    if (!this.botToken) {
      console.warn(`[DiscordAdapter DRY-RUN] -> ${userId}: ${content}`);
      return true;
    }

    // Open DM channel first
    const channelId = userId.replace('dc_', '');
    try {
      // Create DM channel
      const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
        method: 'POST',
        headers: { Authorization: `Bot ${this.botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: channelId }),
      });
      const dmChannel = await dmRes.json();
      if (!dmChannel.id) return false;

      // Send to DM channel
      const res = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${this.botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      return res.ok;
    } catch (e) {
      console.error('[DiscordAdapter] Send error:', e);
      return false;
    }
  }

  /** Reply to a slash command interaction (must respond within 3 seconds) */
  async sendInteractionReply(interactionId: string, interactionToken: string, content: string): Promise<boolean> {
    try {
      const res = await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 4, data: { content } }),
      });
      return res.ok;
    } catch (e) {
      console.error('[DiscordAdapter] Interaction reply failed:', e);
      return false;
    }
  }
}
