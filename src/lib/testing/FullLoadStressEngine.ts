/**
 * PHASE 102: FULL LOAD STRESS ENGINE — NOT YET IMPLEMENTED
 *
 * The previous version of this file faked a load test: it waited 1 second,
 * then reported `passed = users` no matter how many users were requested,
 * without sending a single real request. That made "load test passed"
 * claims meaningless regardless of the number entered. This version fails
 * loudly instead of returning a fabricated result.
 *
 * A real implementation needs to actually drive concurrent HTTP traffic
 * against a running instance (e.g. via k6, Artillery, or Locust —
 * tests/load/k6-load-test.js already exists in this repo and is a
 * legitimate starting point) and report measured p95/p99 latency, error
 * rate, and throughput — not a fabricated pass count.
 */
export class FullLoadStressEngine {
  static async simulateConcurrentExecution(_users: number): Promise<never> {
    throw new Error(
      'FullLoadStressEngine is not implemented. The previous version returned ' +
      'fake passing results with no real load applied. Use tests/load/k6-load-test.js ' +
      '(k6/Artillery/Locust) against a real running instance for actual load-test evidence.'
    );
  }
}
