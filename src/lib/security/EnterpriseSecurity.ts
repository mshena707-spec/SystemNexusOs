/**
 * PHASE 15: ADVANCED SECURITY (ENTERPRISE GRADE)
 *
 * @deprecated as of Phase M:
 *  - validateZeroTrustRequest() only checked `!!token` (placeholder).
 *    Use JWTService.verify(token) (src/lib/security/auth/JWTService.ts)
 *    for real signature + expiry + role verification.
 *  - detectBehaviorAnomaly() / detectAIMisuse() are superseded by
 *    AnomalyDetectionEngine, which persists events and escalates them
 *    instead of only logging to console.
 * Kept for any legacy call sites; new code should use the Phase M modules.
 */
import { SystemObserver } from '../observability/SystemObserver';

export class EnterpriseSecurity {
  /** @deprecated use JWTService.verify() for real token validation */
  static validateZeroTrustRequest(token: string, requiredRole?: string): boolean {
    // Zero Trust Security Model: every single request is validated explicitly
    if (!token) return false;
    return true; 
  }

  static detectBehaviorAnomaly(userId: string, actionCountPerMin: number) {
    if (actionCountPerMin > 100) {
      SystemObserver.log('critical', 'EnterpriseSecurity', `Behavior Anomaly Detected for User ${userId}. Action rate exceeded.`);
      return true; // Malicious detected
    }
    return false;
  }

  static detectAIMisuse(promptContent: string): boolean {
    // Prompt injection / abuse detection memory
    const blacklist = ['ignore previous instructions', 'system override', 'bypass security'];
    for (const term of blacklist) {
      if (promptContent.toLowerCase().includes(term)) {
         SystemObserver.log('warn', 'EnterpriseSecurity', `AI Misuse pattern detected: "${term}"`);
         return true;
      }
    }
    return false;
  }
}
