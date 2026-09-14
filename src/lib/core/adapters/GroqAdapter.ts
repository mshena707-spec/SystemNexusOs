import { IAIProvider, ChatMessage } from '../interfaces/IAIProvider';

export class GroqAdapter implements IAIProvider {
  providerId = 'groq';
  private apiKey: string;
  private model: string;

  constructor(model = 'llama-3.1-8b-instant') {
    this.apiKey = (typeof process !== 'undefined' ? process.env.GROQ_API_KEY : '') || '';
    this.model = model;
  }

  private buildMessages(messages: ChatMessage[], systemPrompt?: string) {
    const out: { role: string; content: string }[] = [];
    if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => out.push({ role: m.role, content: m.content }));
    return out;
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) {
      console.warn('[GroqAdapter] GROQ_API_KEY not set');
      return '';
    }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: this.buildMessages(messages, systemPrompt) }),
    });
    if (!res.ok) throw new Error(`Groq API Error: ${await res.text()}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
    if (!this.apiKey) { yield ''; return; }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: this.buildMessages(messages, systemPrompt),
        stream: true,
      }),
    });

    if (!res.ok || !res.body) throw new Error(`Groq stream error: ${await res.text()}`);

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
        const trimmed = line.replace(/^data: /, '').trim();
        if (!trimmed || trimmed === '[DONE]') continue;
        try {
          const chunk = JSON.parse(trimmed);
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch (_) {}
      }
    }
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    // Groq doesn't support embeddings — use OpenAI or HuggingFace for embeddings
    return new Array(768).fill(0);
  }
}
