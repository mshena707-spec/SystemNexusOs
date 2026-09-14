/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         NEXUS HYBRID AI ADAPTERS — Phase 6                   ║
 * ║  Claude (Anthropic) + DeepSeek + Mistral + LiteLLM proxy    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { IAIProvider, ChatMessage } from '../../interfaces/IAIProvider';
import { NexusConfig } from '../../config/NexusConfig';
import { logger } from '../../logging/NexusLogger';

const log = logger.child('HybridAdapters');

// ── Shared SSE stream reader ──────────────────────────────────────────────
async function* readSSEStream(res: Response, dataExtractor: (chunk: any) => string | undefined): AsyncGenerator<string> {
  if (!res.body) throw new Error('No response body');
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
      const trimmed = line.replace(/^data:\s*/, '').trim();
      if (!trimmed || trimmed === '[DONE]') continue;
      try {
        const chunk = JSON.parse(trimmed);
        const text = dataExtractor(chunk);
        if (text) yield text;
      } catch (_) {}
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// ANTHROPIC CLAUDE ADAPTER
// claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022
// ════════════════════════════════════════════════════════════════════════
export class ClaudeAdapter implements IAIProvider {
  providerId = 'claude';
  private apiKey: string;
  private model: string;

  constructor(model = 'claude-3-5-haiku-20241022') {
    this.apiKey = NexusConfig.ai.anthropicApiKey || '';
    this.model = model;
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    if (!this.apiKey) { yield ''; return; }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        stream: true,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Claude stream error: ${res.status}`);
    yield* readSSEStream(res, (chunk) => chunk.delta?.text);
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    // Claude doesn't have embeddings API — use OpenAI or Gemini
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════
// DEEPSEEK ADAPTER
// deepseek-chat (V3), deepseek-reasoner (R1)
// OpenAI-compatible API format
// ════════════════════════════════════════════════════════════════════════
export class DeepSeekAdapter implements IAIProvider {
  providerId = 'deepseek';
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.deepseek.com/v1';

  constructor(model = 'deepseek-chat') {
    this.apiKey = NexusConfig.ai.deepseekApiKey || '';
    this.model = model;
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) throw new Error('DEEPSEEK_API_KEY not set');
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: msgs }),
    });
    if (!res.ok) throw new Error(`DeepSeek error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    if (!this.apiKey) { yield ''; return; }
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: msgs, stream: true }),
    });
    if (!res.ok) throw new Error(`DeepSeek stream error: ${res.status}`);
    yield* readSSEStream(res, (chunk) => chunk.choices?.[0]?.delta?.content);
  }

  async generateEmbedding(_text: string): Promise<number[]> { return []; }
}

// ════════════════════════════════════════════════════════════════════════
// MISTRAL ADAPTER
// mistral-small-latest, mistral-large-latest, open-mistral-nemo
// ════════════════════════════════════════════════════════════════════════
export class MistralAdapter implements IAIProvider {
  providerId = 'mistral';
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.mistral.ai/v1';

  constructor(model = 'mistral-small-latest') {
    this.apiKey = NexusConfig.ai.mistralApiKey || '';
    this.model = model;
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) throw new Error('MISTRAL_API_KEY not set');
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: msgs }),
    });
    if (!res.ok) throw new Error(`Mistral error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    if (!this.apiKey) { yield ''; return; }
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: msgs, stream: true }),
    });
    if (!res.ok) throw new Error(`Mistral stream error: ${res.status}`);
    yield* readSSEStream(res, (chunk) => chunk.choices?.[0]?.delta?.content);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mistral-embed', input: [text] }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.data?.[0]?.embedding || [];
    } catch (_) { return []; }
  }
}

// ════════════════════════════════════════════════════════════════════════
// LITELLM PROXY ADAPTER
// Universal proxy — routes to any model via single endpoint.
// Supports: OpenAI, Anthropic, Gemini, Ollama, vLLM, Azure, AWS Bedrock, etc.
//
// SETUP:
//  pip install litellm && litellm --model ollama/llama3.2
//  Set: LITELLM_BASE_URL=http://localhost:4000
//       LITELLM_API_KEY=sk-anything (can be empty for local)
// ════════════════════════════════════════════════════════════════════════
export class LiteLLMAdapter implements IAIProvider {
  providerId = 'litellm';
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(model = 'gpt-3.5-turbo') {
    this.baseUrl = NexusConfig.ai.litellmBaseUrl || 'http://localhost:4000';
    this.apiKey = NexusConfig.ai.litellmApiKey || 'sk-placeholder';
    this.model = model;
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: msgs }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LiteLLM error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => msgs.push({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: msgs, stream: true }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`LiteLLM stream error: ${res.status}`);
    yield* readSSEStream(res, (chunk) => chunk.choices?.[0]?.delta?.content);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.data?.[0]?.embedding || [];
    } catch (_) { return []; }
  }

  /** Check if LiteLLM proxy is running */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch (_) { return false; }
  }

  /** List all models available through LiteLLM proxy */
  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      const data = await res.json();
      return (data.data || []).map((m: any) => m.id);
    } catch (_) { return []; }
  }
}
