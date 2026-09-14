import { ThreatMemory } from './ThreatMemory';
import { SecurityControl } from './SecurityControl';

interface UserBehavior {
  requestCount: number;
  highRiskCount: number;
  lastRequestTime: number;
  isRestricted: boolean;
}

export class BehaviorMonitor {
  private static store = new Map<string, UserBehavior>();

  /**
   * Tracks user requests and triggers restrictions if anomalous behavior is detected.
   */
  static async track(userId: string, riskScore: number): Promise<{ allowed: boolean; reason?: string }> {
    const now = Date.now();
    let behavior = this.store.get(userId);

    if (!behavior) {
      behavior = { requestCount: 0, highRiskCount: 0, lastRequestTime: now, isRestricted: false };
    }

    // Reset counts if it's been more than 1 hour (3600000 ms)
    if (now - behavior.lastRequestTime > 3600000) {
      behavior.requestCount = 0;
      behavior.highRiskCount = 0;
      behavior.isRestricted = false;
    }

    if (behavior.isRestricted) {
      return { allowed: false, reason: 'User is temporarily restricted due to suspicious activity.' };
    }

    behavior.requestCount++;
    behavior.lastRequestTime = now;

    if (riskScore >= 60) {
      behavior.highRiskCount++;
      // Update Threat Memory
      await ThreatMemory.recordThreat(userId, riskScore, `High risk score: ${riskScore}`);
    }

    // Trigger restrictions
    if (behavior.highRiskCount >= 5) {
      behavior.isRestricted = true;
      this.store.set(userId, behavior);
      console.warn(`[Security] User ${userId} restricted due to high risk count.`);
      
      // Check if we need to trigger emergency mode
      const threatProfile = await ThreatMemory.getThreatProfile(userId);
      if (threatProfile.isBanned) {
         SecurityControl.triggerEmergencyMode(`User ${userId} exceeded maximum threat profile score.`);
      }

      return { allowed: false, reason: 'Too many high-risk requests. Account restricted.' };
    }

    if (behavior.requestCount >= 100) { // Rate limit: 100 per hour
      behavior.isRestricted = true;
      this.store.set(userId, behavior);
      console.warn(`[Security] User ${userId} restricted due to rate limit.`);
      return { allowed: false, reason: 'Rate limit exceeded. Account restricted.' };
    }

    this.store.set(userId, behavior);
    return { allowed: true };
  }
}
