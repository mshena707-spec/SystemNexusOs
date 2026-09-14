/**
 * NexusCache — Redis Hot-Data Cache Layer
 *
 * WHY: Every page load fetching products from Firestore/DB is:
 *   - Slow (50-200ms per query)
 *   - Expensive (Firestore charges per read)
 *   - Unscalable (10,000 users = 10,000 concurrent DB reads)
 *
 * vs World-class:
 *   Amazon:  CDN + Redis + DynamoDB DAX (microsecond reads)
 *   Shopify: Varnish cache + Redis + CDN per storefront
 *   Daraz:   Redis cluster for product catalog
 *
 * Strategy:
 *   - Products: 5-minute TTL (changes infrequently)
 *   - Feature flags: 1-minute TTL (hot-reloaded)
 *   - User sessions: 30-minute TTL
 *   - Search index: 5-minute TTL
 *   - Price: 1-minute TTL (can change with dynamic pricing)
 *   - Tax rules: 1-hour TTL
 *
 * Falls back to direct DB if Redis unavailable.
 */

let redisClient: Record<string, (...args: unknown[]) => unknown> | null = null;

async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = await import('redis');
    const c = createClient({ url });
    await c.connect();
    c.on('error', () => { redisClient = null; });
    redisClient = c as unknown as typeof redisClient;
    return redisClient;
  } catch { return null; }
}

// In-memory fallback (L1 cache — process-local)
const memCache = new Map<string, { value: unknown; expiresAt: number }>();

export interface CacheOptions {
  ttlSeconds: number;
  tags?: string[];         // For tag-based invalidation (e.g., invalidate all 'products')
}

// Pre-defined TTL constants
export const TTL = {
  PRODUCT:         5 * 60,      // 5 minutes
  PRODUCT_LISTING: 2 * 60,      // 2 minutes
  PRICE:           1 * 60,      // 1 minute
  FEATURE_FLAGS:   1 * 60,      // 1 minute
  USER_SESSION:    30 * 60,     // 30 minutes
  SEARCH_INDEX:    5 * 60,      // 5 minutes
  TAX_RULES:       60 * 60,     // 1 hour
  SHIPPING_RATES:  10 * 60,     // 10 minutes
  VENDOR_INFO:     15 * 60,     // 15 minutes
  RIDER_LOCATION:  10,          // 10 seconds (GPS updates)
  ORDER_STATUS:    30,          // 30 seconds
  AI_RESPONSE:     24 * 60 * 60, // 24 hours (stable responses)
};

export class NexusCache {

  // ── Get ──────────────────────────────────────────────────────────────────

  static async get<T>(key: string): Promise<T | null> {
    // L1: in-memory
    const mem = memCache.get(key);
    if (mem && mem.expiresAt > Date.now()) {
      return mem.value as T;
    }
    memCache.delete(key);

    // L2: Redis
    const redis = await getRedis();
    if (redis) {
      try {
        const value = await redis.get(key) as string | null;
        if (value) {
          const parsed = JSON.parse(value) as T;
          // Populate L1 for next request
          memCache.set(key, { value: parsed, expiresAt: Date.now() + 30_000 });
          return parsed;
        }
      } catch { /* Redis error — fall through */ }
    }

    return null;
  }

  // ── Set ──────────────────────────────────────────────────────────────────

  static async set<T>(key: string, value: T, options: CacheOptions | number): Promise<void> {
    const ttlSeconds = typeof options === 'number' ? options : options.ttlSeconds;
    const serialized = JSON.stringify(value);

    // L1: in-memory
    memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });

    // L2: Redis
    const redis = await getRedis();
    if (redis) {
      try {
        await redis.setEx(key, ttlSeconds, serialized);

        // Tag tracking (for bulk invalidation)
        if (typeof options === 'object' && options.tags) {
          for (const tag of options.tags) {
            await redis.sAdd(`tag:${tag}`, key);
            await redis.expire(`tag:${tag}`, ttlSeconds + 60);
          }
        }
      } catch { /* Redis error — L1 still works */ }
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  static async delete(key: string): Promise<void> {
    memCache.delete(key);
    const redis = await getRedis();
    if (redis) {
      try { await redis.del(key); } catch { /* ignore */ }
    }
  }

  // ── Invalidate by tag (e.g., invalidate all 'products' cache) ─────────────

  static async invalidateTag(tag: string): Promise<void> {
    // Clear L1
    for (const key of memCache.keys()) {
      if (key.includes(tag)) memCache.delete(key);
    }

    // Clear L2
    const redis = await getRedis();
    if (redis) {
      try {
        const keys = await redis.sMembers(`tag:${tag}`) as string[];
        if (keys.length > 0) {
          await redis.del(...keys, `tag:${tag}`);
        }
      } catch { /* ignore */ }
    }
  }

  // ── Cache-aside pattern ─────────────────────────────────────────────────
  // Usage: const product = await NexusCache.getOrSet(key, () => fetchFromDB(), TTL.PRODUCT)

  static async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number,
    tags?: string[]
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await fetchFn();
    await this.set(key, value, { ttlSeconds, tags });
    return value;
  }

  // ── Product-specific helpers ──────────────────────────────────────────────

  static productKey(productId: string) { return `product:${productId}`; }
  static listingKey(category: string, page: number) { return `listing:${category}:p${page}`; }
  static priceKey(productId: string) { return `price:${productId}`; }
  static searchIndexKey() { return 'search:index'; }
  static featureFlagsKey() { return 'features:flags'; }
  static vendorKey(vendorId: string) { return `vendor:${vendorId}`; }

  // ── Stats ─────────────────────────────────────────────────────────────────

  static getL1Stats(): { size: number; keys: string[] } {
    const now = Date.now();
    // Clean expired
    for (const [key, entry] of memCache.entries()) {
      if (entry.expiresAt <= now) memCache.delete(key);
    }
    return { size: memCache.size, keys: Array.from(memCache.keys()) };
  }
}

export default NexusCache;
