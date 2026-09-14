/**
 * ReferralEngine — Phase V integration fix
 *
 * BEFORE: processReferral() wrote rewardPoints to Firestore user_referrals
 * document only (updateDoc → rewardPoints: increment(500)). LoyaltyEngine
 * knew nothing about referral rewards. Two separate points systems existed
 * in parallel.
 *
 * AFTER: processReferral() now calls LoyaltyEngine.awardBonus() which:
 *   1. Writes to loyalty_transactions (NexusDB / Firestore) — the single
 *      source of truth for all customer points
 *   2. Produces an ImmutableAuditLog entry
 *   3. Updates balance + tier automatically
 *
 * The local rewardPoints counter in user_referrals is kept for backwards
 * compatibility (it costs nothing to increment and some admin code may still
 * read it for a leaderboard), but it is no longer the authoritative source.
 *
 * Reward amounts (env-configurable):
 *   REFERRAL_REFERRER_POINTS  — points awarded to the referrer (default 500)
 *   REFERRAL_REFERRED_POINTS  — points awarded to the new user (default 200)
 */
import { NexusDB } from '../database/NexusDB';
import { LoyaltyEngine } from '../loyalty/LoyaltyEngine';

declare const process: { env: Record<string, string | undefined> };

const REFERRER_POINTS = parseInt(process.env?.REFERRAL_REFERRER_POINTS ?? '500');
const REFERRED_POINTS = parseInt(process.env?.REFERRAL_REFERRED_POINTS ?? '200');

export class ReferralEngine {
  static generateCode(userId: string): string {
    return `NEXUS-` + Math.random().toString(36).substring(2, 6).toUpperCase() + `-${userId.substring(0, 4).toUpperCase()}`;
  }

  static async getOrCreateUserCode(userId: string): Promise<string> {
    
    const existing = await NexusDB.get('user_referrals', userId);
    if (existing) return existing.code;
    const newCode = this.generateCode(userId);
    await NexusDB.set('user_referrals', userId, {
      userId, code: newCode, referralsCount: 0,
      rewardPoints: 0, createdAt: NexusDB.serverTimestamp(),
    });
    return newCode;
  }

  /** Referral counts + reward points for one user, for a "my referrals" screen. */
  static async getStats(userId: string): Promise<{
    code: string | null; referralsCount: number; rewardPoints: number;
  }> {
    const record = await NexusDB.get('user_referrals', userId);
    return {
      code: (record?.code as string) ?? null,
      referralsCount: (record?.referralsCount as number) ?? 0,
      rewardPoints: (record?.rewardPoints as number) ?? 0,
    };
  }

  /** Top referrers by successful referral count, for an admin growth dashboard. */
  static async getLeaderboard(limit = 20): Promise<Array<{
    userId: string; code: string; referralsCount: number; rewardPoints: number;
  }>> {
    const rows = await NexusDB.find('user_referrals', {
      where: [{ field: 'referralsCount', op: '>', value: 0 }],
      orderBy: 'referralsCount', orderDir: 'desc', limit,
    });
    return rows.map(r => ({
      userId: r.userId as string, code: r.code as string,
      referralsCount: r.referralsCount as number, rewardPoints: r.rewardPoints as number,
    }));
  }

  static async processReferral(newUserId: string, referralCode: string): Promise<{
    success: boolean;
    referrerId?: string;
    referrerPointsAwarded?: number;
    referredPointsAwarded?: number;
    error?: string;
  }> {
    if (!referralCode) return { success: false };

    try {
      
      const matches = await NexusDB.find('user_referrals', {
        where: [{ field: 'code', op: '==', value: referralCode }],
        limit: 1,
      });
      if (matches.length === 0) return { success: false, error: 'Invalid referral code' };

      const referrerId = matches[0].userId as string;
      if (referrerId === newUserId) return { success: false, error: 'Self-referral not allowed' };

      // ── Phase V: Award via LoyaltyEngine (single source of truth) ─────
      // Referrer reward
      await LoyaltyEngine.awardBonus(
        referrerId,
        REFERRER_POINTS,
        'earn_referral',
        newUserId,
        `Referral reward — new user ${newUserId} signed up with your code`,
        'system_referral',
      );

      // New user welcome bonus
      await LoyaltyEngine.awardBonus(
        newUserId,
        REFERRED_POINTS,
        'earn_referral',
        referrerId,
        `Welcome bonus — joined via referral code ${referralCode}`,
        'system_referral',
      );

      // Keep user_referrals counter for backwards-compatibility
      await NexusDB.incrementField('user_referrals', referrerId, 'referralsCount', 1);
      await NexusDB.incrementField('user_referrals', referrerId, 'rewardPoints', REFERRER_POINTS); // legacy counter only

      // Referral history record (unchanged from before)
      await NexusDB.add('referral_history', {
        referrerId, referredUserId: newUserId,
        status: 'completed',
        rewardToReferrer: REFERRER_POINTS,
        rewardToReferred: REFERRED_POINTS,
        referralCode,
        createdAt: NexusDB.serverTimestamp(),
      });

      return {
        success: true,
        referrerId,
        referrerPointsAwarded: REFERRER_POINTS,
        referredPointsAwarded: REFERRED_POINTS,
      };
    } catch (e: any) {
      console.error('[ReferralEngine] processReferral failed:', e);
      return { success: false, error: 'System error' };
    }
  }
}
