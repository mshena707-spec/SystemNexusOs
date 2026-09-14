/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DISTRIBUTED COUNTER — Phase N                                       ║
 * ║                                                                      ║
 * ║  Fixes the same class of bug as DistributedRateLimiter, for          ║
 * ║  cumulative counters rather than sliding windows — specifically      ║
 * ║  AIProviderOrchestrator's `userSpend` Map (Phase D budget guard).    ║
 * ║                                                                      ║
 * ║  Under multiple instances, an in-process Map means each instance     ║
 * ║  tracks its own copy of "how much has this user spent today". A      ║
 * ║  user whose requests are load-balanced across 3 instances can spend  ║
 * ║  up to 3× DAILY_COST_LIMIT before any single instance's local        ║
 * ║  counter reaches the cap — the budget guard is silently bypassed.    ║
 * ║                                                                      ║
 * ║  Uses Redis INCRBYFLOAT (atomic) via SharedStateStore's Redis        ║
 * ║  client when available; falls back to an in-process Map otherwise   ║
 * ║  (correct on a single instance, matching pre-Phase-N behavior).      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fallbackCounters = new Map<string, number>();

export class DistributedCounter {

  /** Atomically add `amount` to the counter at `key` and return the new total. */
  static async increment(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();

    if (redis) {
      const redisKey = `counter:${key}`;
      const newVal = await redis.incrbyfloat(redisKey, amount);
      if (ttlSeconds) await redis.expire(redisKey, ttlSeconds);
      return parseFloat(newVal);
    }

    const current = fallbackCounters.get(key) ?? 0;
    const updated = current + amount;
    fallbackCounters.set(key, updated);
    return updated;
  }

  /** Read the current value without modifying it. */
  static async get(key: string): Promise<number> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();

    if (redis) {
      const val = await redis.get(`counter:${key}`);
      return val ? parseFloat(val) : 0;
    }

    return fallbackCounters.get(key) ?? 0;
  }

  /** Reset a counter to zero (e.g. daily budget reset at midnight). */
  static async reset(key: string): Promise<void> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();

    if (redis) {
      await redis.del(`counter:${key}`);
    } else {
      fallbackCounters.delete(key);
    }
  }

  /**
   * Reset every counter whose key starts with `prefix`. Used by
   * AIProviderOrchestrator.resetDailySpend() to clear all per-user spend
   * counters at once. Redis path uses SCAN (non-blocking); fallback path
   * iterates the in-process Map.
   */
  static async resetByPrefix(prefix: string): Promise<number> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();
    let cleared = 0;

    if (redis) {
      let cursor = '0';
      const matchPattern = `counter:${prefix}*`;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
          cleared += keys.length;
        }
      } while (cursor !== '0');
      return cleared;
    }

    for (const key of Array.from(fallbackCounters.keys())) {
      if (key.startsWith(prefix)) { fallbackCounters.delete(key); cleared++; }
    }
    return cleared;
  }

  /**
   * Snapshot all counters under a prefix as a map — used for the admin
   * spend dashboard ("per-user spend today" breakdown).
   * Redis path uses SCAN + MGET; fallback path reads the in-process Map.
   */
  static async snapshotByPrefix(prefix: string): Promise<Record<string, number>> {
    const { SharedStateStore } = await import('../core/SharedStateStore');
    const redis = await SharedStateStore.getRedisClient();
    const result: Record<string, number> = {};

    if (redis) {
      let cursor = '0';
      const matchPattern = `counter:${prefix}*`;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          const values = await redis.mget(...keys);
          keys.forEach((k: string, i: number) => {
            const shortKey = k.replace('counter:', '');
            result[shortKey] = values[i] ? parseFloat(values[i]) : 0;
          });
        }
      } while (cursor !== '0');
      return result;
    }

    for (const [key, val] of fallbackCounters.entries()) {
      if (key.startsWith(prefix)) result[key] = val;
    }
    return result;
  }
}
