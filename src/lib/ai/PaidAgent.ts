import { AIRequest, AIResponse } from './types';
import { SecureToolRouter } from './security/SecureToolRouter';
import { AIErrorType } from '../observability/Telemetry';

/**
 * Represents the Paid API Tier.
 * Uses highly capable, expensive models (like Gemini 1.5 Pro, GPT-4o, Claude 3 Opus)
 * for complex reasoning, coding, deep analysis, and autonomous task execution.
 * Abstracted via AIGateway to prevent vendor locking.
 */
export class PaidAPIAgent {
  static async process(request: AIRequest, evaluation?: any): Promise<AIResponse> {
    const start = Date.now();
    const trace = request.trace;
    const isHeavyReasoning = evaluation && evaluation.score > 85; 
    
    // Choose tracking span and simulated cost dynamically based on complexity
    const tierName = isHeavyReasoning ? 'PaidAgent.Large.process' : 'PaidAgent.Small.process';
    const span = trace?.startSpan(tierName, { type: 'gateway' });

    try {
      if (span) trace?.addSpanEvent(span.id, 'Gateway Request Started');
      
      const { GlobalProviderRegistry } = await import('./providers/ProviderRegistry');
      let ai = GlobalProviderRegistry.findBestProvider({ costTier: 'high' });

      const baseInstruction = request.systemInstruction || `You are an expert-level ${request.agentRole} AI. You must handle complex reasoning, deep analysis, and provide highly accurate, comprehensive responses.`;
      
      const systemInstruction = `${baseInstruction}
          
CRITICAL INSTRUCTION - AUTONOMOUS TASK EXECUTION:
If the user asks you to perform a complex task (e.g., "bring me a glass of water", "set up a new project", "analyze this data"), you MUST NOT just say "I can't do that" or ask for step-by-step instructions.
Instead, you must:
1. Infer the necessary underlying steps required to complete the task based on your extensive knowledge.
2. Break down the task into a logical sequence of actions.
3. If you have the tools to execute those actions, do so.
4. If you are simulating the execution (like fetching water), explain the steps you are taking conceptually to fulfill the user's request.
Always aim to fulfill the user's high-level intent by managing the low-level details yourself.`;

      const messages = [...(request.history || [])];
      messages.push({ role: 'user', content: request.prompt });

      let text = "";
      
      let attempts = 0;
      let success = false;

      while (!success && attempts < 3) {
         try {
            if (request.onChunk && ai.generateChatStream) {
               try {
                 const stream = ai.generateChatStream(messages as any, systemInstruction);
                 for await (const chunk of stream) {
                   text += chunk;
                   request.onChunk(text); 
                 }
               } catch (e: any) {
                 if (e.message?.includes("API key not valid") || e.message?.includes("API_KEY_INVALID")) {
                      throw e;
                 }
                 console.warn(`[PaidAgent] Stream failed on ${ai.providerId}, falling back to non-stream`, e);
                 text = await ai.generateChat(messages as any, systemInstruction);
               }
            } else {
               text = await ai.generateChat(messages as any, systemInstruction);
            }
            success = true;
         } catch(e: any) {
            if (!(e.message?.includes("API key not valid") || e.message?.includes("API_KEY_INVALID") || e.message?.includes("Circuit Breaker is OPEN"))) {
                console.warn(`[PaidAgent] Provider ${ai.providerId} failed: ${e.message}. Marking unhealthy and trying next.`);
            }
            GlobalProviderRegistry.markUnhealthy(ai.providerId);
            attempts++;
            if (attempts >= 3) break;
            try {
               ai = GlobalProviderRegistry.findBestProvider({ costTier: 'high' });
            } catch(ex) {
               try {
                  ai = GlobalProviderRegistry.findBestProvider({ speed: 'balanced' });
               } catch(ex2) {
                  break;
               }
            }
         }
      }

      if (!success) {
         throw new Error("PAID_API_FAILED");
      }

      if (span) trace?.addSpanEvent(span.id, 'Gateway Request Completed');

      const costEstimate = isHeavyReasoning ? 0.0500 : 0.0050; // Dynamic cost distinction
      
      if (span) trace?.endSpan(span.id, 'success');

      return {
        text: text || "I couldn't generate a response.",
        tierUsed: 'paid_api',
        costEstimate: costEstimate,
        confidence: 0.98,
        processingTimeMs: Date.now() - start,
        modelName: isHeavyReasoning ? `${ai.providerId}-paid-expert-tier` : `${ai.providerId}-paid-standard-tier`
      };
    } catch (error: any) {
      if (error?.message?.includes("API key not valid") || error?.message?.includes("API_KEY_INVALID")) {
         // Silently fail, Orchestrator will handle the fallback
         if (span) trace?.endSpan(span.id, 'error', "API Key Missing", undefined, AIErrorType.ExternalAPI);
         throw new Error("PAID_API_FAILED");
      }
      
      if (span) trace?.endSpan(span.id, 'error', error.message, undefined, AIErrorType.ExternalAPI);
      throw new Error("PAID_API_FAILED");
    }
  }
}
