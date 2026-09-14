import { IAIProvider, ChatMessage } from '../interfaces/IAIProvider';

export class HuggingFaceAdapter implements IAIProvider {
  providerId = 'huggingface';
  private apiKey: string;
  private model: string;

  constructor(model: string = 'meta-llama/Llama-3.2-3B-Instruct') {
    this.apiKey = process.env.HUGGINGFACE_API_KEY || '';
    this.model = model;
  }

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    if (!this.apiKey) {
      console.warn("HuggingFace API key not configured, falling back to mock.");
      return "I am a HuggingFace free tier model. Please configure HUGGINGFACE_API_KEY in the environment.";
    }

    let prompt = "";
    if (systemPrompt) prompt += `<|system|>\n${systemPrompt}</s>\n`;
    for (const msg of messages) {
       prompt += `<|${msg.role === 'user' ? 'user' : 'assistant'}|\n${msg.content}</s>\n`;
    }
    prompt += `<|assistant|>\n`;

    const response = await fetch(`https://api-inference.huggingface.co/models/${this.model}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 500, return_full_text: false } })
    });

    if (!response.ok) {
       throw new Error(`HuggingFace API Error: ${response.statusText}`);
    }

    const json = await response.json();
    return json[0]?.generated_text || "Error processing HuggingFace response";
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
      yield await this.generateChat(messages, systemPrompt); // Basic fallback for streaming
  }

  async generateEmbedding(text: string): Promise<number[]> {
     const response = await fetch(`https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2`, {
         method: "POST",
         headers: {
             "Authorization": `Bearer ${this.apiKey}`,
             "Content-Type": "application/json"
         },
         body: JSON.stringify({ inputs: [text] })
     });
     if (!response.ok) {
       console.warn('[HuggingFaceAdapter] embedding API error — returning null (caller must handle)');
       return null as any;
     }
     const resData = await response.json();
     return resData[0] || null;
  }
}
