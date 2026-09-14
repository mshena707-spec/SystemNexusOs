/**
 * Web Chat Adapter — Built-in live chat for the Nexus storefront.
 * Messages come from the frontend via /api/chat endpoint (already wired in server.ts).
 * This adapter lets Web Chat participate in the unified OmniHub log & dashboard.
 */
import { IOmniConnector, PlatformType, UnifiedMessage } from '../OmniConnector';

export class WebChatAdapter implements IOmniConnector {
  platform: PlatformType = 'web';
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  async connect(): Promise<boolean> {
    console.log('[WebChatAdapter] Web chat channel active.');
    return true;
  }

  async disconnect(): Promise<void> {}

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Called from server.ts /api/chat endpoint to log messages into OmniHub */
  injectMessage(msg: UnifiedMessage) {
    if (this.messageHandler) this.messageHandler(msg);
  }

  async sendMessage(userId: string, content: string): Promise<boolean> {
    // Web chat responses are returned directly via HTTP — no push needed
    console.log(`[WebChatAdapter] Response queued for ${userId}`);
    return true;
  }
}
