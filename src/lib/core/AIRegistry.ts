import { z } from 'zod';
import { CostGuardEngine } from '../business/CostGuardEngine';
import { DecisionFusionEngine } from '../intelligence/DecisionFusionEngine';

export type AIModelType = 'gemini' | 'openai' | 'claude' | 'llama' | 'local';

export interface AIProviderConfig {
  id: string;
  type: AIModelType;
  modelName: string;
  apiKey?: string;
  costPer1kTokens: number;
  latencyMsEstimate: number;
  isActive: boolean;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  contextWindowLength?: number;
  speed?: 'fast' | 'balanced' | 'slow';
  intelligence?: 'basic' | 'advanced' | 'expert';
}

export type AIRequestParams = {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  complexity?: 'low' | 'medium' | 'high';
};

export type AIResponse = {
  content: string;
  providerId: string;
  tokensUsed: number;
  costIncurred: number;
  latencyMs: number;
};

/**
 * PHASE 2: OMNI-AI + AUTO-INTEGRATION SYSTEM
 * Universal AI Adapter Layer capable of dynamically routing across models.
 */
export class AIRegistry {
  private static providers: Map<string, AIProviderConfig> = new Map();

  static registerProvider(config: AIProviderConfig) {
    this.providers.set(config.id, config);
  }

  static getActiveProviders(): AIProviderConfig[] {
    return Array.from(this.providers.values()).filter(p => p.isActive);
  }

  /**
   * AI Router: Dynamic cost-aware routing
   * Selects best model based on task complexity and active models
   */
  static selectBestProvider(complexity: 'low' | 'medium' | 'high'): AIProviderConfig | null {
    const active = this.getActiveProviders();
    if (active.length === 0) return null;

    if (complexity === 'low') {
      // Phase 22: Auto-optimization merged to CostGuardEngine
      return CostGuardEngine.selectCostEffectiveModel(active) || active[0];
    } else if (complexity === 'high') {
      // Return smartest
      return active.reduce((prev, curr) => (prev.costPer1kTokens > curr.costPer1kTokens ? prev : curr));
    }
    return active[0];
  }

  /**
   * Multi-AI Parallel Execution
   * Runs the prompt through multiple active models and returns all results
   */
  static async executeParallel(params: AIRequestParams, requiredVotes: number = 2): Promise<AIResponse> {
    const activeTasks = this.getActiveProviders().slice(0, requiredVotes).map(async provider => {
      // Simulation of parallel AI execution
      const t0 = performance.now();
      await new Promise(res => setTimeout(res, provider.latencyMsEstimate));
      return {
        content: `Response from ${provider.modelName}`,
        providerId: provider.id,
        tokensUsed: 150,
        costIncurred: 150 * (provider.costPer1kTokens / 1000),
        latencyMs: performance.now() - t0
      };
    });

    const results = await Promise.all(activeTasks);
    // Phase 26: Select best via Consensus Engine
    return DecisionFusionEngine.selectBestAnswer(results);
  }
}

// Initial Registration of defaults
AIRegistry.registerProvider({
  id: 'sys-gemini',
  type: 'gemini',
  modelName: 'gemini-1.5-pro',
  costPer1kTokens: 0.005,
  latencyMsEstimate: 800,
  isActive: true,
});
AIRegistry.registerProvider({
  id: 'sys-gpt4',
  type: 'openai',
  modelName: 'gpt-4o',
  costPer1kTokens: 0.015,
  latencyMsEstimate: 1200,
  isActive: false, // Activated via IntegrationManager
});
