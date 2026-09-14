/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DISTRIBUTED RATE LIMITER — Phase N                                  ║
 * ║                                                                      ║
 * ║  Fixes a real multi-instance correctness gap: several modules        ║
 * ║  (AnomalyDetectionEngine rate checks, FraudDetectionEngine order     ║
 * ║  velocity, ToolRegistry rate limiting, TenantIsolation usage caps)    ║
 * ║  track sliding-window counters in process-local `Map` objects.       ║
 * ║                                                                      ║
 * ║  Under a SINGLE server instance this is correct. Under N instances   ║
 * ║  behind a load balancer, each instance has its OWN counter — a user  ║
 * ║  hammering the API gets (N × threshold) requests through before any  ║
 * ║  single instance notices, because the load balancer spreads their   ║
 * ║  requests across instances that don't share state.                  ║
 * ║                                                                      ║
 * ║  This module provides a Redis-backed atomic sliding-window counter   ║
 * ║  (via SharedStateStore's Redis client) that is correct across any    ║
 * ║  number of instances, with an automatic in-process fallback when     ║
 * ║  Redis isn't configured (matching the existing SharedStateStore      ║
 * ║  failover pattern from Phase A, so behavior on a single dev instance ║
 * ║  is unchanged).                                                      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// In-process fallback store (used only when Redis is not configured —
// correctness on a single instance, same as the original behavior).
const fallbackWindows = new Map<string, number[]>();

export class DistributedRateLimiter {

  /**
   * Increment the counter for `key` within a sliding window of `windowMs`,
   * and return the current count after incrementing. Correct across all
   * server instances when Redis is configured; falls back to an in-process
   * sliding window (correct only within this instance) otherwise.
   */
  static async hit(key: string, windowMs: number): Promise<number> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();

    if (redis) {
      // Redis sorted-set sliding window: ZADD the current timestamp, trim
      // anything older than the window, then count remaining members.
      // Atomic via a single MULTI pipeline — no race between instances.
      const now = Date.now();
      const redisKey = `ratelimit:${key}`;
      const pipeline = redis.multi();
      pipeline.zadd(redisKey, now, `${now}-${Math.random().toString(36).slice(2,8)}`);
      pipeline.zremrangebyscore(redisKey, 0, now - windowMs);
      pipeline.zcard(redisKey);
      pipeline.expire(redisKey, Math.ceil(windowMs / 1000) + 5);
      const results = await pipeline.exec();
      // results: [ [err,zaddRes], [err,zremRes], [err,zcardRes], [err,expireRes] ]
      const count = results?.[2]?.[1];
      return typeof count === 'number' ? count : 1;
    }

    // Fallback: in-process sliding window (correct on a single instance)
    const now = Date.now();
    const ts = (fallbackWindows.get(key) ?? []).filter(t => now - t < windowMs);
    ts.push(now);
    fallbackWindows.set(key, ts);
    return ts.length;
  }

  /**
   * Read-only count check (does not increment). Useful for dashboards.
   */
  static async count(key: string, windowMs: number): Promise<number> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();
    const now = Date.now();

    if (redis) {
      const redisKey = `ratelimit:${key}`;
      await redis.zremrangebyscore(redisKey, 0, now - windowMs);
      return redis.zcard(redisKey);
    }

    const ts = (fallbackWindows.get(key) ?? []).filter(t => now - t < windowMs);
    return ts.length;
  }

  /** Reset a counter (e.g. after a successful login clears brute-force tracking). */
  static async reset(key: string): Promise<void> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();
    if (redis) {
      await redis.del(`ratelimit:${key}`);
    } else {
      fallbackWindows.delete(key);
    }
  }

  /** Convenience: check + increment + decide in one call, threshold-aware. */
  static async check(key: string, windowMs: number, threshold: number): Promise<{ exceeded: boolean; count: number }> {
    const count = await this.hit(key, windowMs);
    return { exceeded: count > threshold, count };
  }
}
