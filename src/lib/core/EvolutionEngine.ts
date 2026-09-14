/**
 * EvolutionEngine — AI response quality feedback loop.
 * Logs positive/negative signals to improve model behavior over time.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';
import { logger } from './logging/NexusLogger';

const log = logger.child('EvolutionEngine');

export interface EvolutionSignal {
  prompt:       string;
  response:     string;
  feedback:     'positive' | 'negative';
  userId?:      string;
  agentRole?:   string;
  needsTraining: boolean;
  createdAt:    unknown;
}

export class EvolutionEngine {
  /**
   * Record user feedback on an AI response.
   * Negative signals are flagged for offline LoRA fine-tuning.
   */
  static async evaluateAIResponse(
    prompt: string,
    response: string,
    userFeedback: 'positive' | 'negative',
    meta?: { userId?: string; agentRole?: string },
  ): Promise<void> {
    try {
      const signal: EvolutionSignal = {
        prompt:       prompt.slice(0, 2000), // cap for storage efficiency
        response:     response.slice(0, 4000),
        feedback:     userFeedback,
        userId:       meta?.userId,
        agentRole:    meta?.agentRole,
        needsTraining: userFeedback === 'negative',
        createdAt:    NexusDB.serverTimestamp(),
      };

      await NexusDB.add('ai_evolution_logs', signal as unknown as Record<string, unknown>);

      if (userFeedback === 'negative') {
        log.warn('Negative AI signal — flagged for retraining', { agentRole: meta?.agentRole });
      } else {
        log.info('Positive AI signal recorded', { agentRole: meta?.agentRole });
      }
    } catch (err) {
      log.error('EvolutionEngine logging failed', { error: String(err) });
    }
  }

  /** Get unprocessed negative signals for offline training */
  static async getPendingTrainingData(limit = 500): Promise<EvolutionSignal[]> {
    return NexusDB.find('ai_evolution_logs', {
      where:    [{ field: 'needsTraining', op: '==', value: true }],
      orderBy:  'createdAt',
      orderDir: 'asc',
      limit,
    }) as Promise<EvolutionSignal[]>;
  }

  /** Mark signals as processed after training */
  static async markProcessed(ids: string[]): Promise<void> {
    await Promise.allSettled(
      ids.map((id) =>
        NexusDB.update('ai_evolution_logs', id, {
          needsTraining: false,
          processedAt:   NexusDB.serverTimestamp(),
        }),
      ),
    );
  }
}
