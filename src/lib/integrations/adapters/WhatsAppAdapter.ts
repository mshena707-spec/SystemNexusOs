import { IOmniConnector, UnifiedMessage, PlatformType } from '../OmniConnector';

/**
 * WhatsApp Business Cloud API Adapter (Phase D)
 * Connects the system to Meta's generic graph API for WhatsApp natively.
 */
export class WhatsAppAdapter implements IOmniConnector {
  platform: PlatformType = 'whatsapp';
  name = 'WhatsApp Cloud API Adapter';

  private apiToken: string;
  private phoneNumberId: string;
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  constructor() {
    // These should be configured in your .env / AutoConfig
    const env = (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) ? (import.meta as any).env : (process?.env || {});
    this.apiToken = env.VITE_WHATSAPP_TOKEN || process?.env?.VITE_WHATSAPP_TOKEN || '';
    this.phoneNumberId = env.VITE_WHATSAPP_PHONE_ID || process?.env?.VITE_WHATSAPP_PHONE_ID || '';
  }

  async connect(): Promise<boolean> {
    if (!this.apiToken || !this.phoneNumberId) {
      console.warn(`[WhatsAppAdapter] Missing credentials, running in simulated connection mode.`);
      return false;
    } else {
      console.log(`[WhatsAppAdapter] Connected to Meta WA Cloud API.`);
      return true;
    }
  }

  async disconnect(): Promise<void> {
    console.log(`[WhatsAppAdapter] Disconnected.`);
  }

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Parse incoming webhook from Meta and trigger the internal brain
   */
  async handleWebhookPayload(payload: any): Promise<void> {
    if (!this.messageHandler) return;

    try {
      const entry = payload.entry?.[0];
      const changes = entry?.changes?.[0]?.value;
      const messages = changes?.messages;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const from = msg.from; // User's phone number
        const text = msg.text?.body || '';
        
        this.messageHandler({
          id: msg.id,
          platform: this.platform,
          senderId: `wa_${from}`, // Normalized internal user ID
          senderName: from,
          content: text,
          timestamp: parseInt(msg.timestamp) * 1000,
          metadata: { wa_payload: msg }
        });
      }
    } catch (e) {
      console.error("[WhatsAppAdapter] Failed to parse webhook", e);
    }
  }

  /**
   * Send response back to Meta API
   */
  async sendMessage(userId: string, content: string, options?: any): Promise<boolean> {
    if (!this.apiToken || !this.phoneNumberId) {
      console.warn(`[WhatsAppAdapter Mock Outbound -> ${userId}]: ${content}`);
      return true;
    }

    // Extract actual phone number from localized wa_id
    const recipientPhone = userId.replace('wa_', '');

    try {
      const res = await fetch(`https://graph.facebook.com/v17.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: { body: content }
        })
      });

      if (!res.ok) {
        const err = await res.json();
        console.error("[WhatsAppAdapter] Send failed", err);
        return false;
      }
      
      console.log(`[WhatsAppAdapter] Successfully sent message to ${recipientPhone}`);
      return true;
    } catch (e) {
      console.error("[WhatsAppAdapter] Network error sending message", e);
      return false;
    }
  }
}
