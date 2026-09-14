export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface IAIProvider {
  /** Uniquely identifies the LLM vendor (e.g. 'gemini', 'openai', 'anthropic', 'huggingface') */
  providerId: string;
  
  /** Generates a text response based on a chat history */
  generateChat(messages: ChatMessage[], systemPrompt?: string): Promise<string>;
  
  /** Generates a text response stream based on a chat history */
  generateChatStream?(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string, void, unknown>;
  
  /** Generates a vector embedding for a given text string */
  generateEmbedding(text: string): Promise<number[]>;
  
  /** Optional health check for the provider */
  ping?(): Promise<boolean>;
}
