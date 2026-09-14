/**
 * PHASE: PERSONAL AI BRAIN SYSTEM
 * Data Collection Layer
 */

export interface InteractionRecord {
  id: string;
  prompt: string;
  responses: any[];
  final_answer: string;
  success_score: number;
  timestamp: number;
  tenantId?: string; // For Enterprise isolated memory
}

export class DataCollector {
  static collect(prompt: string, responses: any[], final_answer: string, success_score: number, tenantId: string = 'default'): InteractionRecord {
    const record: InteractionRecord = {
      id: crypto.randomUUID(),
      prompt,
      responses,
      final_answer,
      success_score,
      timestamp: Date.now(),
      tenantId
    };
    console.log('[DataCollector] Interaction collected for learning pipeline.');
    return record;
  }
}
