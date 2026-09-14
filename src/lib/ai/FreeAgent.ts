import { AIRequest, AIResponse } from './types';
import { AutoDiscoveryEngine } from './AutoDiscovery';
import { AIErrorType } from '../observability/Telemetry';

/**
 * Represents the Free API Tier.
 * Uses fast, lightweight, and often free models (like Gemini 1.5 Flash or AI Gamma-4).
 * Now enhanced with AIGateway to pull the current Universal Free Provider.
 */
export class FreeAPIAgent {
  static async process(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    const trace = request.trace;
    const span = trace?.startSpan('FreeAgent.process', { type: 'gateway' });

    try {
      // 1. Check if AutoDiscovery has found a better/faster free model on the web
      const dynamicModel = AutoDiscoveryEngine.getBestAvailableFreeModel();
      let usedModelName = 'AI-Gamma-4-Free (via Gateway)';

      if (dynamicModel) {
        console.log(`[FreeAgent] Utilizing auto-discovered free model: ${dynamicModel.name}`);
        usedModelName = `${dynamicModel.name} (Auto-Discovered)`;
        if (span) trace?.addSpanEvent(span.id, 'Auto-Discovered Model Used', { name: dynamicModel.name });
      }

      if (span) trace?.addSpanEvent(span.id, 'Gateway Request Started');
      
      const { GlobalProviderRegistry } = await import('./providers/ProviderRegistry');
      
      let ai = GlobalProviderRegistry.findBestProvider({ costTier: 'free' });
      const messages = [...(request.history || [])];
      messages.push({ role: 'user', content: request.prompt });
      
      let text = "";
      
      // Attempt generation with retry / fallback across free providers
      let attempts = 0;
      let success = false;
      
      while (!success && attempts < 3) {
         try {
            if (request.onChunk && ai.generateChatStream) {
               try {
                  const stream = ai.generateChatStream(messages as any, request.systemInstruction || `You are a helpful ${request.agentRole} assistant. Provide concise, accurate answers.`);
                  for await (const chunk of stream) {
                     text += chunk;
                     request.onChunk(text); 
                  }
               } catch (e: any) {
                  if (e.message?.includes("API key not valid") || e.message?.includes("API_KEY_INVALID")) {
                      throw e; // Bubble up immediately without non-stream fallback
                  }
                  console.warn(`[FreeAgent] Stream failed on ${ai.providerId}, falling back to non-stream`, e);
                  text = await ai.generateChat(messages as any, request.systemInstruction || `You are a helpful ${request.agentRole} assistant. Provide concise, accurate answers.`);
               }
            } else {
               text = await ai.generateChat(messages as any, request.systemInstruction || `You are a helpful ${request.agentRole} assistant. Provide concise, accurate answers.`);
            }
            success = true;
         } catch(e: any) {
            if (!(e.message?.includes("API key not valid") || e.message?.includes("API_KEY_INVALID") || e.message?.includes("Circuit Breaker is OPEN"))) {
                console.warn(`[FreeAgent] Provider ${ai.providerId} failed: ${e.message}. Marking unhealthy and trying next.`);
            }
            GlobalProviderRegistry.markUnhealthy(ai.providerId);
            attempts++;
            if (attempts >= 3) break;
            try {
               ai = GlobalProviderRegistry.findBestProvider({ costTier: 'free' });
            } catch(noMoreProviders) {
               break;
            }
         }
      }

      if (!success) {
         throw new Error("FREE_API_FAILED");
      }

      if (span) trace?.addSpanEvent(span.id, 'Gateway Request Completed');

      // Free tier logic: cost is very low or 0
      const costEstimate = 0.0001; 
      
      if (span) trace?.endSpan(span.id, 'success');

      return {
        text: text || "I couldn't generate a response.",
        tierUsed: 'free_api',
        costEstimate: costEstimate,
        confidence: 0.88,
        processingTimeMs: Date.now() - start,
        modelName: usedModelName
      };
    } catch (error: any) {
      if (error?.message?.includes("API key not valid") || error?.message?.includes("API_KEY_INVALID")) {
         // Silently fail, Orchestrator will handle the fallback
         if (span) trace?.endSpan(span.id, 'error', "API Key Missing", undefined, AIErrorType.ExternalAPI);
         throw new Error("FREE_API_FAILED");
      }
      
      if (span) trace?.endSpan(span.id, 'error', error.message, undefined, AIErrorType.ExternalAPI);
      throw new Error("FREE_API_FAILED");
    }
  }
}
