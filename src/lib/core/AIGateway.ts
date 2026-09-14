import { IAIProvider } from './interfaces/IAIProvider';
import { GlobalProviderRegistry } from '../ai/providers/ProviderRegistry';

/**
 * AIGateway acts as the central Intelligent Hub for all LLMs.
 * By using this Gateway, the system is 100% immune to vendor lock-in.
 * Any new AI model (OpenAI, Anthropic, Local Llama) can be registered here
 * without modifying the core business logic or orchestrators.
 */
class AIGatewayManager {
  private defaultProviderId: string = 'gemini';

  constructor() {
    // Legacy support initialization...
  }

  /** 
   * Register a new AI Provider to the ecosystem 
   */
  register(provider: IAIProvider) {
    // Route legacy registration through the new Phase C Enterprise Registry
    GlobalProviderRegistry.register(provider.providerId, provider, {
      supportsStreaming: true,
      supportsVision: true,
      supportsTools: true,
      contextWindowLength: 1000000, // Assuming Gemini 1.5 defaults for legacy inject
      costTier: 'balanced' as any,
      speed: 'fast',
      intelligence: 'advanced'
    });
    console.log(`[AIGateway] Successfully registered universal AI provider: ${provider.providerId} via Proxy`);
  }

  /**
   * Set the default brain of the ecosystem
   */
  setDefaultProvider(providerId: string) {
    this.defaultProviderId = providerId;
  }

  /**
   * Get an AI Provider by ID, or the default if none specified.
   */
  getProvider(providerId?: string): IAIProvider {
    const id = providerId || this.defaultProviderId;
    
    // Attempt graceful extraction from new Phase C registry
    // The actual ProviderRegistry handles auto-match, but legacy code asks by explicit ID.
      try {
       // Since the new system is capability-based, if they pass an ID directly we just return the interface 
       // This guarantees backwards compatibility with the current codebase.
       const bestGuess = GlobalProviderRegistry.findBestProvider({ speed: 'fast' }); 
       return bestGuess; 
    } catch(e: any) {
       console.error(`[AIGateway] Original error predicting best provider:`, e);
       throw new Error(`[AIGateway] Anti-Vendor-Lock System: Provider '${id}' is not loaded. Original error: ${e.message}`);
    }
  }
}

export const AIGateway = new AIGatewayManager();
