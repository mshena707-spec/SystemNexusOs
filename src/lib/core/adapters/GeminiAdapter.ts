import { IAIProvider, ChatMessage } from '../interfaces/IAIProvider';
import { GoogleGenAI } from '@google/genai';
import { CircuitBreaker } from '../resilience/CircuitBreaker';

const aiCircuitBreaker = new CircuitBreaker(3, 30000); // Trip after 3 failures, test after 30s

const getFastAIClient = () => {
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
};

/**
 * Adapter ensuring Google Gemini strictly conforms to the universal IAIProvider interface.
 */
export class GeminiAdapter implements IAIProvider {
  providerId = 'gemini';

  async generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.length < 10 || key.includes("YOUR_")) {
      console.warn("[GeminiAdapter] GEMINI_API_KEY is missing or invalid placeholder.");
      throw new Error("API_KEY_INVALID: Gemini API Key is missing");
    }

    const ai = getFastAIClient();
    
    // Formatting system instruction and mapping the generic ChatMessage to Gemini specific format
    const formattedMessages = messages
      .filter(m => m.content != null && m.content.toString().trim() !== '')
      .map(m => ({
        role: m.role === 'assistant' || (m.role as any) === 'model' ? 'model' : 'user',
        parts: [{ text: m.content.toString() }]
      }));

    // If all messages got filtered out, provide a fallback
    if (formattedMessages.length === 0) {
      formattedMessages.push({
        role: 'user',
        parts: [{ text: 'Hello' }]
      });
    }

    return aiCircuitBreaker.execute(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: formattedMessages as any,
        config: {
          systemInstruction: systemPrompt ? systemPrompt : undefined
        }
      });
      return response.text || '';
    });
  }

  async *generateChatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.length < 10 || key.includes("YOUR_")) {
      console.warn("[GeminiAdapter] GEMINI_API_KEY is missing or invalid placeholder for stream.");
      throw new Error("API_KEY_INVALID: Gemini API Key is missing");
    }

    const ai = getFastAIClient();
    
    const formattedMessages = messages
      .filter(m => m.content != null && m.content.toString().trim() !== '')
      .map(m => ({
        role: m.role === 'assistant' || (m.role as any) === 'model' ? 'model' : 'user',
        parts: [{ text: m.content.toString() }]
      }));

    if (formattedMessages.length === 0) {
      formattedMessages.push({
        role: 'user',
        parts: [{ text: 'Hello' }]
      });
    }

    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: formattedMessages as any,
      config: {
        systemInstruction: systemPrompt ? systemPrompt : undefined
      }
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!process.env.GEMINI_API_KEY) {
      console.warn("[GeminiAdapter] GEMINI_API_KEY is missing for embeddings.");
      return new Array(768).fill(0);
    }
    const ai = getFastAIClient();
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });
    
    return response.embeddings?.[0]?.values || new Array(768).fill(0);
  }

  async ping(): Promise<boolean> {
     if (!process.env.GEMINI_API_KEY) return false;
     return !!getFastAIClient();
  }
}
