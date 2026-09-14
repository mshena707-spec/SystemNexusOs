/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         SHARED STATE STORE — Phase A Replacement            ║
 * ║                                                              ║
 * ║  Replaces the in-process `sharedMemory` object in server.ts ║
 * ║  that caused split-brain on multi-instance deployment.       ║
 * ║                                                              ║
 * ║  Strategy:                                                   ║
 * ║   Redis (primary) → Firestore (fallback) → in-memory (dev)  ║
 * ║                                                              ║
 * ║  All keys are namespaced per-deployment to avoid collisions. ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { logger } from './logging/NexusLogger';

const log = logger.child('SharedState');

// ── Types ──────────────────────────────────────────────────────────────────
export interface PendingApproval {
  id: string;
  message: string;
  sessionId: string;
  userId: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  response?: string;
}

export interface ApiLogEntry {
  timestamp: string;
  method: string;
  url: string;
  status: number;
  duration: string;
}

// ── Redis client (lazy, optional) ─────────────────────────────────────────
let redis: any = null;

async function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    await redis.ping();
    log.info('Redis connected for SharedStateStore');
    return redis;
  } catch (err) {
    log.warn('Redis unavailable — falling back to Firestore for shared state');
    redis = null;
    return null;
  }
}

// ── Firestore fallback ─────────────────────────────────────────────────────
async function firestoreGet(key: string): Promise<any> {
  try {
    const { db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'shared_state', key));
    return snap.exists() ? snap.data()?.value : null;
  } catch { return null; }
}

async function firestoreSet(key: string, value: any): Promise<void> {
  try {
    const { db } = await import('../../firebase');
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    await setDoc(doc(db, 'shared_state', key), { value, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    log.error('Firestore shared state write failed', { key, err });
  }
}

// ── In-memory fallback (dev / no backend) ─────────────────────────────────
const memStore = new Map<string, any>();

const NS = process.env.DEPLOY_ID || 'nexus';

// ── Public API ─────────────────────────────────────────────────────────────
export class SharedStateStore {
  /**
   * Phase N: expose the underlying Redis client (if connected) for callers
   * that need TRUE atomic operations (INCR, sliding-window counters) rather
   * than the read-modify-write get()/set() pair above, which has a race
   * window across multiple server instances. Returns null if Redis is not
   * configured — callers must handle the in-process fallback themselves
   * (see DistributedRateLimiter).
   */
  static async getRedisClient(): Promise<any | null> {
    return getRedis();
  }

  static async get<T = any>(key: string): Promise<T | null> {
    const r = await getRedis();
    const fullKey = `${NS}:${key}`;
    if (r) {
      const val = await r.get(fullKey);
      return val ? JSON.parse(val) : null;
    }
    const fv = await firestoreGet(key);
    if (fv !== null) return fv as T;
    return (memStore.get(key) ?? null) as T | null;
  }

  static async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const r = await getRedis();
    const fullKey = `${NS}:${key}`;
    if (r) {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await r.setex(fullKey, ttlSeconds, serialized);
      } else {
        await r.set(fullKey, serialized);
      }
      return;
    }
    await firestoreSet(key, value);
    memStore.set(key, value);
  }

  static async delete(key: string): Promise<void> {
    const r = await getRedis();
    if (r) { await r.del(`${NS}:${key}`); return; }
    memStore.delete(key);
  }

  // ── Pending Approvals ────────────────────────────────────────────────────
  static async pushApproval(approval: PendingApproval): Promise<void> {
    const list: PendingApproval[] = (await this.get('pendingApprovals')) ?? [];
    list.push(approval);
    await this.set('pendingApprovals', list);
  }

  static async getApprovals(): Promise<PendingApproval[]> {
    return (await this.get('pendingApprovals')) ?? [];
  }

  static async resolveApproval(id: string, status: 'approved' | 'rejected', response?: string): Promise<PendingApproval | null> {
    const list: PendingApproval[] = (await this.get('pendingApprovals')) ?? [];
    const idx = list.findIndex(a => a.id === id);
    if (idx === -1) return null;
    const approval = list[idx];
    approval.status = status;
    if (response) approval.response = response;
    list.splice(idx, 1);
    await this.set('pendingApprovals', list);
    return approval;
  }

  // ── API Logs (ring buffer, 500 entries) ───────────────────────────────────
  static async pushApiLog(entry: ApiLogEntry): Promise<void> {
    const r = await getRedis();
    const key = `${NS}:apiLogs`;
    if (r) {
      await r.lpush(key, JSON.stringify(entry));
      await r.ltrim(key, 0, 499);
      return;
    }
    const logs: ApiLogEntry[] = (await this.get('apiLogs')) ?? [];
    logs.unshift(entry);
    if (logs.length > 500) logs.length = 500;
    await this.set('apiLogs', logs);
  }

  static async getApiLogs(limit = 100): Promise<ApiLogEntry[]> {
    const r = await getRedis();
    if (r) {
      const raw = await r.lrange(`${NS}:apiLogs`, 0, limit - 1);
      return raw.map((s: string) => JSON.parse(s));
    }
    const all: ApiLogEntry[] = (await this.get('apiLogs')) ?? [];
    return all.slice(0, limit);
  }

  // ── Local Knowledge Cache ─────────────────────────────────────────────────
  static async getKnowledge(key: string): Promise<string | null> {
    const map: Record<string, string> = (await this.get('localKnowledge')) ?? {};
    return map[key] ?? null;
  }

  static async setKnowledge(key: string, value: string): Promise<void> {
    const map: Record<string, string> = (await this.get('localKnowledge')) ?? {};
    map[key] = value;
    await this.set('localKnowledge', map);
  }

  // ── Rider Status ─────────────────────────────────────────────────────────
  static async setRiderStatus(riderId: string, status: any): Promise<void> {
    await this.set(`riderStatus:${riderId}`, status, 300); // 5 min TTL
  }

  static async getRiderStatus(riderId: string): Promise<any | null> {
    return this.get(`riderStatus:${riderId}`);
  }

  static async getAllRiderStatuses(): Promise<Record<string, any>> {
    const r = await getRedis();
    if (r) {
      const keys = await r.keys(`${NS}:riderStatus:*`);
      const result: Record<string, any> = {};
      for (const k of keys) {
        const rid = k.replace(`${NS}:riderStatus:`, '');
        const val = await r.get(k);
        if (val) result[rid] = JSON.parse(val);
      }
      return result;
    }
    // fallback: scan memStore
    const result: Record<string, any> = {};
    for (const [k, v] of memStore.entries()) {
      if (k.startsWith('riderStatus:')) {
        result[k.replace('riderStatus:', '')] = v;
      }
    }
    return result;
  }
}
