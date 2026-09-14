import { IOmnichannelAdapter } from '../OmnichannelGateway';

/**
 * EXAMPLE ADAPTER: Demonstrates how WhatsApp or Facebook Messenger 
 * plugging into the Nexus ecosystem requires 0 changes to AI logic.
 */
export class WhatsAppAdapter implements IOmnichannelAdapter {
  platformId = 'whatsapp';
  
  private webhookUrl: string;

  constructor() {
    this.webhookUrl = 'https://api.whatsapp.com/v1/messages';
  }

  async sendMessage(recipientPhoneNumber: string, text: string): Promise<boolean> {
    console.log(`[WhatsApp Adapter] Sending standard message packet to +${recipientPhoneNumber}`);
    // fetch(this.webhookUrl, { ... })
    return true;
  }

  onMessageReceived(callback: (senderId: string, text: string) => void): void {
     // In an Express server, this would bind to the webhook intake route
     // e.g. app.post('/webhook/whatsapp', (req, res) => { callback(...) })
     console.log("[WhatsApp Adapter] Listening for WhatsApp Webhooks...");
  }
}
