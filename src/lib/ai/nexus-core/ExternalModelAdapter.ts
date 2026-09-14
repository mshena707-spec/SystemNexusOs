/**
 * NEXUS EXTERNAL MODEL ADAPTER (Bring Your Own Model - BYOM)
 * Allows plugging in any 3rd-party company's model (Local Ollama, DeepSeek, Anthropic, etc.)
 * directly into the Nexus Core without losing our proprietary routing control.
 */
export interface ExternalModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol: 'openai_compatible' | 'anthropic' | 'ollama' | 'custom';
}

export class ExternalModelAdapter {
  private static registeredModels: Map<string, ExternalModelConfig> = new Map();

  public static registerModel(config: ExternalModelConfig) {
    this.registeredModels.set(config.id, config);
    console.log(`[Nexus BYOM Adapter] Successfully connected 3rd-party model: ${config.name} via ${config.baseUrl}`);
  }

  public static getRegisteredModels(): ExternalModelConfig[] {
    return Array.from(this.registeredModels.values());
  }

  /**
   * Executes a prompt against a dynamically injected company model
   */
  public static async execute(modelId: string, prompt: string): Promise<string> {
    const config = this.registeredModels.get(modelId);
    if (!config) throw new Error(`[Nexus BYOM] Model ${modelId} is not connected.`);

    console.log(`[Nexus BYOM] Routing query explicitly through ${config.name}...`);
    
    // Abstracted Fetch logic for OpenAI-compatible APIs (like Local Ollama, DeepSeek)
    if (config.protocol === 'openai_compatible' || config.protocol === 'ollama') {
      try {
        const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            model: config.id, // For Ollama, this maps to the local model name (e.g., 'llama3')
            temperature: 0.7
          })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "[Connected Model Returned Empty Response]";
      } catch (err: any) {
        throw new Error(`[Nexus BYOM] Failed to execute connected model: ${err.message}`);
      }
    }

    throw new Error(`[Nexus BYOM] Protocol ${config.protocol} is not fully implemented yet.`);
  }
}
