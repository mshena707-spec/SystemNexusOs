/**
 * UserOnboardingEngine — manages new user setup flow.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('UserOnboardingEngine');

export interface OnboardingProfile {
  uid: string;
  email?: string;
  displayName?: string;
  role?: string;
  onboardingStep?: number;
  onboardingCompleted?: boolean;
  preferences?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export class UserOnboardingEngine {
  /** Create or update user profile on first login */
  static async initUser(profile: OnboardingProfile): Promise<void> {
    try {
      const existing = await NexusDB.get('user_profiles', profile.uid);
      if (!existing) {
        await NexusDB.set('user_profiles', profile.uid, {
          ...profile,
          role: profile.role ?? 'customer',
          onboardingStep: 0,
          onboardingCompleted: false,
          createdAt: NexusDB.serverTimestamp(),
          updatedAt: NexusDB.serverTimestamp(),
        });
        log.info(`New user onboarded: ${profile.uid}`);
      }
    } catch (err) {
      log.error('initUser failed', { userId: profile.uid, error: String(err) });
    }
  }

  /** Advance user through onboarding steps */
  static async advanceStep(uid: string, step: number): Promise<void> {
    try {
      await NexusDB.update('user_profiles', uid, {
        onboardingStep: step,
        onboardingCompleted: step >= 5,
        updatedAt: NexusDB.serverTimestamp(),
      });
    } catch (err) {
      log.error('advanceStep failed', { uid, step, error: String(err) });
    }
  }

  /** Get user profile */
  static async getProfile(uid: string): Promise<OnboardingProfile | null> {
    try {
      const doc = await NexusDB.get('user_profiles', uid);
      return doc as OnboardingProfile | null;
    } catch {
      return null;
    }
  }

  /** Save user preferences */
  static async savePreferences(uid: string, prefs: Record<string, unknown>): Promise<void> {
    try {
      await NexusDB.update('user_profiles', uid, {
        preferences: prefs,
        updatedAt: NexusDB.serverTimestamp(),
      });
    } catch (err) {
      log.error('savePreferences failed', { uid, error: String(err) });
    }
  }
}
