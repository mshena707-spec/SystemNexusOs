/**
 * PHASE 21: PERSONAL AI PRIORITY ENGINE
 * Local-First routing to minimize external API costs.
 */
import { LocalModelAdapter } from './LocalModelAdapter';

export class PriorityEngine {
  /**
   * Decides whether to use Local AI or External AI based on local confidence.
   */
  static async decide(query: string, tenantId: string = 'default'): Promise<{ source: 'local' | 'external', answer?: any }> {
    if (!LocalModelAdapter.isAvailable()) {
      return { source: 'external' };
    }

    const localAnswer = await LocalModelAdapter.generate(query);

    if (localAnswer.confidence > 0.85) {
      console.log(`[PriorityEngine] Query routed to LOCAL AI (Confidence: ${localAnswer.confidence})`);
      return { source: 'local', answer: localAnswer };
    }

    console.log(`[PriorityEngine] Query routed to EXTERNAL API (Local Confidence too low: ${localAnswer.confidence})`);
    return { source: 'external' };
  }
}
