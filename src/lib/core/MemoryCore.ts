/**
 * NEXUS MEMORY CORE — Phase 2 Adapter
 * Legacy compatibility layer. All calls delegate to NexusMemoryEngine.
 * Direct use of MemoryEngine is preferred for new code.
 */

import { MemoryEngine } from '../memory/NexusMemoryEngine';
import { MemoryType } from '../memory/interfaces/MemoryTypes';

const SYSTEM_CALLER = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };

export class MemoryCore {

  /** Search recent personal memory for a query match */
  static async searchMemoryForQuery(query: string, agentId = 'global'): Promise<string | null> {
    try {
      const results = await MemoryEngine.semanticSearch(query, { topK: 1, threshold: 0.75 });
      return results[0]?.content || null;
    } catch (_) { return null; }
  }

  /** Get recent conversation context for an agent/user */
  static async retrieveContextForAgent(userId: string, limit = 3): Promise<string> {
    try {
      const episode = await MemoryEngine.getEpisode(`ctx_${userId}`, SYSTEM_CALLER);
      if (!episode || !episode.episode.length) return '';
      return episode.episode
        .slice(-limit * 2)
        .map((e: any) => `${e.role}: ${e.content}`)
        .join('\n---\n');
    } catch (_) { return ''; }
  }

  /** Save a conversation turn to episodic memory */
  static async packAndArchive(
    entry: { userId: string; role: string; prompt: string; response: string },
    meta?: any,
  ): Promise<void> {
    try {
      const sessionId = `ctx_${entry.userId}`;
      // Ensure episode exists
      const existing = await MemoryEngine.getEpisode(sessionId, SYSTEM_CALLER);
      if (!existing) {
        await MemoryEngine.createEpisode(sessionId, entry.userId, meta?.platform);
      }
      await MemoryEngine.appendToEpisode(sessionId, [
        { role: 'user',      content: entry.prompt,   timestamp: Date.now() },
        { role: 'assistant', content: entry.response, timestamp: Date.now(), modelUsed: meta?.model },
      ], SYSTEM_CALLER);

      // Write to semantic memory for future retrieval
      if (entry.response.length > 50) {
        await MemoryEngine.writeSemanticKnowledge(
          `Q: ${entry.prompt}\nA: ${entry.response}`,
          'conversation_kb',
          entry.userId,
          { tags: ['conversation', `user:${entry.userId}`] },
          SYSTEM_CALLER,
        );
      }
    } catch (_) {}
  }

  // ── Vault stats & logs (used by CEODashboard) ──────────────────────────────

  /**
   * Returns a synchronous snapshot of memory vault health and usage.
   * Called by CEODashboard on mount — must be synchronous so it renders
   * immediately without a loading spinner on the CEO's primary view.
   */
  static getVaultStats(): {
    totalEntries: number;
    encryptedEntries: number;
    signedEntries: number;
    oldestEntryAge: string;
    vaultIntegrity: 'healthy' | 'degraded' | 'unknown';
  } {
    // In a real environment these counters come from a lightweight in-memory
    // registry that NexusMemoryEngine maintains on write. Since that registry
    // is not yet exposed, we return a structurally-correct object with
    // acknowledged unknowns rather than fabricated numbers.
    return {
      totalEntries:    0,
      encryptedEntries: 0,
      signedEntries:   0,
      oldestEntryAge:  'unknown',
      vaultIntegrity:  'unknown',
    };
  }

  /**
   * Fetches the most recent memory access/modification audit trail.
   * Each entry is one ImmutableAuditLog record tagged to a memory operation.
   */
  static async fetchVaultLogs(limit = 50): Promise<Array<{
    id: string;
    action: string;
    actorId: string;
    targetCollection: string;
    timestamp: string;
    severity: string;
  }>> {
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const raw = await NexusDB.find('audit_logs', {
        orderBy: 'timestamp',
        orderDir: 'desc',
        limit: limit * 5, // over-fetch since we filter by prefix client-side below
      });
      const filtered = (raw as any[]).filter(r => typeof r.eventType === 'string' && r.eventType.startsWith('memory.')).slice(0, limit);
      return filtered.map((r: any) => ({
        id:               r.id    || r.auditId || 'unknown',
        action:           r.eventType || r.action || 'memory_operation',
        actorId:          r.subject?.id || r.actorId || 'system',
        targetCollection: r.detail?.collection || r.resource || 'memory',
        timestamp:        r.timestamp || new Date().toISOString(),
        severity:         r.severity || 'info',
      }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Reads the full content of an archived memory log entry by ID.
   * Used by CEODashboard when the operator clicks an entry to inspect it.
   */
  static async readArchive(log: { id: string; targetCollection?: string }): Promise<{
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    retrievedAt: string;
  } | null> {
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const collection = log.targetCollection || 'audit_logs';
      const entry = await NexusDB.get(collection, log.id) as any;
      if (!entry) return null;
      return {
        id:          log.id,
        content:     entry.content || entry.eventType || JSON.stringify(entry),
        metadata:    entry,
        retrievedAt: new Date().toISOString(),
      };
    } catch (_) {
      return null;
    }
  }
}
