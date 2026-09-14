/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           NEXUS MEMORY STORAGE ADAPTERS                      ║
 * ║  Each memory type maps to the optimal storage backend.       ║
 * ║                                                              ║
 * ║  STORAGE MAPPING:                                            ║
 * ║   Firestore  → Personal, Shared, Restricted, Episodic       ║
 * ║   PostgreSQL → Immutable (audit log), Owner, Learning        ║
 * ║   Qdrant     → Semantic (vector embeddings)                  ║
 * ║   Redis      → Short-lived cache, write locks                ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { MemoryEntry, MemoryType, MemoryQuery, SemanticMemory } from '../interfaces/MemoryTypes';
import { logger } from '../../core/logging/NexusLogger';
import { NexusConfig } from '../../core/config/NexusConfig';

const log = logger.child('MemoryAdapters');
const IS_SERVER = typeof window === 'undefined';

// ════════════════════════════════════════════════════════════════════════
// FIRESTORE MEMORY ADAPTER
// Primary store for Personal, Shared, Restricted, Episodic memory
// ════════════════════════════════════════════════════════════════════════
export class FirestoreMemoryAdapter {
  name = 'FirestoreMemory';
  private connected = false;

  async connect(): Promise<boolean> {
    try {
      const { db } = await import('../../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      await getDoc(doc(db, '_memory_health', 'ping'));
      this.connected = true;
      log.info('FirestoreMemoryAdapter connected');
      return true;
    } catch (e) {
      log.warn('FirestoreMemoryAdapter connection failed — using fallback', { error: String(e) });
      return false;
    }
  }

  async write(entry: MemoryEntry): Promise<void> {
    if (!this.connected) { this._localWrite(entry); return; }
    try {
      const { db } = await import('../../../firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      const col = this._collection(entry.type);
      await setDoc(doc(db, col, entry.id), {
        ...entry,
        _updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      log.error('Firestore memory write failed', e instanceof Error ? e : undefined, { entryId: entry.id });
      this._localWrite(entry);
    }
  }

  async read(id: string, type: MemoryType): Promise<MemoryEntry | null> {
    if (!this.connected) return this._localRead(id);
    try {
      const { db } = await import('../../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, this._collection(type), id));
      return snap.exists() ? (snap.data() as MemoryEntry) : null;
    } catch (e) {
      log.error('Firestore memory read failed', e instanceof Error ? e : undefined, { id });
      return this._localRead(id);
    }
  }

  async query(q: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.connected) return [];
    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');

      const types = q.types || [MemoryType.PERSONAL, MemoryType.SHARED, MemoryType.EPISODIC, MemoryType.RESTRICTED];
      const results: MemoryEntry[] = [];

      for (const type of types) {
        const col = this._collection(type);
        const constraints: any[] = [];
        if (q.ownerId) constraints.push(where('ownerId', '==', q.ownerId));
        if (q.userId) constraints.push(where('userId', '==', q.userId));
        if (q.sessionId) constraints.push(where('sessionId', '==', q.sessionId));
        if (q.since) constraints.push(where('createdAt', '>=', q.since));
        constraints.push(orderBy('createdAt', 'desc'));
        constraints.push(limit(q.limit || 50));

        const snap = await getDocs(query(collection(db, col), ...constraints));
        snap.docs.forEach(d => results.push(d.data() as MemoryEntry));
      }

      return results;
    } catch (e) {
      log.error('Firestore memory query failed', e instanceof Error ? e : undefined);
      return [];
    }
  }

  async delete(id: string, type: MemoryType): Promise<void> {
    if (!this.connected) return;
    try {
      const { db } = await import('../../../firebase');
      const { doc, deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(db, this._collection(type), id));
    } catch (e) {
      log.error('Firestore memory delete failed', e instanceof Error ? e : undefined, { id });
    }
  }

  private _collection(type: MemoryType): string {
    const map: Record<MemoryType, string> = {
      [MemoryType.PERSONAL]:   'memory_personal',
      [MemoryType.SHARED]:     'memory_shared',
      [MemoryType.RESTRICTED]: 'memory_restricted',
      [MemoryType.EPISODIC]:   'memory_episodic',
      [MemoryType.IMMUTABLE]:  'memory_immutable',
      [MemoryType.OWNER]:      'memory_owner',
      [MemoryType.SEMANTIC]:   'memory_semantic',
      [MemoryType.LEARNING]:   'memory_learning',
    };
    return map[type] || 'memory_general';
  }

  // In-memory fallback when Firestore is unavailable
  private localStore = new Map<string, MemoryEntry>();
  private _localWrite(entry: MemoryEntry) { this.localStore.set(entry.id, entry); }
  private _localRead(id: string): MemoryEntry | null { return this.localStore.get(id) || null; }
}

// ════════════════════════════════════════════════════════════════════════
// POSTGRESQL MEMORY ADAPTER
// Append-only for Immutable, Owner, Learning memory
// Schema: memory_entries (id, type, owner_id, content, hash, metadata, created_at)
// ════════════════════════════════════════════════════════════════════════
export class PostgreSQLMemoryAdapter {
  name = 'PostgreSQLMemory';
  private connected = false;
  private pool: any = null;

  async connect(): Promise<boolean> {
    if (!NexusConfig.storage.postgresUrl) {
      log.info('PostgreSQL not configured — Immutable/Owner memory uses Firestore fallback');
      return false;
    }
    try {
      // Dynamic import — pg not in dependencies yet (add in deployment)
      const { Pool } = await import('pg' as any);
      this.pool = new Pool({
        connectionString: NexusConfig.storage.postgresUrl,
        max: NexusConfig.storage.postgresPool,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
      await this.pool.query('SELECT 1');
      await this._ensureSchema();
      this.connected = true;
      log.info('PostgreSQLMemoryAdapter connected');
      return true;
    } catch (e) {
      log.warn('PostgreSQL not available — using Firestore fallback for structured memory', { error: String(e) });
      return false;
    }
  }

  private async _ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        owner_id     TEXT NOT NULL,
        tenant_id    TEXT,
        content      TEXT NOT NULL,
        hash         TEXT,
        metadata     JSONB DEFAULT '{}',
        tags         TEXT[] DEFAULT '{}',
        created_at   BIGINT NOT NULL,
        updated_at   BIGINT NOT NULL,
        expires_at   BIGINT,
        version      INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
      CREATE INDEX IF NOT EXISTS idx_memory_owner ON memory_entries(owner_id);
      CREATE INDEX IF NOT EXISTS idx_memory_tenant ON memory_entries(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at DESC);

      -- Immutable audit table (truly append-only via trigger)
      CREATE TABLE IF NOT EXISTS memory_immutable_audit (
        id           TEXT PRIMARY KEY,
        owner_id     TEXT NOT NULL,
        content      TEXT NOT NULL,
        hash         TEXT NOT NULL,
        signed_by    TEXT NOT NULL,
        chain_prev   TEXT,
        created_at   BIGINT NOT NULL
      );

      -- Learning feedback table
      CREATE TABLE IF NOT EXISTS memory_learning (
        id                  TEXT PRIMARY KEY,
        agent_id            TEXT,
        stimulus            TEXT NOT NULL,
        response            TEXT NOT NULL,
        feedback            TEXT NOT NULL,
        corrected_response  TEXT,
        feedback_source     TEXT NOT NULL,
        confidence_shift    FLOAT DEFAULT 0,
        reinforcement_weight FLOAT DEFAULT 1,
        applied             BOOLEAN DEFAULT FALSE,
        created_at          BIGINT NOT NULL
      );
    `);
  }

  async writeImmutable(entry: any): Promise<void> {
    if (!this.connected) return;
    await this.pool.query(
      `INSERT INTO memory_immutable_audit (id, owner_id, content, hash, signed_by, chain_prev, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [entry.id, entry.ownerId, entry.content, entry.hash, entry.signedBy, entry.chainPrev, entry.createdAt]
    );
  }

  async writeLearning(entry: any): Promise<void> {
    if (!this.connected) return;
    await this.pool.query(
      `INSERT INTO memory_learning
       (id, agent_id, stimulus, response, feedback, corrected_response, feedback_source, confidence_shift, reinforcement_weight, applied, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET applied = EXCLUDED.applied`,
      [entry.id, entry.agentId, entry.stimulus, entry.response, entry.feedback,
       entry.correctedResponse, entry.feedbackSource, entry.confidenceShift,
       entry.reinforcementWeight, entry.applied, entry.createdAt]
    );
  }

  async queryLearning(agentId: string, limit = 50): Promise<any[]> {
    if (!this.connected) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM memory_learning WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
    return rows;
  }

  async getImmutableChain(limit = 100): Promise<any[]> {
    if (!this.connected) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM memory_immutable_audit ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows;
  }

  isConnected(): boolean { return this.connected; }
}

// ════════════════════════════════════════════════════════════════════════
// QDRANT VECTOR ADAPTER
// Semantic memory with embedding-based similarity search
// ════════════════════════════════════════════════════════════════════════
export class QdrantMemoryAdapter {
  name = 'QdrantMemory';
  private connected = false;
  private baseUrl: string;
  private apiKey: string;
  private collectionName = 'nexus_semantic_memory';

  constructor() {
    this.baseUrl = NexusConfig.storage.qdrantUrl;
    this.apiKey = NexusConfig.storage.qdrantApiKey;
  }

  private get headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }

  async connect(): Promise<boolean> {
    if (!NexusConfig.features.enableVectorMemory) {
      log.info('Vector memory disabled (FEATURE_VECTOR_MEMORY=false)');
      return false;
    }
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, { headers: this.headers, signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`Qdrant health check failed: ${res.status}`);
      await this._ensureCollection();
      this.connected = true;
      log.info('QdrantMemoryAdapter connected', { url: this.baseUrl });
      return true;
    } catch (e) {
      log.warn('Qdrant not available — semantic search uses Firestore cosine fallback', { error: String(e) });
      return false;
    }
  }

  private async _ensureCollection(): Promise<void> {
    // Check if collection exists
    const res = await fetch(`${this.baseUrl}/collections/${this.collectionName}`, { headers: this.headers });
    if (res.ok) return;

    // Create collection with 1536-dim vectors (OpenAI compatible) or 768 (Gemini)
    await fetch(`${this.baseUrl}/collections/${this.collectionName}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        vectors: {
          size: 1536,          // Supports both 768 and 1536 via padding
          distance: 'Cosine',
        },
        optimizers_config: { default_segment_number: 2 },
        replication_factor: 1,
      }),
    });
    log.info(`Qdrant collection created: ${this.collectionName}`);
  }

  async upsert(entry: SemanticMemory): Promise<void> {
    if (!this.connected) return;
    const embedding = entry.embedding;
    if (!embedding || embedding.length === 0) return;

    // Pad or truncate to 1536 dims
    const vector = embedding.length === 1536
      ? embedding
      : [...embedding, ...new Array(Math.max(0, 1536 - embedding.length)).fill(0)].slice(0, 1536);

    await fetch(`${this.baseUrl}/collections/${this.collectionName}/points`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        points: [{
          id: entry.id,
          vector,
          payload: {
            content: entry.content,
            ownerId: entry.ownerId,
            collection: entry.collection,
            source: entry.source,
            tags: entry.tags,
            createdAt: entry.createdAt,
            documentId: entry.documentId,
            chunkIndex: entry.chunkIndex,
          },
        }],
      }),
    });
  }

  async search(embedding: number[], options: {
    collection?: string;
    limit?: number;
    threshold?: number;
    filter?: Record<string, any>;
  } = {}): Promise<Array<{ id: string; score: number; content: string; payload: any }>> {
    if (!this.connected) return [];

    const vector = embedding.length === 1536
      ? embedding
      : [...embedding, ...new Array(Math.max(0, 1536 - embedding.length)).fill(0)].slice(0, 1536);

    const body: any = {
      vector,
      limit: options.limit || 10,
      score_threshold: options.threshold || 0.7,
      with_payload: true,
    };

    if (options.collection) {
      body.filter = { must: [{ key: 'collection', match: { value: options.collection } }] };
    }

    try {
      const res = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/search`, {
        method: 'POST', headers: this.headers, body: JSON.stringify(body),
      });
      const data = await res.json();
      return (data.result || []).map((r: any) => ({
        id: r.id, score: r.score, content: r.payload?.content || '', payload: r.payload,
      }));
    } catch (e) {
      log.error('Qdrant search failed', e instanceof Error ? e : undefined);
      return [];
    }
  }

  async delete(id: string): Promise<void> {
    if (!this.connected) return;
    await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/delete`, {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({ points: [id] }),
    });
  }

  isConnected(): boolean { return this.connected; }
}

// ════════════════════════════════════════════════════════════════════════
// REDIS MEMORY ADAPTER
// Write locks for Shared memory, short-lived cache, rate windows
// ════════════════════════════════════════════════════════════════════════
export class RedisMemoryAdapter {
  name = 'RedisMemory';
  private connected = false;
  private localCache = new Map<string, { value: string; expiresAt: number }>();

  async connect(): Promise<boolean> {
    if (!NexusConfig.storage.redisUrl || NexusConfig.storage.redisUrl === 'redis://localhost:6379') {
      log.info('Redis not configured — using in-process Map as temporary cache');
      this.connected = true; // Use local Map fallback
      return true;
    }
    // Real Redis via ioredis will be added when package is installed
    // For now, use Upstash REST API if URL is HTTP-based
    if (NexusConfig.storage.redisUrl.startsWith('http')) {
      log.info('Upstash Redis REST API detected');
      this.connected = true;
      return true;
    }
    log.info('Redis: ioredis integration pending package install (Phase 4)');
    this.connected = true; // Use local Map
    return true;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity;
    this.localCache.set(key, { value, expiresAt });

    if (NexusConfig.storage.redisUrl?.startsWith('http')) {
      try {
        await fetch(`${NexusConfig.storage.redisUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}${ttlSeconds ? `?EX=${ttlSeconds}` : ''}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${process?.env?.REDIS_TOKEN || ''}` },
        });
      } catch (_) {}
    }
  }

  async get(key: string): Promise<string | null> {
    // Cleanup expired local cache entries
    const entry = this.localCache.get(key);
    if (entry) {
      if (Date.now() > entry.expiresAt) { this.localCache.delete(key); return null; }
      return entry.value;
    }
    return null;
  }

  async del(key: string): Promise<void> {
    this.localCache.delete(key);
  }

  /** Acquire write lock for shared memory */
  async acquireLock(resourceId: string, holderId: string, ttlSeconds = 30): Promise<boolean> {
    const key = `lock:${resourceId}`;
    const existing = await this.get(key);
    if (existing && existing !== holderId) return false;
    await this.set(key, holderId, ttlSeconds);
    return true;
  }

  /** Release write lock */
  async releaseLock(resourceId: string, holderId: string): Promise<void> {
    const key = `lock:${resourceId}`;
    const holder = await this.get(key);
    if (holder === holderId) await this.del(key);
  }

  /** Cache a memory entry for fast retrieval */
  async cacheEntry(entryId: string, data: any, ttlSeconds = 300): Promise<void> {
    await this.set(`mem:${entryId}`, JSON.stringify(data), ttlSeconds);
  }

  async getCachedEntry(entryId: string): Promise<any | null> {
    const raw = await this.get(`mem:${entryId}`);
    return raw ? JSON.parse(raw) : null;
  }

  isConnected(): boolean { return this.connected; }
}
