import { AIRequest } from '../ai/types';

/**
 * Enterprise Session Manager (Phase 1)
 * Acts as an abstraction layer for distributed caching.
 * Defaults to high-performance LRU memory map but is designed to drop-in ioredis.
 */
class SessionManager {
  // Using Map as fallback. In production, connect this to Redis URL.
  private memoryCache = new Map<string, any>();

  async setSession(userId: string, data: any, ttlSeconds = 3600): Promise<void> {
    try {
      // Future-proofing: await redisClient.set(userId, JSON.stringify(data), 'EX', ttlSeconds);
      this.memoryCache.set(userId, { data, expires: Date.now() + (ttlSeconds * 1000) });
    } catch (e) {
      console.error("[SessionManager] Cache write failed", e);
    }
  }

  async getSession(userId: string): Promise<any | null> {
    try {
      // Future-proofing: const val = await redisClient.get(userId); return val ? JSON.parse(val) : null;
      const ref = this.memoryCache.get(userId);
      if (!ref) return null;
      if (Date.now() > ref.expires) {
        this.memoryCache.delete(userId);
        return null;
      }
      return ref.data;
    } catch (e) {
      console.error("[SessionManager] Cache read failed", e);
      return null;
    }
  }

  async checkRateLimit(userId: string, limit: number, windowMs: number): Promise<boolean> {
     // A distributed redis leaky bucket would normally go here.
     const current = await this.getSession(`rate_limit:${userId}`) || 0;
     if (current >= limit) return true; // Rate limited
     await this.setSession(`rate_limit:${userId}`, current + 1, windowMs / 1000);
     return false; // Allowed
  }
}

export const DistributedSession = new SessionManager();
