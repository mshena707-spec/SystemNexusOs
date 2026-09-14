/**
 * TikTok Adapter — Phase G
 *
 * TikTok for Business exposes inbound customer messages via the
 * TikTok Business Messaging API (part of TikTok for Business Login Kit).
 * As of the TikTok Business API, merchants receive DM/comment webhook
 * events and reply via the same API.
 *
 * Setup:
 *  1. Register an app at https://business-api.tiktok.com/
 *  2. Enable "Business Messaging" scope for your TikTok Business Account
 *  3. Set TIKTOK_ACCESS_TOKEN, TIKTOK_BUSINESS_ID, TIKTOK_APP_SECRET in .env
 *  4. Register webhook: POST /api/webhooks/tiktok
 *  5. Verify webhook signature using TIKTOK_APP_SECRET (HMAC-SHA256, like Meta)
 *
 * Plugin architecture note (Phase G):
 *  This adapter follows the exact same IOmniConnector contract as every
 *  other channel. To add a future channel (e.g. LinkedIn, Viber, WeChat):
 *    1. Implement IOmniConnector in src/lib/integrations/adapters/<name>.ts
 *    2. Register: OmniConnector.registerConnector(new YourAdapter())
 *    3. Add webhook route: POST /api/webhooks/<name>
 *    4. No changes needed to OmniConnector, CustomerIdentityService,
 *       MessageHistoryService, or any business logic — they are
 *       channel-agnostic by design.
 */
import { IOmniConnector, PlatformType, UnifiedMessage } from '../OmniConnector';
import crypto from 'crypto';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export class TikTokAdapter implements IOmniConnector {
  platform: PlatformType = 'tiktok';
  private accessToken: string;
  private businessId: string;
  private appSecret: string;
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  constructor() {
    const env = (process as any)?.env || {};
    this.accessToken = env.TIKTOK_ACCESS_TOKEN || '';
    this.businessId  = env.TIKTOK_BUSINESS_ID  || '';
    this.appSecret   = env.TIKTOK_APP_SECRET   || '';
  }

  async connect(): Promise<boolean> {
    if (!this.accessToken || !this.businessId) {
      console.warn('[TikTokAdapter] TIKTOK_ACCESS_TOKEN/TIKTOK_BUSINESS_ID not set. Running in dry-run mode.');
      return false;
    }
    try {
      const res = await fetch(`${TIKTOK_API_BASE}/business/get/?business_id=${this.businessId}`, {
        headers: { 'Access-Token': this.accessToken },
      });
      const data = await res.json();
      if (data.code === 0) {
        console.log(`[TikTokAdapter] Connected to TikTok Business account ${this.businessId}`);
        return true;
      }
      console.error('[TikTokAdapter] Connection check failed:', data.message);
      return false;
    } catch (e) {
      console.error('[TikTokAdapter] Connection failed:', e);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    console.log('[TikTokAdapter] Disconnected.');
  }

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Verify TikTok webhook signature (HMAC-SHA256 over raw body using app secret).
   * TikTok sends signature in the `TikTok-Signature` header.
   */
  verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!this.appSecret || !signatureHeader) return !this.appSecret; // allow in dry-run
    const expected = crypto.createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
    } catch {
      return false;
    }
  }

  /**
   * Parse TikTok Business Messaging webhook event and route to AI brain.
   * Register POST /api/webhooks/tiktok in server.ts.
   *
   * Expected payload shape (TikTok Business Messaging webhook):
   * {
   *   "event": "message.receive",
   *   "data": {
   *     "conversation_id": "...",
   *     "sender_id": "...",
   *     "sender_name": "...",
   *     "message": { "text": "..." },
   *     "create_time": 1718000000
   *   }
   * }
   */
  async handleWebhookPayload(payload: any): Promise<void> {
    if (!this.messageHandler) return;

    if (payload.event !== 'message.receive') return;
    const data = payload.data;
    if (!data?.message?.text) return;

    this.messageHandler({
      id: data.message_id ?? `tt_${Date.now()}`,
      platform: this.platform,
      senderId: `tt_${data.sender_id}`,
      senderName: data.sender_name ?? 'TikTok User',
      content: data.message.text,
      timestamp: (data.create_time ?? Math.floor(Date.now()/1000)) * 1000,
      metadata: { conversationId: data.conversation_id },
    });
  }

  /**
   * Send a text reply via TikTok Business Messaging API.
   * userId must be in format tt_<sender_id>
   */
  async sendMessage(userId: string, content: string): Promise<boolean> {
    const recipientId = userId.replace('tt_', '');

    if (!this.accessToken) {
      console.warn(`[TikTokAdapter DRY-RUN] -> ${recipientId}: ${content}`);
      return true;
    }

    try {
      const res = await fetch(`${TIKTOK_API_BASE}/business/message/send/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Access-Token': this.accessToken },
        body: JSON.stringify({
          business_id: this.businessId,
          recipient_id: recipientId,
          message: { text: content },
        }),
      });
      const data = await res.json();
      if (data.code !== 0) {
        console.error('[TikTokAdapter] Send failed:', data.message);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[TikTokAdapter] Send error:', e);
      return false;
    }
  }
}
