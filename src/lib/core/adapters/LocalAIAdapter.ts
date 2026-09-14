import { IAIProvider, ChatMessage } from '../interfaces/IAIProvider';

/**
 * Local AI Adapter (Phase C & K)
 * Fallback AI provider that doesn't rely on external APIs.
 * Useful for Eco-mode or offline capabilities.
 */
export class LocalAIAdapter implements IAIProvider {
  providerId = 'local-offline-1';

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    console.log(`[LocalAIAdapter] Executing mock prompt on device`);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 800));

    return "I am the Local Offline Mock Engine. I operate entirely on your device without internet access. You are currently in Eco/Offline mode.";
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const chars = "I am the Local Offline Mock Engine... streaming words one by one.".split(" ");
    
    for (const word of chars) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay
      yield word + " ";
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
     return null as any; // random vectors are semantically meaningless
  }

  async ping(): Promise<boolean> {
     return true;
  }
}
