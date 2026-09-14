/**
 * EXAMPLE PLUGIN: Loyalty Advisor
 *
 * A real, working plugin — not a template with TODOs — proving the pattern in
 * PluginRegistry.ts actually works end to end. Deliberately a genuinely new
 * capability (none of the 6 existing SpecialistAgents cover personalized loyalty
 * perk suggestions) rather than a wrapper around something that already exists,
 * so this demonstrates real net-new extensibility, not a re-packaging exercise.
 *
 * Gated behind a feature flag on purpose, to prove that path works too —
 * ENABLE_LOYALTY_ADVISOR is registered in FeatureFlags.ts's KNOWN_FLAGS with
 * defaultValue: false, so this plugin ships OFF until someone flips it via
 * FeatureFlags.set('ENABLE_LOYALTY_ADVISOR', true, '<admin-id>').
 */

import { AgentInput, AgentOutput } from '../../lib/core/registry/AgentRegistry';
import { BaseAgent } from '../../lib/orchestration/agents/SpecialistAgents';
import { NexusUnifiedCore } from '../../lib/core/NexusUnifiedCore';
import { LoyaltyEngine } from '../../lib/loyalty/LoyaltyEngine';
import type { NexusPlugin } from '../PluginRegistry';

class LoyaltyAdvisorAgent extends BaseAgent {
  agentId = 'loyalty-advisor-001';
  role = 'loyalty_advisor';

  async execute(input: AgentInput): Promise<AgentOutput> {
    const { customerId } = input.context || {};
    if (!customerId) {
      return { success: false, result: null, confidence: 0, error: 'customerId is required' };
    }

    const balance = await LoyaltyEngine.getBalance(customerId);
    const redeemableValue = LoyaltyEngine.pointsToValue(balance.currentPoints);

    const prompt = `A loyalty program member has ${balance.currentPoints} points (worth ~$${redeemableValue.toFixed(2)}) at tier "${balance.tier}". Suggest one short, specific, genuinely useful perk or redemption idea for them (max 25 words). Be concrete, not generic.`;
    const result = await NexusUnifiedCore.process(prompt, { agentRole: 'loyalty_advisor' });

    return this.buildOutput(true, {
      suggestion: result.text,
      points: balance.currentPoints,
      redeemableValue,
      tier: balance.tier,
    });
  }
}

export const loyaltyAdvisorPlugin: NexusPlugin = {
  id: 'loyalty-advisor',
  name: 'Loyalty Advisor',
  version: '1.0.0',
  description: 'Suggests personalized loyalty-point redemption ideas per customer.',
  featureFlag: 'ENABLE_LOYALTY_ADVISOR',
  agents: [
    {
      id: 'loyalty-advisor',
      agent: new LoyaltyAdvisorAgent(),
      capabilities: {
        role: 'loyalty_advisor',
        capabilities: ['loyalty_perk_suggestion'],
        maxConcurrent: 5,
        requiresApproval: false,
        canUseTools: [],
        memoryAccess: ['read'],
        priority: 3,
        version: '1.0.0',
        description: 'Suggests personalized loyalty redemption ideas.',
      },
    },
  ],
};
