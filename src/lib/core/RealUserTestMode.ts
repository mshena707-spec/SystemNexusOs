/**
 * RealUserTestMode — beta testing and user feedback collection.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusEnv } from './NexusEnvironment';
import { NexusDB } from '../database/NexusDB';
import { logger } from './logging/NexusLogger';

const log = logger.child('RealUserTestMode');

export class RealUserTestMode {
  /** Check if a user is eligible for beta features */
  static isBetaUser(_userId: string): boolean {
    const config = NexusEnv.getStoreConfig();
    return !config.features?.requiresBetaTesting;
  }

  /** Submit beta feedback or bug report */
  static async reportIssue(
    userId: string,
    issue: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await NexusDB.add('beta_feedback', {
        userId,
        issue,
        context: JSON.stringify(context ?? {}),
        status:    'open',
        createdAt: NexusDB.serverTimestamp(),
      });
    } catch (err) {
      log.error('reportIssue failed', { userId, error: String(err) });
    }
  }

  /** Get open feedback items for admin review */
  static async getOpenFeedback(limit = 50): Promise<Array<Record<string, unknown>>> {
    return NexusDB.find('beta_feedback', {
      where:    [{ field: 'status', op: '==', value: 'open' }],
      orderBy:  'createdAt',
      orderDir: 'desc',
      limit,
    });
  }

  /** Mark feedback as resolved */
  static async resolveFeedback(feedbackId: string, resolution: string): Promise<void> {
    await NexusDB.update('beta_feedback', feedbackId, {
      status:     'resolved',
      resolution,
      resolvedAt: NexusDB.serverTimestamp(),
    });
  }
}
