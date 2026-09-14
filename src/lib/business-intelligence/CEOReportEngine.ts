/**
 * CEOReportEngine — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed. The real, working implementation is `CEOAgent`
 * (src/lib/orchestration/agents/CEOAgent.ts) — this file exposes it under
 * the name/shape the route expects.
 */
import { CEOAgent, CEOReport } from '../orchestration/agents/CEOAgent';

export type { CEOReport };

export class CEOReportEngine {
  static async getLatest(): Promise<CEOReport | null> {
    return CEOAgent.getLatestReport();
  }

  static async generate(): Promise<CEOReport> {
    return CEOAgent.generateDailyBrief();
  }
}
