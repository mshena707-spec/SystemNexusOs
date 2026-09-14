import { IAIProvider, ChatMessage } from '../interfaces/IAIProvider';
import { RuntimeDetector } from '../runtime/RuntimeDetector';

export class GemmaOfflineAdapter implements IAIProvider {
  providerId = 'local-offline-1';
  private engine: any = null; // Changed to any to avoid static import
  private isInitializing: boolean = false;
  private modelId: string | null = null; 

  async initializeEngine(onProgress?: (progress: string) => void) {
    if (this.engine) return this.engine;
    if (this.isInitializing) {
      // Wait for initialization to finish
      while (this.isInitializing) {
        await new Promise(r => setTimeout(r, 500));
      }
      return this.engine!;
    }

    try {
      this.isInitializing = true;
      
      // Hardware-Aware Model Selection
      if (!this.modelId) {
         const caps = RuntimeDetector.getCapabilities();
         if (caps.deviceMemory >= 8) {
            this.modelId = 'gemma-2b-it-q4f32_1-MLC'; // 8GB+ Devices get the fast 2B model
         } else {
            this.modelId = 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC'; // Use TinyLlama for <8GB devices to prevent OOM
         }
      }

      if (onProgress) onProgress(`Loading Local Engine (${this.modelId})... runs entirely offline`);
      
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
      this.engine = await CreateMLCEngine(this.modelId, {
        initProgressCallback: (progress: any) => {
          console.log(`[GemmaOffline] ${progress.text}`);
          if (onProgress) onProgress(progress.text);
        }
      });
      return this.engine;
    } catch (e) {
      console.error("[GemmaOffline] Init failed:", e);
      throw e;
    } finally {
      this.isInitializing = false;
    }
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    try {
      const engine = await this.initializeEngine();
      const payloadMessages = [];
      if (systemPrompt) {
        payloadMessages.push({ role: 'system', content: systemPrompt });
      }
      messages.forEach(m => payloadMessages.push({ role: m.role, content: m.content }));

      const reply = await engine.chat.completions.create({
        messages: payloadMessages as any
      });

      return reply.choices[0].message.content || "";
    } catch (e: any) {
      console.error("[GemmaOffline] Failed to generate chat:", e);
      return "Local Gemma Engine encountered an error... Make sure your browser supports WebGPU.";
    }
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    try {
      const engine = await this.initializeEngine();
      const payloadMessages = [];
      if (systemPrompt) {
        payloadMessages.push({ role: 'system', content: systemPrompt });
      }
      messages.forEach(m => payloadMessages.push({ role: m.role, content: m.content }));

      const chunks = await engine.chat.completions.create({
        messages: payloadMessages as any,
        stream: true
      });

      for await (const chunk of chunks) {
         if (chunk.choices[0]?.delta?.content) {
            yield chunk.choices[0].delta.content;
         }
      }
    } catch (e) {
      console.error("[GemmaOffline] Stream Failed:", e);
      yield " [Local Engine Error - Browser may lack WebGPU] ";
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
     return null as any; // random vectors are semantically meaningless — caller must handle null
  }

  async ping(): Promise<boolean> {
     // If webgpu is supported, it can ping true
     if (typeof navigator !== 'undefined') {
       return 'gpu' in navigator;
     }
     return false;
  }
}
