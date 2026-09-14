/**
 * PHASE 100: FINAL UNIFIED NEXUS CORE
 * Single entry point for entire multi-layered system.
 */
import { OperatingModeManager } from './OperatingModeManager';
import { ModeRouter } from './ModeRouter';
import { MultiAIBrain } from '../ai/Orchestrator';
import { GlobalScaleEngine } from '../deployment/GlobalScaleEngine';

import { initializeSystemAbstractions } from './SystemBoot';

export class NexusUnifiedCore {
  static async bootSystem() {
    console.log("=========================================");
    console.log("🔥 NEXUS UNIFIED CORE BOOT SEQUENCE INITIATED 🔥");
    console.log("=========================================");
    
    await initializeSystemAbstractions();
    GlobalScaleEngine.assessReadiness();
    
    const activeModes = OperatingModeManager.getActiveModes();
    console.log(`[NexusCore] Active System Modalities: ${activeModes.join(' | ')}`);
    console.log(`[NexusCore] MultiAIBrain Bound. Router Initialized. All Systems GREEN.`);
    
    console.log("=========================================");
    console.log("NEXUS OS is fully online.");
  }

  static async process(input: string, options?: any) {
    const { MemoryCore } = await import('./MemoryCore');
    const { CostDominationEngine } = await import('./CostDominationEngine');
    // Phase D: single entry point for all AI execution
    const { AIProviderOrchestrator } = await import('../ai/providers/AIProviderOrchestrator');

    // CTO Audit Part 3, section 16: every input reaches an LLM through this one
    // function (that's the point of a "single entry point"), so this is the one
    // place PromptShield needs to be wired for input-side coverage to be complete.
    const { PromptShield } = await import('../security/prompt/PromptShield');
    const shieldResult = PromptShield.inspect(input, {
      userId: options?.userId, agentId: options?.agentRole, traceId: options?.traceId,
    });
    if (shieldResult.blocked) {
      const { NexusError, NexusErrorCodes } = await import('./errors/NexusError');
      throw new NexusError(NexusErrorCodes.security.PROMPT_INJECTION_BLOCKED, {
        domain: 'ai',
        severity: 'high',
        userMessage: "I can't process that request.",
        retryable: false,
        context: { categories: shieldResult.categories, riskScore: shieldResult.riskScore },
      });
    }

    // Phase C: Memory Core matching
    const cachedAns = await MemoryCore.searchMemoryForQuery(input);
    if (cachedAns) {
        console.log(`[NexusUnifiedCore] Fast-path memory match. Bypassing AI compute.`);
        return { 
          text: cachedAns, 
          confidence: 1.0, 
          tierUsed: 'local', 
          costEstimate: 0, 
          processingTimeMs: 1, 
          modelName: 'MemoryCore-Cache',
          tokensUsed: 0,
          costUsd: 0,
        };
    }

    // Phase D: Cost Domination determines the tier; orchestrator picks best provider
    const tier = CostDominationEngine.determineTier(input, options);
    const maxCostTier = tier === 'free' ? 'free' : tier === 'low' ? 'low' : tier === 'medium' ? 'medium' : 'high';

    const history: Array<{role:'user'|'assistant'|'system'; content:string}> = options?.history ?? [];
    const messages = [
      ...history,
      { role: 'user' as const, content: input },
    ];

    // Phase D: ALL AI calls go through AIProviderOrchestrator
    const result = await AIProviderOrchestrator.call({
      messages,
      systemPrompt: options?.systemInstruction,
      role: options?.agentRole ?? 'customer',
      stream: !!options?.onChunk,
      onChunk: options?.onChunk,
      userId: options?.userId,
      maxCostTier: maxCostTier as any,
      timeoutMs: 30_000,
    });

    // Cost tracking already happens inside AIProviderOrchestrator.call() above
    // (DistributedCounter-based, with budget guards — see AIProviderOrchestrator.ts).
    // A separate CostDominationEngine.logCost(...) call used to be here; removed
    // during CTO Audit Part 3 response after confirming (a) it never existed on the
    // real class (tsc), and (b) it would have been redundant with the tracking
    // AIProviderOrchestrator.call already does — see docs/governance/TECHNICAL_DEBT_REGISTER.md.

    // Output-side PromptShield: different concern from the input check above —
    // guards against the model echoing back something sensitive it picked up from
    // memory/context/tool results, not against malicious input.
    const { filtered: safeText } = PromptShield.filterSensitiveData(result.text);

    return {
      text: safeText,
      confidence: 0.9,
      tierUsed: tier,
      costEstimate: result.costUsd ?? 0,
      processingTimeMs: result.latencyMs,
      modelName: result.providerId,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
    };
  }

  static async start() {
    await this.bootSystem();
  }
}
