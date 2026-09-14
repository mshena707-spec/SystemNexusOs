/**
 * RetentionEngine — re-engagement campaigns for inactive users.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';
import { NotificationEngine } from '../integrations/NotificationEngine';
import { NexusUnifiedCore } from '../core/NexusUnifiedCore';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('RetentionEngine');
const INACTIVE_DAYS = 7;

export class RetentionEngine {
  /** Find users inactive for > INACTIVE_DAYS and send re-engagement messages */
  static async runRetentionSweep(): Promise<{ processed: number }> {
    log.info('Scanning for inactive users...');
    let processed = 0;

    try {
      const thresholdTs = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;

      const inactiveUsers = await NexusDB.find('user_profiles', {
        where: [{ field: 'lastLoginAt', op: '<', value: thresholdTs }],
        limit: 200,
      });

      for (const userData of inactiveUsers) {
        try {
          const prompt = `User ${(userData.displayName as string) || 'friend'} hasn't visited in ${INACTIVE_DAYS} days. Write a short, friendly re-engagement message and offer 5% discount with code COMEBACK5.`;
          const aiResp = await NexusUnifiedCore.process(prompt, { agentRole: 'marketing_agent' });

          await NotificationEngine.notify({
            userId: userData.id as string,
            channels: ['email', 'in_app'],
            title: 'We miss you! 💙',
            message: (aiResp?.text as string) ?? 'We miss you! Use COMEBACK5 for 5% off your next order.',
          });

          processed++;
        } catch (userErr) {
          log.warn(`Retention: failed for user ${userData.id}`, { error: String(userErr) });
        }
      }

      log.info(`Retention sweep complete. Processed: ${processed}`);
    } catch (err) {
      log.error('Retention sweep failed', { error: String(err) });
    }

    return { processed };
  }

  /** Record user activity timestamp */
  static async recordActivity(userId: string): Promise<void> {
    try {
      await NexusDB.update('user_profiles', userId, {
        lastLoginAt: Date.now(),
        updatedAt: NexusDB.serverTimestamp(),
      });
    } catch {
      // Non-critical
    }
  }
}
