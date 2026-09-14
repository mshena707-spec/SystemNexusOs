/**
 * LearningEngine — AI Learning Loop with NexusDB Persistence
 *
 * BEFORE: in-memory memoryStore array — lost on restart, no filtering,
 *         never queried, never used by AI pipeline.
 *
 * AFTER:
 *   - Persists successful Q&A pairs to NexusDB ('ai_learning' collection)
 *   - Only stores high-quality responses (success_score > 0.7)
 *   - Connected to AI pipeline via EventBus subscription in server.ts
 *   - Semantic lookup: when a similar query arrives, returns cached response
 *   - Fine-tune trigger: after N stored examples, notifies for model update
 */

import { NexusDB } from '../database/NexusDB';
import { EventBus } from '../core/events/NexusEventBus';

export interface InteractionRecord {
  id?: string;
  tenantId: string;
  query: string;
  final_answer: string;
  success_score: number;     // 0-1, set by AI quality scoring
  model: string;
  latencyMs?: number;
  channel?: string;
  userId?: string;
  tags?: string[];
  createdAt?: string;
  useCount?: number;
}

const LEARNING_COLLECTION = 'ai_learning';
const MIN_SCORE = 0.7;
const FINETUNE_THRESHOLD = 500; // trigger fine-tune notification after N examples

export class LearningEngine {
  /** Decide if this record is worth storing */
  static shouldStore(record: InteractionRecord): boolean {
    if (record.success_score < MIN_SCORE) return false;

    const lower = record.final_answer.toLowerCase();
    const badPhrases = [
      "i cannot answer", "i'm not able", "error", "i don't know",
      "cannot help", "not sure", "as an ai", "i apologize",
    ];
    return !badPhrases.some(p => lower.includes(p));
  }

  /** Store a successful interaction to NexusDB */
  static async storeToDB(record: InteractionRecord | Record<string, unknown>): Promise<void> {
    const r = record as InteractionRecord;
    if (!this.shouldStore(r)) return;

    const id = `learn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const entry: InteractionRecord = {
      ...r,
      id,
      createdAt: new Date().toISOString(),
      useCount: 0,
    };

    await NexusDB.set(LEARNING_COLLECTION, id, entry as unknown as Record<string, unknown>);

    // Check if we've hit fine-tune threshold
    const count = await NexusDB.find(LEARNING_COLLECTION, {
      where: [{ field: 'tenantId', op: '==', value: r.tenantId || 'default' }],
      limit: 1,
    }).then(results => results.length);

    if (count > 0 && count % FINETUNE_THRESHOLD === 0) {
      EventBus.emit('ai.finetune.ready', {
        tenantId: r.tenantId || 'default',
        exampleCount: count,
        message: `${count} training examples available. Consider fine-tuning.`,
      });
    }
  }

  /**
   * Find a similar past query and return its cached answer.
   * Uses Jaccard similarity — no external embedding service needed.
   */
  static async findSimilar(query: string, tenantId = 'default', threshold = 0.82): Promise<InteractionRecord | null> {
    const candidates = await NexusDB.find(LEARNING_COLLECTION, {
      where: [
        { field: 'tenantId', op: '==', value: tenantId },
        { field: 'success_score', op: '>=', value: MIN_SCORE },
      ],
      orderBy: 'useCount',
      orderDir: 'desc',
      limit: 100,
    }) as unknown as InteractionRecord[];

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim().split(' ');

    const queryWords = new Set(normalize(query));
    let best: InteractionRecord | null = null;
    let bestSim = 0;

    for (const c of candidates) {
      const cWords = new Set(normalize(c.query));
      const inter = [...queryWords].filter(w => cWords.has(w)).length;
      const union = new Set([...queryWords, ...cWords]).size;
      const sim = union === 0 ? 0 : inter / union;

      if (sim > bestSim && sim >= threshold) {
        bestSim = sim;
        best = c;
      }
    }

    if (best) {
      // Increment use count (async, non-blocking)
      NexusDB.incrementField(LEARNING_COLLECTION, best.id!, 'useCount', 1).catch(() => {});
    }

    return best;
  }

  /** Get stored memory for a tenant (for admin review) */
  static async getStoredMemory(tenantId = 'default', limit = 50): Promise<InteractionRecord[]> {
    return NexusDB.find(LEARNING_COLLECTION, {
      where: [{ field: 'tenantId', op: '==', value: tenantId }],
      orderBy: 'createdAt',
      orderDir: 'desc',
      limit,
    }) as unknown as Promise<InteractionRecord[]>;
  }

  /** Delete a specific learning record (owner can curate the training data) */
  static async deleteRecord(id: string): Promise<void> {
    await NexusDB.delete(LEARNING_COLLECTION, id);
  }

  /** Get statistics */
  static async getStats(tenantId = 'default'): Promise<{
    total: number;
    avgScore: number;
    topModels: Record<string, number>;
  }> {
    const all = await this.getStoredMemory(tenantId, 1000);
    const avgScore = all.length ? all.reduce((a, r) => a + r.success_score, 0) / all.length : 0;
    const topModels: Record<string, number> = {};
    for (const r of all) {
      topModels[r.model] = (topModels[r.model] || 0) + 1;
    }
    return { total: all.length, avgScore: Math.round(avgScore * 100) / 100, topModels };
  }

  // ── Legacy synchronous API (backward compat) ─────────────────────────────

  private static memoryStore: InteractionRecord[] = [];

  /** @deprecated Use storeToDB() instead */
  static store(record: InteractionRecord) {
    if (this.shouldStore(record)) {
      this.memoryStore.push({ ...record, id: `mem_${Date.now()}` });
      // Also persist async
      this.storeToDB(record).catch(() => {});
    }
  }

  /** @deprecated Use findSimilar() instead */
  static getStoredMemorySync(tenantId = 'default'): InteractionRecord[] {
    return this.memoryStore.filter(m => m.tenantId === tenantId);
  }
}
