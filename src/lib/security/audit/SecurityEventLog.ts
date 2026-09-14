/**
 * SecurityEventLog — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed. The real, working implementation (event recording, storage in
 * the `security_events` collection, and summarisation) lives in
 * `AnomalyDetectionEngine` (src/lib/security/auth/AnomalyDetectionEngine.ts)
 * — this file exposes it under the name/shape the route expects.
 */
import { AnomalyDetectionEngine, SecurityEvent } from '../auth/AnomalyDetectionEngine';

export type { SecurityEvent };

export class SecurityEventLog {
  static async getRecent(limit = 100): Promise<SecurityEvent[]> {
    return AnomalyDetectionEngine.getRecentEvents(limit);
  }

  /** GET /security/summary?hours=24 — real engine buckets by days, so we convert. */
  static async getSummary(hours = 24) {
    const days = Math.max(1, Math.ceil(hours / 24));
    return AnomalyDetectionEngine.getSummary(days);
  }
}
