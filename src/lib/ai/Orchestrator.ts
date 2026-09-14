import { AIRequest, AIResponse } from './types';
import { LocalOfflineAgent } from './LocalAgent';
import { FreeAPIAgent } from './FreeAgent';
import { PaidAPIAgent } from './PaidAgent';
import { RiskEngine, RiskLevel } from './security/RiskEngine';
import { OutputFirewall } from './security/OutputFirewall';
import { SecurityControl } from './security/SecurityControl';
import { Telemetry, AIErrorType } from '../observability/Telemetry';
import { GlobalMetrics } from '../observability/MetricsEngine';
import { RuntimeDetector } from '../core/runtime/RuntimeDetector';
import { NexusMoEPredictor } from './nexus-core/MoEPredictor';
import { DeepReasoningEngine } from './nexus-core/DeepReasoningEngine';

// --- ENTERPRISE NEUROPLASTICITY & COGNITIVE ARCHITECTURE ---

import { FeatureStore } from '../core/config/FeatureStore';

export enum BotRole {
  CUSTOMER_HANDLER = 'customer_handler',
  MASTER_ANALYTICS = 'master_analytics',
  BACKUP_NODE = 'backup_node'
}

interface CognitiveProfile {
  urgency: number;         // 0 to 1
  complexity: number;      // 0 to 1
  emotionalState: number;  // 0 to 1
}

interface CognitiveContext {
  userId: string;
  isOffline: boolean;
  moePath: string;
  moeEnergy: number;
  costData: { totalCost: number, lastResetDate: string };
  profile: CognitiveProfile;
}

interface NeuralPathway {
  id: string;
  baseWeight: number;
  evaluateCapability(request: AIRequest, context: CognitiveContext): Promise<number>;
  execute(request: AIRequest, context: CognitiveContext): Promise<AIResponse>;
}

// In-memory trackers
const userQueryHistory = new Map<string, { count: number, lastQuery: string, timestamp: number }>();
const userCostTracker = new Map<string, { totalCost: number, lastResetDate: string }>();
const DAILY_COST_LIMIT = 9999.00; 

// --- THE PREFRONTAL CORTEX (Analysis & Profiling) ---
class PrefrontalCortex {
   static analyzeContext(prompt: string, moeEnergy: number): CognitiveProfile {
      const text = prompt.toLowerCase();
      
      // Calculate Urgency
      const urgentWords = ['asap', 'urgent', 'now', 'quickly', 'emergency', 'help'];
      const urgencyScore = urgentWords.filter(w => text.includes(w)).length > 0 ? 0.9 : 0.2;

      // Calculate Complexity (Abstractness & deep logic)
      const complexWords = ['analyze', 'synthesize', 'compare', 'debug', 'architecture', 'strategy', 'why', 'how'];
      const complexityByWords = complexWords.filter(w => text.includes(w)).length * 0.2;
      const complexityByLength = Math.min(prompt.length / 500, 1.0); // Longer prompts = typically more complex
      const complexityScore = Math.min(complexityByWords + complexityByLength + (moeEnergy / 100 * 0.5), 1.0);

      // Calculate Emotional State
      const emotionalWords = ['hate', 'ruined', 'broken', 'wrong', 'useless', 'terrible', 'frustrating'];
      const emotionalScore = emotionalWords.filter(w => text.includes(w)).length > 0 ? 1.0 : (moeEnergy > 80 ? 0.7 : 0.1);

      return {
         urgency: urgencyScore,
         complexity: complexityScore,
         emotionalState: emotionalScore
      };
   }
}

// --- NEUROPLASTICITY ENGINE (Hebbian plasticity) ---
// "Neurons that fire together, wire together."
class NeuroplasticityEngine {
   private static weights = new Map<string, number>();

   static getDynamicWeight(synapseId: string, baseWeight: number): number {
      if (!this.weights.has(synapseId)) {
         this.weights.set(synapseId, baseWeight);
      }
      return this.weights.get(synapseId)!;
   }

   // Strengthen the pathway due to success (Myelination)
   static reinforce(synapseId: string) {
      const current = this.weights.get(synapseId) || 1.0;
      this.weights.set(synapseId, Math.min(current + 0.15, 2.5)); // Max multiplier 2.5x
      console.log(`[Neuroplasticity] Reinforced pathway: ${synapseId} (New weight: ${this.weights.get(synapseId)?.toFixed(2)})`);
   }

   // Weaken the pathway due to failure or high friction (Synaptic Pruning)
   static penalize(synapseId: string) {
      const current = this.weights.get(synapseId) || 1.0;
      this.weights.set(synapseId, Math.max(current - 0.25, 0.1)); // Min multiplier 0.1x
      console.log(`[Neuroplasticity] Penalized pathway: ${synapseId} (New weight: ${this.weights.get(synapseId)?.toFixed(2)})`);
   }
}

// --- SPECIFIC NEURAL PATHWAYS (Synapses) ---

// 1. Brainstem / Cerebellum: Fast, offline, reflex-like local intelligence.
class BrainstemSynapse implements NeuralPathway {
  id = 'synapse_local_slm_brainstem';
  baseWeight = 1.0;
  
  async evaluateCapability(request: AIRequest, context: CognitiveContext): Promise<number> {
    if (!FeatureStore.isEnabled('enableOfflineBrainstem')) return 0.0;
    if (context.isOffline) return 1.0; 
    // If it's a simple, low-complexity reflex question, brainstem can handle it fast.
    if (context.profile.complexity < 0.3) return 0.5; 
    return 0.1;
  }
  
  async execute(request: AIRequest, context: CognitiveContext): Promise<AIResponse> {
    const response = await LocalOfflineAgent.process(request);
    if (!response || response.confidence < 0.3) throw new Error("[Brainstem] Cognitive capability exceeded by prompt complexity.");
    return response;
  }
}

// 2. Limbic System: Cloud-fast, responsive, handles general queries and emotions.
class LimbicSystemSynapse implements NeuralPathway {
  id = 'synapse_fast_cloud_limbic';
  baseWeight = 1.0;
  
  async evaluateCapability(request: AIRequest, context: CognitiveContext): Promise<number> {
    if (context.isOffline) return 0.0;
    // Fast cloud is great for moderate complexity or high urgency
    if (context.profile.complexity < 0.7 || context.profile.urgency > 0.8) return 0.8;
    return 0.4;
  }
  
  async execute(request: AIRequest, context: CognitiveContext): Promise<AIResponse> {
    return await FreeAPIAgent.process(request);
  }
}

// 3. Prefrontal Cortex Override: Deep reasoning, logic, high abstract thinking. Paid/Heavy models.
class PrefrontalSynapse implements NeuralPathway {
  id = 'synapse_deep_logic_prefrontal';
  baseWeight = 1.0;
  
  async evaluateCapability(request: AIRequest, context: CognitiveContext): Promise<number> {
    if (context.isOffline) return 0.0;
    if (context.costData.totalCost >= DAILY_COST_LIMIT) return 0.0; // Circuit Breaker
    
    // High emotional distress, high complexity, or direct MoE recommendation fires this strongly.
    if (context.profile.complexity >= 0.7 || context.profile.emotionalState > 0.8 || context.moePath === 'paid_expert') {
       return 1.0;
    }
    return 0.3;
  }
  
  async execute(request: AIRequest, context: CognitiveContext): Promise<AIResponse> {
    let response: AIResponse;
    if (context.moePath === 'paid_expert' || context.profile.complexity > 0.8) {
        response = await DeepReasoningEngine.executeDebate(request);
    } else {
        response = await PaidAPIAgent.process(request, { score: context.moeEnergy, reason: "Prefrontal High-Level Dispatch" });
    }
    context.costData.totalCost += response.costEstimate || 0.05;
    return response;
  }
}

/**
 * Enterprise Neuro-Router
 * Dynamically selects pathways using self-adjusting Plasticity Weights.
 */
class NeuroRouter {
   private pathways: NeuralPathway[] = [
      new PrefrontalSynapse(),
      new LimbicSystemSynapse(),
      new BrainstemSynapse()
   ];

   async dispatch(request: AIRequest, context: CognitiveContext): Promise<AIResponse> {
      // 1. Calculate raw capability scores
      const evaluations = await Promise.all(this.pathways.map(async (p) => {
         try {
            const rawScore = await p.evaluateCapability(request, context);
            const dynamicWeight = NeuroplasticityEngine.getDynamicWeight(p.id, p.baseWeight);
            return { pathway: p, finalScore: rawScore * dynamicWeight };
         } catch {
            return { pathway: p, finalScore: -1 };
         }
      }));

      // 2. Sort available neurons by highest excitation threshold (finalScore)
      evaluations.sort((a, b) => b.finalScore - a.finalScore);

      // 3. Execute cascading cascade with Hebbian Learning
      const errors: Error[] = [];

      for (const { pathway, finalScore } of evaluations) {
         if (finalScore <= 0) continue; // Neuron did not fire
         
         const pathName = pathway.id;
         console.log(`[NeuroRouter] Synapse firing: ${pathName} (Excitation: ${finalScore.toFixed(2)})`);
         
         try {
            const response = await pathway.execute(request, context);
            console.log(`[NeuroRouter] Successful resolution. Reinforcing synapse ${pathName}.`);
            if (FeatureStore.isEnabled('enableNeuroplasticity')) {
               NeuroplasticityEngine.reinforce(pathway.id); // Myelination
            }
            return response;
         } catch (err: any) {
            if (!(err.message?.includes('FREE_API_FAILED') || err.message?.includes('PAID_API_FAILED'))) {
               console.warn(`[NeuroRouter] Action potential failed at ${pathName}. Pruning synapse...`);
            }
            if (FeatureStore.isEnabled('enableNeuroplasticity')) {
               NeuroplasticityEngine.penalize(pathway.id); // Pruning
            }
            errors.push(err);
         }
      }

      // If all biological equivalents fail, drop down to the pure reflexive survival baseline.
      console.error("[NeuroRouter] Complete cognitive failure. Entering survival reflex mode.");
      return {
        text: `[সিস্টেম অ্যালার্ট - கগনিটিভ বাইপাস]: আমার সমস্ত নিউরাল পাথওয়ে (ক্লাউড এবং লোকাল) বর্তমানে রেসপন্স দিতে পারছে না। এটি একটি ইন্টারনেট সংযোগ সমস্যা বা API Key Missing হতে পারে। দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন বা সেটিংস থেকে আপনার কনফিগারেশন চেক করুন। (API Key: ${process.env.GEMINI_API_KEY ? 'Present' : 'Missing'})`,
        tierUsed: 'local_offline', costEstimate: 0, confidence: 0, processingTimeMs: 1, modelName: 'Nexus-Brainstem-Survival'
      };
   }
}

/**
 * The Universal Multi-AI Brain Orchestrator (Phase N - Neuroplasticity Engine)
 */
export class MultiAIBrain {
  private static router = new NeuroRouter();

  static async execute(request: AIRequest): Promise<AIResponse> {
    const trace = Telemetry.startTrace('MultiAIBrain.execute', request.userId || 'anonymous', request.agentRole);
    request.trace = trace;
    const rootSpan = trace.startSpan('Orchestrator.execute');
    const startTime = Date.now();

    console.log(`[Multi-AI Brain] Neuro-processing started for agent: ${request.agentRole}`);
    
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    const userKey = request.userId || 'anonymous';
    const history = userQueryHistory.get(userKey);
    let costData = userCostTracker.get(userKey);

    // --- SECURITY LAYER 0: EMERGENCY KILL SWITCH ---
    if (SecurityControl.isEmergencyModeActive()) {
      trace.endSpan(rootSpan.id, 'error', 'Emergency mode active');
      await trace.endTrace('error');
      return this.createSecurityFallback("System is currently in emergency read-only mode.");
    }

    // --- SECURITY LAYER 1: RISK ENGINE ---
    const riskAssessment = RiskEngine.evaluate(request);
    if (riskAssessment.level === RiskLevel.CRITICAL) {
      this.logSecurityEvent(userKey, 'CRITICAL_RISK_BLOCKED', JSON.stringify(riskAssessment.flags));
      return this.createSecurityFallback("Your request has been blocked due to security policies.");
    }

    // Initialize daily cost tracker
    if (!costData || costData.lastResetDate !== today) {
      costData = { totalCost: 0, lastResetDate: today };
      userCostTracker.set(userKey, costData);
    }

    // --- LOOP PREVENTION (Anti-Drain System) ---
    if (history && history.lastQuery === request.prompt && (now - history.timestamp) < 60000) {
      history.count += 1;
      if (history.count >= 3) {
        console.warn(`[Multi-AI Brain] COGNITIVE LOOP DETECTED for user ${userKey}`);
        return { 
          text: "I noticed we might be stuck in a loop. I have flagged this chat for human review.", 
          tierUsed: 'local_offline', costEstimate: 0, confidence: 1, processingTimeMs: 1, modelName: 'Loop-Preventer-Shield' 
        };
      }
    } else {
      userQueryHistory.set(userKey, { count: 1, lastQuery: request.prompt, timestamp: now });
    }

    // --- CONTEXT GENERATION (Prefrontal Evaluation) ---
    const isOffline = !RuntimeDetector.hasInternetConnection();

    // 1. Fetch Hyper-Compressed Vault Memory for Agent RAG
    let memoryContext = "";
    if (FeatureStore.isEnabled('enableHyperCompression')) {
        try {
           const { MemoryCore } = await import('../core/MemoryCore');
           memoryContext = await MemoryCore.retrieveContextForAgent(userKey, 3);
        } catch(e) {}
    }
    
    const augmentedPrompt = memoryContext ? `${memoryContext}\n\n[Current User Prompt]: ${request.prompt}` : request.prompt;
    request.prompt = augmentedPrompt;
    
    // Feature Gate check for MoE Predictor
    const moePrediction = FeatureStore.isEnabled('enableMoEPredictor') 
      ? NexusMoEPredictor.predictOptimalPath(request.prompt, request.history?.length || 0, request.agentRole)
      : { path: 'standard', energy: 50 };
    
    // Evaluate the psychological context
    const profile = FeatureStore.isEnabled('enableEmotionalResonance')
      ? PrefrontalCortex.analyzeContext(request.prompt, moePrediction.energy)
      : { urgency: 0.5, complexity: 0.5, emotionalState: 0.5 };

    const context: CognitiveContext = {
       userId: userKey,
       isOffline,
       moePath: moePrediction.path,
       moeEnergy: moePrediction.energy,
       costData,
       profile
    };

    // --- TRIGGER NEURO-ROUTER ---
    let finalResponse: AIResponse;
    if (FeatureStore.isEnabled('enableCognitiveRouting')) {
       finalResponse = await this.router.dispatch(request, context);
    } else {
       // Legacy direct pass-through if cognitive routing is disabled
       finalResponse = await FreeAPIAgent.process(request).catch(() => ({
          text: "Standard routing failed and Cognitive Routing is disabled.",
          tierUsed: 'local_offline', costEstimate: 0, confidence: 0, processingTimeMs: 1, modelName: 'Fallback'
       }));
    }

    // --- OUTPUT SANITIZATION ---
    finalResponse.text = await OutputFirewall.scan(finalResponse.text, false).then(res => res.sanitizedOutput);

    // --- ASYNC BACKGROUND INSIGHT ANALYSIS (Subconscious Processing) & COMPRESSION VAULT ---
    if (finalResponse.text) {
      // 1. Vault Hyper-compression
      if (FeatureStore.isEnabled('enableHyperCompression')) {
          import('../core/MemoryCore').then(({ MemoryCore }) => {
              MemoryCore.packAndArchive({
                 userId: userKey,
                 role: request.agentRole,
                 prompt: request.prompt,
                 response: finalResponse!.text,
              }, { source: 'MultiAIBrain_Inference', context: profile });
          }).catch(() => {});
      }

      // 2. Personalization Extraction
      if (userKey !== 'anonymous' && userKey !== 'offline_user') {
        import('./PersonalizationEngine').then(({ PersonalizationEngine }) => {
          PersonalizationEngine.extractAndSavePreferences(userKey, [
              { role: 'user', content: request.prompt },
              { role: 'assistant', content: finalResponse!.text } 
          ]).catch(err => console.error("Subconscious extraction failed:", err));
        }).catch(() => {});
      }
    }

    GlobalMetrics.track({
        eventType: 'ai_inference', durationMs: Date.now() - startTime, success: true,
        metadata: { tier: finalResponse.tierUsed, role: request.agentRole, complexity: profile.complexity }
    });

    trace.endSpan(rootSpan.id, 'success');
    await trace.endTrace('success');

    return finalResponse;
  }

  private static createSecurityFallback(reason: string): AIResponse {
    return {
      text: reason, tierUsed: 'local_offline', costEstimate: 0, confidence: 1, processingTimeMs: 1, modelName: 'Security-Firewall'
    };
  }

  private static logSecurityEvent(userId: string, eventType: string, details: string) {
    console.warn(`[Security Logged] User: ${userId}, Event: ${eventType}, Details: ${details}`);
  }
}
