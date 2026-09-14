/**
 * TokenCostTracker — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed. AI spend is already tracked for real inside
 * `AIProviderOrchestrator` (per-request token/cost estimation, persisted
 * via DistributedCounter so it's correct across server instances) — this
 * file just exposes AIProviderOrchestrator.getSpendSummary() under the
 * name the route expects.
 */
import { AIProviderOrchestrator } from '../providers/AIProviderOrchestrator';

export class TokenCostTracker {
  static async getSummary() {
    return AIProviderOrchestrator.getSpendSummary();
  }
}
