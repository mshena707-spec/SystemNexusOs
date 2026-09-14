import { AIRequest, AIResponse } from '../types';
import { PaidAPIAgent } from '../PaidAgent';
import { GlobalMetrics } from '../../observability/MetricsEngine';

/**
 * DEEP REASONING ENGINE (Mixture of Agents / Cross-Agent Debate)
 * Restores and dramatically improves the legacy 'reasonBetweenAgents' from gemini.ts.
 * 
 * Instead of asking one model to solve a complex problem, this engine spins up 
 * multiple specialized personas (e.g., Customer Support vs. Security/Technical) 
 * in parallel, forces them to analyze the request independently, and synthesizes 
 * the optimal response based on algorithmic confidence scoring.
 */
export class DeepReasoningEngine {
  public static async executeDebate(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    console.log(`[DeepReasoning] Initiating Cross-Agent Debate for prompt length: ${request.prompt.length}`);

    // Create parallel isolated reality requests for different personas
    const requestCustomer: AIRequest = { ...request, agentRole: 'customer' };
    const requestSecurity: AIRequest = { ...request, agentRole: 'security' };

    try {
      // Execute parallel generations
      const [resCustomer, resSecurity] = await Promise.all([
        PaidAPIAgent.process(requestCustomer, { score: 95, reason: 'Debate Node A - Empathy' }),
        PaidAPIAgent.process(requestSecurity, { score: 95, reason: 'Debate Node B - Logic' })
      ]);

      console.log(`[DeepReasoning] Debate concluded. Customer Conf: ${resCustomer.confidence}, Security Conf: ${resSecurity.confidence}`);

      let bestResponse: AIResponse;
      let winningPersona = '';

      // Algorithmic synthesis (Legacy logic restored and upgraded)
      if (resCustomer.confidence >= resSecurity.confidence) {
        bestResponse = resCustomer;
        winningPersona = 'Empathy/Customer';
      } else {
        bestResponse = resSecurity;
        winningPersona = 'Logic/Security';
      }

      // Add architectural tracking metadata
      bestResponse.modelName = `${bestResponse.modelName}-Ensemble-MoA`;
      bestResponse.tierUsed = 'paid_expert' as any;
      
      // We combine the costs since we used two API calls
      bestResponse.costEstimate = (resCustomer.costEstimate || 0) + (resSecurity.costEstimate || 0);
      bestResponse.processingTimeMs = Date.now() - start;

      // Optional: Prepend a systemic note for transparency if desired, or keep it clean
      // bestResponse.text = `[Cross-Agent Synthesis: ${winningPersona} Node Selected]\n\n${bestResponse.text}`;

      GlobalMetrics.track({
        eventType: 'ai_inference',
        durationMs: bestResponse.processingTimeMs,
        success: true,
        metadata: { engine: 'DeepReasoningEngine', winner: winningPersona }
      });

      return bestResponse;

    } catch (error) {
      console.error("[DeepReasoning] Fatal error in agent debate:", error);
      throw new Error("DeepReasoningEngine failed to synthesise a response.");
    }
  }
}
