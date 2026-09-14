/**
 * Interface defining a universal Social/Omnichannel Adapter.
 * Completely eliminates dependency on any specific messaging platform.
 */
export interface IOmnichannelAdapter {
  platformId: string;
  
  /** Sends a message to a user on this platform */
  sendMessage(recipientId: string, text: string, attachments?: any[]): Promise<boolean>;
  
  /** Subscribes to incoming messages from this platform */
  onMessageReceived(callback: (senderId: string, text: string, attachments?: any[]) => void): void;
}

class OmnichannelGatewayManager {
  private adapters: Map<string, IOmnichannelAdapter> = new Map();

  registerAdapter(adapter: IOmnichannelAdapter) {
    this.adapters.set(adapter.platformId, adapter);
    console.log(`[OmnichannelGateway] Universal platform connected: ${adapter.platformId}`);
  }

  getAdapter(platformId: string): IOmnichannelAdapter {
    const adapter = this.adapters.get(platformId);
    if (!adapter) {
      throw new Error(`[OmnichannelGateway] Integration for '${platformId}' is not plugged in. System is unlocked.`);
    }
    return adapter;
  }
  
  // Future: Broadcast to all connected adapters, unify streams, etc.
}

export const OmnichannelGateway = new OmnichannelGatewayManager();
