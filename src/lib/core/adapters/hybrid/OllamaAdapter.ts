/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              OLLAMA LOCAL AI ADAPTER — Phase 6               ║
 * ║  Run any open-source model locally via Ollama server.        ║
 * ║  Zero API cost. Full privacy. No internet required.          ║
 * ║                                                              ║
 * ║  SETUP:                                                      ║
 * ║   1. Install: curl https://ollama.com/install.sh | sh        ║
 * ║   2. Pull:    ollama pull llama3.2 (or any model)            ║
 * ║   3. Start:   ollama serve (default: localhost:11434)         ║
 * ║   4. Set:     OLLAMA_BASE_URL=http://localhost:11434          ║
 * ║               ENABLE_LOCAL_AI=true                           ║
 * ║                                                              ║
 * ║  RECOMMENDED MODELS:                                         ║
 * ║   llama3.2        — 3B, fast, 2GB RAM                        ║
 * ║   llama3.1:8b     — 8B, smart, 5GB RAM                       ║
 * ║   mistral:7b      — 7B, great for chat, 5GB RAM              ║
 * ║   qwen2.5:7b      — 7B, excellent multilingual               ║
 * ║   deepseek-r1:7b  — 7B, reasoning model                      ║
 * ║   gemma2:2b       — 2B, ultra-fast, 2GB RAM                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { IAIProvider, ChatMessage } from '../../interfaces/IAIProvider';
import { NexusConfig } from '../../config/NexusConfig';
import { logger } from '../../logging/NexusLogger';

const log = logger.child('OllamaAdapter');

export class OllamaAdapter implements IAIProvider {
  providerId = 'ollama';
  private baseUrl: string;
  private model: string;
  private available = false;

  constructor(model = 'llama3.2') {
    this.baseUrl = NexusConfig.ai.ollamaBaseUrl || 'http://localhost:11434';
    this.model = model;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) { this.available = false; return false; }
      const data = await res.json();
      const models: string[] = (data.models || []).map((m: any) => m.name);
      this.available = models.some(m => m.startsWith(this.model.split(':')[0]));
      if (!this.available) {
        log.warn(`Ollama: model '${this.model}' not found. Pull it: ollama pull ${this.model}`, {
          available: models,
        });
      } else {
        log.info(`Ollama: connected, model '${this.model}' ready`);
      }
      return this.available;
    } catch (_) {
      this.available = false;
      return false;
    }
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const payload = this._buildPayload(messages, systemPrompt, false);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return data.message?.content || '';
    } catch (e) {
      log.error('Ollama generateChat failed', e instanceof Error ? e : undefined);
      throw e;
    }
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    const payload = this._buildPayload(messages, systemPrompt, true);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok || !res.body) throw new Error(`Ollama stream error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            if (chunk.message?.content) yield chunk.message.content;
            if (chunk.done) return;
          } catch (_) {}
        }
      }
    } catch (e) {
      log.error('Ollama stream failed', e instanceof Error ? e : undefined);
      throw e;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Ollama embed error: ${res.status}`);
      const data = await res.json();
      return data.embeddings?.[0] || [];
    } catch (_) {
      return [];
    }
  }

  /** List all models available in Ollama */
  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      const data = await res.json();
      return (data.models || []).map((m: any) => m.name);
    } catch (_) { return []; }
  }

  /** Pull a model (triggers download) */
  async pullModel(modelName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(300_000), // 5 min for download
      });
      return res.ok;
    } catch (_) { return false; }
  }

  private _buildPayload(messages: ChatMessage[], systemPrompt?: string, stream = false) {
    const ollamaMessages = [];
    if (systemPrompt) ollamaMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => ollamaMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    return { model: this.model, messages: ollamaMessages, stream };
  }

  isAvailable(): boolean { return this.available; }
}
