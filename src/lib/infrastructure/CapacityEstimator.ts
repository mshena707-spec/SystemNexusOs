/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CAPACITY ESTIMATOR                                                  ║
 * ║                                                                      ║
 * ║  Answers the question an owner/admin actually needs answered:       ║
 * ║  "given the hardware this is running on right now, roughly how      ║
 * ║   many users/orders/requests can this install handle?"              ║
 * ║                                                                      ║
 * ║  HONESTY FIRST: no system can know its own exact user-capacity from ║
 * ║  hardware specs alone — real capacity depends on query complexity,  ║
 * ║  network latency, and third-party API speed (payment gateways, AI   ║
 * ║  providers), none of which a hardware sniff can see. So this does   ║
 * ║  two things, and is explicit about which is which:                  ║
 * ║                                                                      ║
 * ║   1. MEASURED  — a real, timed benchmark against the database that  ║
 * ║      is actually configured right now (whatever NexusDB provider    ║
 * ║      is active). This is a fact, not a guess.                       ║
 * ║   2. ESTIMATED — hardware specs + the measured DB numbers fed into  ║
 * ║      a documented formula (see ASSUMPTIONS below) to produce a      ║
 * ║      capacity RANGE. Every number this produces is labeled as an    ║
 * ║      estimate and ships with the assumptions that produced it, so   ║
 * ║      an admin can judge how much to trust it — never a bare number  ║
 * ║      presented as a guarantee.                                      ║
 * ║                                                                      ║
 * ║  This also drives real self-tuning (task-queue concurrency, DB pool ║
 * ║  size, poll interval) — those values ARE safe to auto-apply, unlike ║
 * ║  "which database to use," which stays a recommendation an admin     ║
 * ║  must act on, since silently switching a production database out    ║
 * ║  from under an app would be dangerous.                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { HardwareAutoConfig, HardwareProfile } from './HardwareAutoConfig';

// ── Documented assumptions (change these here, not scattered through the code) ──
const ASSUMPTIONS = {
  /** MB of RAM the Node process + loaded deps need before any user traffic. */
  baseProcessOverheadMB: 200,
  /** KB of memory held per live WebSocket/keep-alive connection (buffers + state). */
  perConnectionKB: 80,
  /** Only this fraction of free RAM is safe to count toward connection capacity —
   *  the rest is headroom for GC, request bodies, and query result buffers. */
  ramSafetyFactor: 0.5,
  /** Requests/sec a single CPU core can drive for a typical mixed JSON API
   *  endpoint on Node (routing + business logic, DB call excluded) — a
   *  conservative, widely-cited ballpark for Express-class frameworks, not a
   *  number measured on this exact codebase. */
  reqPerSecPerCore: 150,
  /** Rough count of DB writes a single order touches in this codebase (order
   *  record, inventory decrement, payment record, fraud-check log, notification
   *  enqueue) — counted from OrderRepository/InventoryReservationService/
   *  PaymentRegistry call patterns, not measured live. */
  dbWritesPerOrder: 6,
  /** Registered users are not concurrent users. This is a common e-commerce
   *  rule-of-thumb ceiling (varies a lot by business — flash-sale traffic
   *  looks nothing like steady browsing) — shown to the admin as a labeled
   *  assumption, never as a hard fact. */
  assumedPeakConcurrencyRatio: 0.03, // ~3% of registered users active at once, at peak
};

export interface DBBenchmarkResult {
  ranAt: string;
  provider: string;
  writesPerSec: number;
  readsPerSec: number;
  sampleSize: number;
  /** false if the benchmark couldn't run (e.g., DB not reachable yet at boot) — estimate falls back to a hardware-only guess in that case. */
  measured: boolean;
}

export interface CapacityEstimate {
  measured: {
    database: DBBenchmarkResult;
  };
  estimated: {
    maxConcurrentConnections: number;
    apiRequestsPerSecond: number;
    ordersPerMinute: number;
    /** Loosest number here — see ASSUMPTIONS.assumedPeakConcurrencyRatio. */
    supportableRegisteredUsers: number;
  };
  tier: HardwareProfile['tier'];
  hardware: { cpuCores: number; ramMB: number; gpuVendor: string };
  assumptions: typeof ASSUMPTIONS;
  disclaimer: string;
  computedAt: string;
}

export interface RecommendedTuning {
  dbPoolSize: number;
  taskQueuePollIntervalMs: number;
  redisWorkerConcurrency: { default: number; ai: number; notifications: number };
  /** Advisory only — never auto-applied. Switching a live DB provider is an infra decision a human must make. */
  suggestedDbProviderIfSwitching: string;
}

export class CapacityEstimator {
  private static cachedReport: CapacityEstimate | null = null;
  private static cachedTuning: RecommendedTuning | null = null;

  /** Real, timed benchmark against whichever NexusDB provider is actually configured. */
  static async runDatabaseBenchmark(sampleSize = 20): Promise<DBBenchmarkResult> {
    const provider = process.env.DB_PROVIDER || 'firestore';
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const ids: string[] = [];

      const writeStart = Date.now();
      for (let i = 0; i < sampleSize; i++) {
        const id = await NexusDB.add('_capacity_benchmark', { i, ts: Date.now() });
        ids.push(id);
      }
      const writeMs = Date.now() - writeStart;

      const readStart = Date.now();
      for (const id of ids) {
        await NexusDB.get('_capacity_benchmark', id);
      }
      const readMs = Date.now() - readStart;

      // Clean up — this is a benchmark, not real data.
      for (const id of ids) {
        await NexusDB.delete('_capacity_benchmark', id).catch(() => {});
      }

      return {
        ranAt: new Date().toISOString(),
        provider,
        writesPerSec: Math.round((sampleSize / Math.max(writeMs, 1)) * 1000),
        readsPerSec: Math.round((sampleSize / Math.max(readMs, 1)) * 1000),
        sampleSize,
        measured: true,
      };
    } catch (err) {
      // DB not reachable yet (e.g., called too early at boot) — honest fallback, not a fake number.
      return {
        ranAt: new Date().toISOString(),
        provider,
        writesPerSec: 0,
        readsPerSec: 0,
        sampleSize: 0,
        measured: false,
      };
    }
  }

  static async estimateCapacity(forceRefresh = false): Promise<CapacityEstimate> {
    if (this.cachedReport && !forceRefresh) return this.cachedReport;

    const profile = await HardwareAutoConfig.detect();
    const dbBench = await this.runDatabaseBenchmark();

    const availableConnMB = Math.max(0, profile.ramMB - ASSUMPTIONS.baseProcessOverheadMB) * ASSUMPTIONS.ramSafetyFactor;
    const maxConcurrentConnections = Math.floor((availableConnMB * 1024) / ASSUMPTIONS.perConnectionKB);

    const cpuBoundReqPerSec = profile.cpuCores * ASSUMPTIONS.reqPerSecPerCore;
    // If the DB was actually measured and it's the tighter bottleneck, the real
    // ceiling is however many read-sized requests the DB can sustain, not the
    // CPU-only number — this is where the benchmark actually changes the estimate.
    const apiRequestsPerSecond = dbBench.measured
      ? Math.min(cpuBoundReqPerSec, dbBench.readsPerSec * 3) // most requests aren't a single DB read; ×3 is a loose slack factor, not precision
      : cpuBoundReqPerSec;

    const ordersPerMinute = dbBench.measured
      ? Math.round((dbBench.writesPerSec / ASSUMPTIONS.dbWritesPerOrder) * 60)
      : Math.round((apiRequestsPerSecond * 0.1 / ASSUMPTIONS.dbWritesPerOrder) * 60); // hardware-only fallback, clearly rougher

    const supportableRegisteredUsers = Math.round(maxConcurrentConnections / ASSUMPTIONS.assumedPeakConcurrencyRatio);

    const report: CapacityEstimate = {
      measured: { database: dbBench },
      estimated: {
        maxConcurrentConnections,
        apiRequestsPerSecond,
        ordersPerMinute,
        supportableRegisteredUsers,
      },
      tier: profile.tier,
      hardware: { cpuCores: profile.cpuCores, ramMB: profile.ramMB, gpuVendor: profile.gpuVendor },
      assumptions: ASSUMPTIONS,
      disclaimer:
        'These are estimates from hardware specs + a live database benchmark, not a load-test guarantee. ' +
        'Real capacity also depends on network conditions and third-party API latency (payment/AI providers), ' +
        'which this cannot measure from inside the process. Treat as a planning signal, not an SLA.',
      computedAt: new Date().toISOString(),
    };

    this.cachedReport = report;
    return report;
  }

  /** Values safe to auto-apply — unlike DB provider choice, these don't risk data loss or downtime if wrong. */
  static async getRecommendedTuning(): Promise<RecommendedTuning> {
    if (this.cachedTuning) return this.cachedTuning;
    const profile = await HardwareAutoConfig.detect();

    const tuning: RecommendedTuning = {
      // Postgres' own guidance: roughly 2-4 connections per core for typical
      // OLTP workloads, capped so small instances don't over-open connections.
      dbPoolSize: Math.max(5, Math.min(profile.cpuCores * 3, 50)),
      // Lower-spec hardware polls less often to leave more CPU for request handling.
      taskQueuePollIntervalMs: profile.tier === 'minimal' ? 1000 : profile.tier === 'standard' ? 500 : 250,
      redisWorkerConcurrency: {
        default:       Math.max(1, Math.floor(profile.maxWorkers * 0.5)),
        ai:            Math.max(1, Math.floor(profile.maxWorkers * 0.25)),
        notifications: Math.max(1, Math.floor(profile.maxWorkers * 0.5)),
      },
      suggestedDbProviderIfSwitching: profile.recommendedDB,
    };

    this.cachedTuning = tuning;
    return tuning;
  }

  static printCapacityReport(report: CapacityEstimate): void {
    const e = report.estimated;
    console.log(`
╔══════════════════════════════════════════════════╗
║     NEXUS OS — ESTIMATED CAPACITY (${report.tier.padEnd(10)})    ║
╠══════════════════════════════════════════════════╣
║  DB benchmark:     ${(report.measured.database.measured ? `${report.measured.database.writesPerSec} writes/s, ${report.measured.database.readsPerSec} reads/s` : 'not measured yet').padEnd(30)}║
║  Max concurrent:   ${String(e.maxConcurrentConnections).padEnd(30)}║
║  API req/sec:      ${String(e.apiRequestsPerSecond).padEnd(30)}║
║  Orders/min:       ${String(e.ordersPerMinute).padEnd(30)}║
║  Registered users: ~${String(e.supportableRegisteredUsers).padEnd(29)}║
╠══════════════════════════════════════════════════╣
║  ⚠ Estimate, not a guarantee — see /api/admin/    ║
║    system/capacity for full methodology            ║
╚══════════════════════════════════════════════════╝`);
  }
}
