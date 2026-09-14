/**
 * GamificationEngine — award loyalty points for user actions.
 * Uses NexusDB.incrementField() for atomic point increments.
 * Architecture: no direct firebase/firestore imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('GamificationEngine');

const POINTS_MAP: Record<string, number> = {
  purchase:  10,
  review:    25,
  referral: 500,
  login:      2,
  share:     15,
};

export class GamificationEngine {
  /**
   * Award points to a user for a given action.
   * Increments `rewardPoints` atomically on the user_referrals document.
   */
  static async awardPoints(
    userId: string,
    action: keyof typeof POINTS_MAP | string,
  ): Promise<{ awarded: number }> {
    const points = POINTS_MAP[action] ?? 0;
    if (points <= 0) return { awarded: 0 };

    try {
      await NexusDB.incrementField('user_referrals', userId, 'rewardPoints', points);
      log.info(`Awarded ${points} pts to ${userId} for '${action}'`);
      return { awarded: points };
    } catch (err) {
      // Document may not exist yet — create it first then increment
      try {
        await NexusDB.set('user_referrals', userId, {
          userId,
          rewardPoints: points,
          createdAt: NexusDB.serverTimestamp(),
          updatedAt: NexusDB.serverTimestamp(),
        }, true); // merge=true
        return { awarded: points };
      } catch (inner) {
        log.warn(`Gamification points update failed for ${userId}`, { error: String(inner) });
        return { awarded: 0 };
      }
    }
  }

  /** Get current point balance for a user */
  static async getBalance(userId: string): Promise<number> {
    try {
      const doc = await NexusDB.get('user_referrals', userId);
      return (doc?.rewardPoints as number) ?? 0;
    } catch {
      return 0;
    }
  }

  /** Deduct points (e.g. for redemption) */
  static async deductPoints(userId: string, points: number): Promise<{ success: boolean }> {
    try {
      const balance = await this.getBalance(userId);
      if (balance < points) return { success: false };
      await NexusDB.incrementField('user_referrals', userId, 'rewardPoints', -points);
      return { success: true };
    } catch {
      return { success: false };
    }
  }
}
