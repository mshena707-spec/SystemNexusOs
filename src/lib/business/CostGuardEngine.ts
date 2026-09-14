/**
 * PHASE 73: COST HARD LIMIT CONTROLLER
 */
import { AIProviderConfig } from '../core/AIRegistry';

export class CostGuardEngine {
  private static dailyUsage = 0;
  private static dailyLimit = 100; // $100 per day example budget

  static trackCost(costIncurred: number) {
    this.dailyUsage += costIncurred;
  }

  static isThresholdExceeded(): boolean {
    if (this.dailyUsage > this.dailyLimit) {
      console.warn(`[CostGuard] CRITICAL: Daily cost limit exceeded ($${this.dailyUsage.toFixed(2)} / $${this.dailyLimit}). Hard lockdown to LocalModelAdapter initiated.`);
      return true;
    }
    return false;
  }

  static getCostForecast(): number {
    // Basic linear 30-day forecast based on daily
    return this.dailyUsage * 30;
  }

  // Merged from CostOptimizer
  static selectCostEffectiveModel(models: AIProviderConfig[], minimumCapabilitiesRequired: boolean = false): AIProviderConfig | null {
    if (!models || models.length === 0) return null;
    
    // Auto-sort by lowest cost
    const sorted = [...models].sort((a, b) => a.costPer1kTokens - b.costPer1kTokens);
    
    console.log(`[CostAuthority] Selected most cost-effective model: ${sorted[0].modelName} ($${sorted[0].costPer1kTokens}/1k tokens)`);
    return sorted[0];
  }
}
