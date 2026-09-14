/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PHASE D — MISSING AI PROVIDER ADAPTERS                            ║
 * ║                                                                     ║
 * ║  All providers implement IAIProvider.                               ║
 * ║  Business logic NEVER calls these directly.                         ║
 * ║  All calls go through AIProviderOrchestrator.call()                ║
 * ║                                                                     ║
 * ║  New in Phase D:                                                    ║
 * ║   OpenRouter  — unified gateway (100+ models)                       ║
 * ║   Together AI — fast open-source inference                          ║
 * ║   Cerebras    — ultra-fast Llama inference (wafer-scale)            ║
 * ║   Fireworks   — production-grade open-source hosting                ║
 * ║   LiteLLM     — self-hosted proxy for any model                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { SecretVault } from '../../security/vault/SecretVault';
import type { IAIProvider, ChatMessage } from '../../core/interfaces/IAIProvider';

// ── Shared OpenAI-compatible fetch ────────────────────────────────────────
async function openaiCompatChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt?: string,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const body: any = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 2048,
    temperature: 0.7,
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`${baseUrl} error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function* openaiCompatStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt?: string,
  extraHeaders: Record<string, string> = {}
): AsyncGenerator<string, void, unknown> {
  const body: any = {
    model,
    stream: true,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 2048,
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Stream error ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      const json = line.slice(6).trim();
      if (json === '[DONE]') return;
      try {
        const parsed = JSON.parse(json);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed SSE */ }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// 1. OPENROUTER — unified gateway, 100+ models
//    https://openrouter.ai/docs
//    Env: OPENROUTER_API_KEY
//    Default model: meta-llama/llama-3.1-8b-instruct:free
// ════════════════════════════════════════════════════════════════════════
export class OpenRouterAdapter implements IAIProvider {
  providerId = 'openrouter';
  private readonly BASE = 'https://openrouter.ai/api/v1';

  constructor(
    private model = 'meta-llama/llama-3.1-8b-instruct:free',
    private apiKey = SecretVault.get('OPENROUTER_API_KEY', { caller: 'system', module: 'OpenRouterAdapter' }) ?? ''
  ) {}

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY not set');
    return openaiCompatChat(this.BASE, this.apiKey, this.model, messages, systemPrompt, {
      'HTTP-Referer': process.env.APP_URL ?? 'https://nexus-os.app',
      'X-Title': 'Nexus OS',
    });
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY not set');
    yield* openaiCompatStream(this.BASE, this.apiKey, this.model, messages, systemPrompt, {
      'HTTP-Referer': process.env.APP_URL ?? 'https://nexus-os.app',
      'X-Title': 'Nexus OS',
    });
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    throw new Error('OpenRouter does not support embeddings directly');
  }

  async ping(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return r.ok;
    } catch { return false; }
  }
}

// ════════════════════════════════════════════════════════════════════════
// 2. TOGETHER AI — fast open-source inference
//    https://docs.together.ai
//    Env: TOGETHER_API_KEY
//    Default model: meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
// ════════════════════════════════════════════════════════════════════════
export class TogetherAdapter implements IAIProvider {
  providerId = 'together';
  private readonly BASE = 'https://api.together.xyz/v1';

  constructor(
    private model = 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    private apiKey = SecretVault.get('TOGETHER_API_KEY', { caller: 'system', module: 'TogetherAdapter' }) ?? ''
  ) {}

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) throw new Error('TOGETHER_API_KEY not set');
    return openaiCompatChat(this.BASE, this.apiKey, this.model, messages, systemPrompt);
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) throw new Error('TOGETHER_API_KEY not set');
    yield* openaiCompatStream(this.BASE, this.apiKey, this.model, messages, systemPrompt);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) throw new Error('TOGETHER_API_KEY not set');
    const res = await fetch(`${this.BASE}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: 'togethercomputer/m2-bert-80M-32k-retrieval', input: text }),
    });
    if (!res.ok) throw new Error(`Together embedding error ${res.status}`);
    const data = await res.json();
    return data.data?.[0]?.embedding ?? [];
  }

  async ping(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const r = await fetch(`${this.BASE}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return r.ok;
    } catch { return false; }
  }
}

// ════════════════════════════════════════════════════════════════════════
// 3. CEREBRAS — wafer-scale ultra-fast Llama inference
//    https://inference-docs.cerebras.ai
//    Env: CEREBRAS_API_KEY
//    Default model: llama3.1-8b
// ════════════════════════════════════════════════════════════════════════
export class CerebrasAdapter implements IAIProvider {
  providerId = 'cerebras';
  private readonly BASE = 'https://api.cerebras.ai/v1';

  constructor(
    private model = 'llama3.1-8b',
    private apiKey = SecretVault.get('CEREBRAS_API_KEY', { caller: 'system', module: 'CerebrasAdapter' }) ?? ''
  ) {}

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) throw new Error('CEREBRAS_API_KEY not set');
    return openaiCompatChat(this.BASE, this.apiKey, this.model, messages, systemPrompt);
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) throw new Error('CEREBRAS_API_KEY not set');
    yield* openaiCompatStream(this.BASE, this.apiKey, this.model, messages, systemPrompt);
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    throw new Error('Cerebras does not support embeddings');
  }

  async ping(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const r = await fetch(`${this.BASE}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return r.ok;
    } catch { return false; }
  }
}

// ════════════════════════════════════════════════════════════════════════
// 4. FIREWORKS AI — production open-source hosting
//    https://readme.fireworks.ai
//    Env: FIREWORKS_API_KEY
//    Default model: accounts/fireworks/models/llama-v3p1-8b-instruct
// ════════════════════════════════════════════════════════════════════════
export class FireworksAdapter implements IAIProvider {
  providerId = 'fireworks';
  private readonly BASE = 'https://api.fireworks.ai/inference/v1';

  constructor(
    private model = 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    private apiKey = SecretVault.get('FIREWORKS_API_KEY', { caller: 'system', module: 'FireworksAdapter' }) ?? ''
  ) {}

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) throw new Error('FIREWORKS_API_KEY not set');
    return openaiCompatChat(this.BASE, this.apiKey, this.model, messages, systemPrompt);
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) throw new Error('FIREWORKS_API_KEY not set');
    yield* openaiCompatStream(this.BASE, this.apiKey, this.model, messages, systemPrompt);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) throw new Error('FIREWORKS_API_KEY not set');
    const res = await fetch(`${this.BASE}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: 'nomic-ai/nomic-embed-text-v1.5', input: text }),
    });
    if (!res.ok) throw new Error(`Fireworks embedding error ${res.status}`);
    const data = await res.json();
    return data.data?.[0]?.embedding ?? [];
  }

  async ping(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const r = await fetch(`${this.BASE}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return r.ok;
    } catch { return false; }
  }
}

// ════════════════════════════════════════════════════════════════════════
// 5. LITELLM PROXY — self-hosted, any model behind one endpoint
//    https://docs.litellm.ai/docs/proxy/quick_start
//    Env: LITELLM_BASE_URL (default: http://localhost:4000)
//         LITELLM_API_KEY  (optional, if proxy requires auth)
//         LITELLM_MODEL    (default: gpt-3.5-turbo)
// ════════════════════════════════════════════════════════════════════════
export class LiteLLMAdapter implements IAIProvider {
  providerId = 'litellm';

  private get BASE() { return process.env.LITELLM_BASE_URL ?? 'http://localhost:4000'; }
  private get KEY()  { return SecretVault.get('LITELLM_API_KEY', { caller: 'system', module: 'LiteLLMAdapter' }) ?? 'sk-1234'; }
  private get MODEL(){ return process.env.LITELLM_MODEL ?? 'gpt-3.5-turbo'; }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    return openaiCompatChat(this.BASE, this.KEY, this.MODEL, messages, systemPrompt);
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    yield* openaiCompatStream(this.BASE, this.KEY, this.MODEL, messages, systemPrompt);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const res = await fetch(`${this.BASE}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.KEY}` },
      body: JSON.stringify({ model: this.MODEL, input: text }),
    });
    if (!res.ok) throw new Error(`LiteLLM embedding error ${res.status}`);
    const data = await res.json();
    return data.data?.[0]?.embedding ?? [];
  }

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.BASE}/health`);
      return r.ok;
    } catch { return false; }
  }
}
