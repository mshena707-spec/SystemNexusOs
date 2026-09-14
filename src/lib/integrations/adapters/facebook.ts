/**
 * Facebook Messenger & Instagram DM Adapter
 * Uses Meta Graph API — same infrastructure as WhatsApp Cloud API.
 *
 * Setup:
 *  1. Create a Meta App at developers.facebook.com
 *  2. Add "Messenger" product to your app
 *  3. Get PAGE_ACCESS_TOKEN from your Facebook Page
 *  4. Set FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_VERIFY_TOKEN in .env
 *  5. Register webhook: /api/webhooks/facebook  (in server.ts)
 */
import { IOmniConnector, PlatformType, UnifiedMessage } from '../OmniConnector';

export class FacebookMessengerAdapter implements IOmniConnector {
  platform: PlatformType = 'messenger';
  private pageAccessToken: string;
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  constructor() {
    const env = (process as any)?.env || {};
    this.pageAccessToken = env.FACEBOOK_PAGE_ACCESS_TOKEN || '';
  }

  async connect(): Promise<boolean> {
    if (!this.pageAccessToken) {
      console.warn('[FacebookAdapter] FACEBOOK_PAGE_ACCESS_TOKEN not set. Running in dry-run mode.');
      return false;
    }
    console.log('[FacebookAdapter] Connected to Meta Graph API (Messenger).');
    return true;
  }

  async disconnect(): Promise<void> {
    console.log('[FacebookAdapter] Disconnected.');
  }

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Parse incoming webhook payload from Meta and route internally.
   * Register POST /api/webhooks/facebook in server.ts to call this.
   */
  async handleWebhookPayload(payload: any): Promise<void> {
    if (!this.messageHandler) return;
    if (payload.object !== 'page') return;

    for (const entry of payload.entry || []) {
      for (const event of entry.messaging || []) {
        if (!event.message || !event.message.text) continue;

        this.messageHandler({
          id: event.message.mid,
          platform: this.platform,
          senderId: `fb_${event.sender.id}`,
          senderName: event.sender.id,
          content: event.message.text,
          timestamp: event.timestamp,
          metadata: { raw: event },
        });
      }
    }
  }

  /**
   * Send a text reply via Messenger Send API.
   */
  async sendMessage(userId: string, content: string): Promise<boolean> {
    const recipientId = userId.replace('fb_', '');

    if (!this.pageAccessToken) {
      console.warn(`[FacebookAdapter DRY-RUN] -> ${recipientId}: ${content}`);
      return true;
    }

    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${this.pageAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: content },
          messaging_type: 'RESPONSE',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('[FacebookAdapter] Send failed:', err);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[FacebookAdapter] Network error:', e);
      return false;
    }
  }
}

/**
 * Instagram Direct Message Adapter
 * Uses same Meta Graph API but with Instagram-specific scopes.
 *
 * Setup:
 *  1. Connect Instagram Business Account to your Meta App
 *  2. Request instagram_manage_messages permission
 *  3. Use same FACEBOOK_PAGE_ACCESS_TOKEN (linked IG business account)
 *  4. Register webhook: /api/webhooks/instagram
 */
export class InstagramAdapter implements IOmniConnector {
  platform: PlatformType = 'instagram';
  private pageAccessToken: string;
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  constructor() {
    const env = (process as any)?.env || {};
    this.pageAccessToken = env.FACEBOOK_PAGE_ACCESS_TOKEN || '';
  }

  async connect(): Promise<boolean> {
    if (!this.pageAccessToken) {
      console.warn('[InstagramAdapter] FACEBOOK_PAGE_ACCESS_TOKEN not set.');
      return false;
    }
    console.log('[InstagramAdapter] Connected to Meta Graph API (Instagram DM).');
    return true;
  }

  async disconnect(): Promise<void> {}

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  async handleWebhookPayload(payload: any): Promise<void> {
    if (!this.messageHandler) return;
    if (payload.object !== 'instagram') return;

    for (const entry of payload.entry || []) {
      for (const event of entry.messaging || []) {
        if (!event.message?.text) continue;
        this.messageHandler({
          id: event.message.mid,
          platform: this.platform,
          senderId: `ig_${event.sender.id}`,
          senderName: event.sender.id,
          content: event.message.text,
          timestamp: event.timestamp,
          metadata: { raw: event },
        });
      }
    }
  }

  async sendMessage(userId: string, content: string): Promise<boolean> {
    const recipientId = userId.replace('ig_', '');
    if (!this.pageAccessToken) {
      console.warn(`[InstagramAdapter DRY-RUN] -> ${recipientId}: ${content}`);
      return true;
    }
    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${this.pageAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: content },
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('[InstagramAdapter] Send failed:', e);
      return false;
    }
  }
}
