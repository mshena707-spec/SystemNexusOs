/**
 * Telegram Bot Adapter — Real implementation via Bot API (long-polling & webhook modes)
 *
 * Setup:
 *  1. Talk to @BotFather on Telegram → /newbot → get token
 *  2. Set TELEGRAM_BOT_TOKEN in .env
 *  3. Register webhook in server.ts: POST /api/webhooks/telegram
 *  4. Call setWebhook once: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/webhooks/telegram
 */
import { IOmniConnector, PlatformType, UnifiedMessage } from '../OmniConnector';

const TG_BASE = 'https://api.telegram.org/bot';

export class TelegramAdapter implements IOmniConnector {
  platform: PlatformType = 'telegram';
  private token: string;
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  constructor() {
    const env = (process as any)?.env || {};
    this.token = env.TELEGRAM_BOT_TOKEN || '';
  }

  async connect(): Promise<boolean> {
    if (!this.token) {
      console.warn('[TelegramAdapter] TELEGRAM_BOT_TOKEN not set. Running in dry-run mode.');
      return false;
    }
    try {
      const res = await fetch(`${TG_BASE}${this.token}/getMe`);
      const data = await res.json();
      if (data.ok) {
        console.log(`[TelegramAdapter] Connected as @${data.result.username}`);
        return true;
      }
      console.error('[TelegramAdapter] Invalid token:', data.description);
      return false;
    } catch (e) {
      console.error('[TelegramAdapter] Connection failed:', e);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    console.log('[TelegramAdapter] Disconnected.');
  }

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Parse Telegram webhook update and route to AI brain.
   * Register POST /api/webhooks/telegram in server.ts.
   */
  async handleWebhookPayload(payload: any): Promise<void> {
    if (!this.messageHandler) return;

    const message = payload.message || payload.edited_message;
    if (!message || !message.text) return;

    this.messageHandler({
      id: String(message.message_id),
      platform: this.platform,
      senderId: `tg_${message.from.id}`,
      senderName: message.from.first_name + (message.from.last_name ? ` ${message.from.last_name}` : ''),
      content: message.text,
      timestamp: message.date * 1000,
      metadata: {
        chatId: message.chat.id,
        chatType: message.chat.type,
        username: message.from.username,
      },
    });
  }

  /**
   * Send a text message via Telegram Bot API.
   * userId must be in format tg_<chat_id>
   */
  async sendMessage(userId: string, content: string, options?: { parseMode?: 'HTML' | 'Markdown' }): Promise<boolean> {
    const chatId = userId.replace('tg_', '');

    if (!this.token) {
      console.warn(`[TelegramAdapter DRY-RUN] -> ${chatId}: ${content}`);
      return true;
    }

    try {
      const body: any = {
        chat_id: chatId,
        text: content,
      };
      if (options?.parseMode) body.parse_mode = options.parseMode;

      const res = await fetch(`${TG_BASE}${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('[TelegramAdapter] Send failed:', err);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[TelegramAdapter] Network error:', e);
      return false;
    }
  }

  /** Register webhook with Telegram servers (call once after deployment) */
  async registerWebhook(webhookUrl: string): Promise<boolean> {
    if (!this.token) return false;
    const res = await fetch(`${TG_BASE}${this.token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json();
    console.log('[TelegramAdapter] Webhook registration:', data);
    return data.ok;
  }
}
