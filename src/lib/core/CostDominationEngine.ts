/**
 * COST DOMINATION ENGINE
 * Determines the best AI tier for a given task cost/quality tradeoff.
 * Now delegates to GlobalProviderRegistry — no duplicate logic.
 */

import { GlobalProviderRegistry, ProviderRequirements, CostTier } from '../ai/providers/ProviderRegistry';
import { IAIProvider } from './interfaces/IAIProvider';

export type TaskComplexity = 'simple' | 'moderate' | 'complex' | 'expert';

const COMPLEXITY_MAP: Record<TaskComplexity, ProviderRequirements> = {
  simple:   { maxCostTier: 'free',   minIntelligence: 'basic',        preferSpeed: true },
  moderate: { maxCostTier: 'low',    minIntelligence: 'intermediate',  preferSpeed: true },
  complex:  { maxCostTier: 'medium', minIntelligence: 'advanced' },
  expert:   { maxCostTier: 'high',   minIntelligence: 'expert' },
};

export class CostDominationEngine {
  /** Classify message complexity and return the optimal provider */
  static getOptimalProvider(message: string, role?: string): IAIProvider {
    const complexity = this.classifyComplexity(message);
    const requirements: ProviderRequirements = { ...COMPLEXITY_MAP[complexity], role };
    return GlobalProviderRegistry.findBestProvider(requirements);
  }

  static classifyComplexity(message: string): TaskComplexity {
    const m = message.toLowerCase();
    const len = message.length;

    if (len > 500 ||
        m.includes('analyze') || m.includes('predict') ||
        m.includes('generate report') || m.includes('compare') ||
        m.includes('strategy') || m.includes('research')) {
      return 'expert';
    }
    if (len > 200 ||
        m.includes('explain') || m.includes('write') ||
        m.includes('create') || m.includes('plan') ||
        m.includes('summarize')) {
      return 'complex';
    }
    if (len > 80 ||
        m.includes('what is') || m.includes('how do') ||
        m.includes('when') || m.includes('where')) {
      return 'moderate';
    }
    return 'simple';
  }

  /** Get health summary of all cost tiers */
  static getTierSummary() {
    return GlobalProviderRegistry.getHealthSummary();
  }

  /**
   * Added during CTO Audit Part 3 response (2026-07-19): NexusUnifiedCore.process —
   * the single central entry point for all AI execution in this system — was already
   * calling CostDominationEngine.determineTier(input, options), which never existed
   * on this class (confirmed by tsc). This class's own header says it "now delegates
   * to GlobalProviderRegistry — no duplicate logic," which strongly suggests
   * determineTier existed before that refactor and the one remaining caller was never
   * updated. This wraps the real classifyComplexity() + COMPLEXITY_MAP that already
   * do this exact mapping, rather than reintroducing duplicate logic.
   */
  static determineTier(message: string, _options?: unknown): CostTier {
    const complexity = this.classifyComplexity(message);
    return COMPLEXITY_MAP[complexity].maxCostTier ?? 'medium';
  }
}
