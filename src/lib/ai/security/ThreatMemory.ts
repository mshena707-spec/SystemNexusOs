/**
 * ThreatMemory — persistent security threat records.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../../database/NexusDB';
import { logger } from '../../core/logging/NexusLogger';

const log = logger.child('ThreatMemory');

export class ThreatMemory {
  /** Persist a threat event for a user */
  static async recordThreat(
    userId: string,
    riskScore: number,
    details: string,
  ): Promise<void> {
    try {
      await NexusDB.add('threat_memory', {
        userId,
        riskScore,
        details,
        timestamp: NexusDB.serverTimestamp(),
      });
    } catch (err) {
      log.error('recordThreat failed', { userId, error: String(err) });
    }
  }

  /** Get aggregated threat profile for a user */
  static async getThreatProfile(
    userId: string,
  ): Promise<{ totalRiskScore: number; isBanned: boolean }> {
    try {
      const records = await NexusDB.find('threat_memory', {
        where:    [{ field: 'userId', op: '==', value: userId }],
        orderBy:  'timestamp',
        orderDir: 'desc',
        limit:    50,
      });

      if (records.length === 0) return { totalRiskScore: 0, isBanned: false };

      const totalRiskScore = records.reduce((sum, r) => sum + ((r.riskScore as number) ?? 0), 0);
      const isBanned       = totalRiskScore > 500;

      return { totalRiskScore, isBanned };
    } catch (err) {
      log.error('getThreatProfile failed', { userId, error: String(err) });
      return { totalRiskScore: 0, isBanned: false };
    }
  }

  /** Clear old threat records (data retention) */
  static async clearOldRecords(olderThanDays = 90): Promise<void> {
    // Implemented via NexusDB.find + batch delete
    try {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      const old    = await NexusDB.find('threat_memory', {
        where: [{ field: 'timestamp', op: '<', value: cutoff }],
        limit: 500,
      });
      await Promise.allSettled(
        old.map((r) => NexusDB.delete('threat_memory', r.id as string)),
      );
      log.info(`ThreatMemory: cleared ${old.length} old records`);
    } catch (err) {
      log.error('clearOldRecords failed', { error: String(err) });
    }
  }
}
