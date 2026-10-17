/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  NEXUS DB — Phase E                                                  ║
 * ║                                                                      ║
 * ║  THE SINGLE ENTRY POINT FOR ALL DATABASE OPERATIONS.               ║
 * ║                                                                      ║
 * ║  Business logic must NEVER import from 'firebase/firestore' or      ║
 * ║  any database SDK directly. All DB access goes through NexusDB.     ║
 * ║                                                                      ║
 * ║  Supported backends (pluggable, configured via env):                ║
 * ║    Firestore   → DB_PROVIDER=firestore (default)                    ║
 * ║    PostgreSQL  → DB_PROVIDER=postgres  + POSTGRES_URL               ║
 * ║    Supabase    → DB_PROVIDER=supabase  + SUPABASE_URL               ║
 * ║    MongoDB     → DB_PROVIDER=mongodb   + MONGODB_URI                ║
 * ║    In-Memory   → DB_PROVIDER=memory    (testing / standalone)       ║
 * ║                                                                      ║
 * ║  Usage:                                                              ║
 * ║    import { NexusDB } from '@/lib/database/NexusDB';                ║
 * ║    const order = await NexusDB.get('orders', orderId);              ║
 * ║    const id    = await NexusDB.add('orders', { ... });              ║
 * ║    await NexusDB.update('orders', id, { status: 'Delivered' });     ║
 * ║    const list  = await NexusDB.find('orders', {                     ║
 * ║      where: [{ field: 'userId', op: '==', value: uid }],            ║
 * ║      orderBy: 'createdAt', orderDir: 'desc', limit: 20             ║
 * ║    });                                                               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ── Environment access that is safe in BOTH Node and the browser ─────────────
// This file is shared by the server and the browser bundle. A bare `process.env.X` throws
// "process is not defined" in a browser, so every read goes through this object instead.
const ENV: Record<string, string | undefined> =
  (typeof process !== 'undefined' && (process as any).env) ? (process as any).env : {};

// ── Types ────────────────────────────────────────────────────────────────

export interface WhereClause {
  field: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';
  value: any;
}

export interface FindOptions {
  where?: WhereClause[];
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  startAfter?: any;      // cursor for pagination
}

export interface WriteResult {
  id: string;
}

export interface BatchWrite {
  type: 'set' | 'update' | 'delete';
  collection: string;
  id: string;
  data?: Record<string, any>;
}

/** The interface a runTransaction() callback receives. Intentionally minimal
 *  (get + update only) — matches exactly what the real caller,
 *  InventoryReservationService.ts, needs, rather than exposing the full
 *  adapter surface inside a transaction context where not every operation
 *  (e.g. find() with complex queries) is meaningfully transactional anyway. */
export interface NexusDBTransaction {
  get(collection: string, id: string): Promise<Record<string, any> | null>;
  update(collection: string, id: string, data: Record<string, any>): Promise<void>;
  /** Create or merge a document inside the transaction (available on PostgreSQL). */
  set?(collection: string, id: string, data: Record<string, any>): Promise<void>;
}

export interface INexusDBAdapter {
  name: string;
  connect(): Promise<void>;
  ping(): Promise<boolean>;
  get(collection: string, id: string): Promise<Record<string, any> | null>;
  add(collection: string, data: Record<string, any>): Promise<string>;
  set(collection: string, id: string, data: Record<string, any>, merge?: boolean): Promise<void>;
  update(collection: string, id: string, data: Record<string, any>): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  find(collection: string, options?: FindOptions): Promise<Array<Record<string, any>>>;
  batch(writes: BatchWrite[]): Promise<void>;
  serverTimestamp(): any;
  increment(n: number): any;
  /** Atomic field increment on a document */
  incrementField(collection: string, id: string, field: string, by: number): Promise<void>;
  /** Optional: real atomic transaction (implemented by PostgreSQL). */
  transaction?<T>(callback: (tx: NexusDBTransaction) => Promise<T>): Promise<T>;
  /** Optional: release pooled connections on shutdown. */
  disconnect?(): Promise<void>;
}

// ════════════════════════════════════════════════════════════════════════
// ADAPTER: In-Memory (testing / standalone / fallback)
// ════════════════════════════════════════════════════════════════════════


// ── Secret access helper — lazy to avoid NexusDB → SecretVault → NexusLogger → NexusDB circular import
async function _getSecret(key: string, module: string): Promise<string | undefined> {
  try {
    const { SecretVault } = await import('../security/vault/SecretVault');
    return SecretVault.get(key, { caller: 'system', module }) ?? ENV[key];
  } catch {
    return ENV[key];
  }
}

export class InMemoryAdapter implements INexusDBAdapter {
  name = 'InMemory';
  private store = new Map<string, Map<string, Record<string, any>>>();

  async connect() {}
  async ping() { return true; }

  private col(c: string): Map<string, Record<string, any>> {
    if (!this.store.has(c)) this.store.set(c, new Map());
    return this.store.get(c)!;
  }

  async get(c: string, id: string) { return this.col(c).get(id) ?? null; }

  async add(c: string, data: Record<string, any>) {
    const id = `mem_${crypto.randomUUID()}`;
    this.col(c).set(id, { ...data, id, createdAt: new Date(), updatedAt: new Date() });
    return id;
  }

  async set(c: string, id: string, data: Record<string, any>, merge = true) {
    const existing = merge ? (this.col(c).get(id) ?? {}) : {};
    this.col(c).set(id, { ...existing, ...data, id, updatedAt: new Date() });
  }

  async update(c: string, id: string, data: Record<string, any>) {
    const existing = this.col(c).get(id) ?? {};
    this.col(c).set(id, { ...existing, ...data, updatedAt: new Date() });
  }

  async delete(c: string, id: string) { this.col(c).delete(id); }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    let results = Array.from(this.col(c).values());

    if (opts.where) {
      for (const w of opts.where) {
        results = results.filter(r => {
          const v = r[w.field];
          switch (w.op) {
            case '==': return v === w.value;
            case '!=': return v !== w.value;
            case '<':  return v < w.value;
            case '<=': return v <= w.value;
            case '>':  return v > w.value;
            case '>=': return v >= w.value;
            case 'in': return Array.isArray(w.value) && w.value.includes(v);
            case 'array-contains': return Array.isArray(v) && v.includes(w.value);
            default: return true;
          }
        });
      }
    }

    if (opts.orderBy) {
      const dir = opts.orderDir === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const av = a[opts.orderBy!], bv = b[opts.orderBy!];
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }

    if (opts.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async batch(writes: BatchWrite[]) {
    for (const w of writes) {
      if (w.type === 'set')    await this.set(w.collection, w.id, w.data ?? {});
      if (w.type === 'update') await this.update(w.collection, w.id, w.data ?? {});
      if (w.type === 'delete') await this.delete(w.collection, w.id);
    }
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    const doc = this.col(c).get(id) ?? {};
    const current = typeof doc[field] === 'number' ? (doc[field] as number) : 0;
    this.col(c).set(id, { ...doc, id, [field]: current + by, updatedAt: new Date() });
  }

  serverTimestamp() { return new Date(); }
  increment(n: number) { return n; }  // simplified
}

// ════════════════════════════════════════════════════════════════════════
// ADAPTER: Firestore (Google Firebase)
// ════════════════════════════════════════════════════════════════════════

export class FirestoreAdapter implements INexusDBAdapter {
  name = 'Firestore';

  async connect() { /* implicit via Firebase SDK */ }

  async ping(): Promise<boolean> {
    try {
      const { db } = await import('../../firebase');
      return !!db;
    } catch { return false; }
  }

  async get(c: string, id: string): Promise<Record<string, any> | null> {
    const { db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, c, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async add(c: string, data: Record<string, any>): Promise<string> {
    const { db } = await import('../../firebase');
    const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
    const ref = await addDoc(collection(db, c), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  }

  async set(c: string, id: string, data: Record<string, any>, merge = true): Promise<void> {
    const { db } = await import('../../firebase');
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    await setDoc(doc(db, c, id), { ...data, updatedAt: serverTimestamp() }, { merge });
  }

  async update(c: string, id: string, data: Record<string, any>): Promise<void> {
    const { db } = await import('../../firebase');
    const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
    await updateDoc(doc(db, c, id), { ...data, updatedAt: serverTimestamp() });
  }

  async delete(c: string, id: string): Promise<void> {
    const { db } = await import('../../firebase');
    const { doc, deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db, c, id));
  }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    const { db } = await import('../../firebase');
    const {
      collection, query, where, orderBy, limit, getDocs, startAfter
    } = await import('firebase/firestore');

    const constraints: any[] = [];
    if (opts.where) {
      for (const w of opts.where) {
        constraints.push(where(w.field, w.op as any, w.value));
      }
    }
    if (opts.orderBy) constraints.push(orderBy(opts.orderBy, opts.orderDir ?? 'asc'));
    if (opts.startAfter) constraints.push(startAfter(opts.startAfter));
    if (opts.limit)   constraints.push(limit(opts.limit));

    const snap = await getDocs(query(collection(db, c), ...constraints));
    return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  }

  async batch(writes: BatchWrite[]): Promise<void> {
    const { db } = await import('../../firebase');
    const { writeBatch, doc, serverTimestamp } = await import('firebase/firestore');
    const wb = writeBatch(db);
    for (const w of writes) {
      const ref = doc(db, w.collection, w.id);
      if (w.type === 'set')    wb.set(ref, { ...w.data, updatedAt: serverTimestamp() }, { merge: true });
      if (w.type === 'update') wb.update(ref, { ...w.data, updatedAt: serverTimestamp() });
      if (w.type === 'delete') wb.delete(ref);
    }
    await wb.commit();
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    const { db } = await import('../../firebase');
    const { doc, updateDoc, increment } = await import('firebase/firestore');
    await updateDoc(doc(db, c, id), { [field]: increment(by) });
  }

  serverTimestamp() {
    return { _isServerTimestamp: true };
  }

  increment(n: number) { return n; }
}

// ════════════════════════════════════════════════════════════════════════
// ADAPTER: PostgreSQL (via pg / node-postgres)
// ENV: POSTGRES_URL=postgresql://user:pass@host:5432/dbname
//      POSTGRES_SSL=auto|true|false   (auto = TLS for remote hosts, off for localhost / *.railway.internal)
//      POSTGRES_POOL_MAX=<n>          (default: hardware-aware, at least 10)
//      NEXUSDB_MAX_ROWS=<n>           (safety cap for find() calls that pass no limit; default 5000)
//      NEXUSDB_AUTO_INDEX=true|false  (default true — builds indexes for the fields that are actually queried)
// ════════════════════════════════════════════════════════════════════════

/** Constant key for pg_advisory_xact_lock — serialises schema creation across processes/instances. */
const PG_SCHEMA_LOCK_KEY = 727274;
/** Field names are interpolated into SQL text, so they MUST match this strict pattern. */
const PG_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;
const PG_COLLECTION_RE = /^[A-Za-z0-9_\-:.]+$/;

type PgQ = { query: (sql: string, params?: any[]) => Promise<any> };

function pgField(field: string): { text: string; json: string } {
  if (typeof field !== 'string' || !PG_FIELD_RE.test(field)) {
    throw new Error(`[NexusDB] Invalid field name: ${String(field).slice(0, 60)}`);
  }
  const parts = field.split('.');
  if (parts.length === 1) return { text: `(data->>'${field}')`, json: `(data->'${field}')` };
  const p = `'{${parts.join(',')}}'`;
  return { text: `(data #>> ${p})`, json: `(data #> ${p})` };
}

function pgScalar(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Small non-cryptographic hash (no Node 'crypto' import — this file is also bundled for the browser). */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Decide the TLS option for a Postgres connection string. Returns the cleaned URL + ssl setting. */
function pgConnectionConfig(rawUrl: string): { connectionString: string; ssl: false | { rejectUnauthorized: boolean } } {
  const mode = (ENV.POSTGRES_SSL || 'auto').toLowerCase();
  let host = '';
  let urlSslMode: string | null = null;
  let cleaned = rawUrl;
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    urlSslMode = u.searchParams.get('sslmode');
    // We decide TLS ourselves (below); a bare sslmode=require would otherwise make
    // node-postgres verify the server certificate, which managed hosts (Railway proxy,
    // Neon, Supabase) do not allow with a self-signed chain.
    u.searchParams.delete('sslmode');
    u.searchParams.delete('ssl');
    cleaned = u.toString();
  } catch { /* keep raw url */ }

  if (mode === 'false' || mode === 'off' || mode === 'disable' || urlSslMode === 'disable') {
    return { connectionString: cleaned, ssl: false };
  }
  if (mode === 'true' || mode === 'on' || mode === 'require' || (urlSslMode && urlSslMode !== 'disable')) {
    return { connectionString: cleaned, ssl: { rejectUnauthorized: false } };
  }
  const isPrivate = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host.endsWith('.internal') || host.endsWith('.local');
  return { connectionString: cleaned, ssl: isPrivate ? false : { rejectUnauthorized: false } };
}

function pgRetryable(err: any): boolean {
  const code = err?.code;
  return code === '40001' || code === '40P01' || code === '23505' || code === '42P07' || code === '55P03';
}

export class PostgreSQLAdapter implements INexusDBAdapter {
  name = 'PostgreSQL';
  private pool: any = null;
  private connecting: Promise<void> | null = null;
  private ready = false;
  private readonly maxRows = Math.max(100, parseInt(ENV.NEXUSDB_MAX_ROWS || '5000', 10) || 5000);
  private indexQueue: Promise<void> = Promise.resolve();
  private indexedKeys = new Set<string>();
  private indexCountByCollection = new Map<string, number>();
  private capWarned = new Set<string>();

  /**
   * Safe to call many times at once: all callers share ONE connection attempt.
   * (Before this, two parallel callers both ran CREATE TABLE IF NOT EXISTS and Postgres
   *  rejected one of them with "duplicate key ... pg_type_typname_nsp_index", which made the
   *  whole server think its database was down and fall back to memory.)
   */
  async connect(): Promise<void> {
    if (this.ready && this.pool) return;
    if (!this.connecting) {
      this.connecting = this._connect().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  private async _connect(): Promise<void> {
    const url = ENV.POSTGRES_URL;
    if (!url) throw new Error('POSTGRES_URL not set');
    if (!this.pool) {
      const { Pool } = await import('pg');
      let poolSize = parseInt(ENV.POSTGRES_POOL_MAX || '', 10) || 10;
      if (!ENV.POSTGRES_POOL_MAX) {
        try {
          const { CapacityEstimator } = await import('../infrastructure/CapacityEstimator');
          poolSize = Math.max(poolSize, (await CapacityEstimator.getRecommendedTuning()).dbPoolSize || 0);
        } catch { /* hardware detection not available yet — keep the safe default */ }
      }
      const cfg = pgConnectionConfig(url);
      this.pool = new Pool({
        connectionString: cfg.connectionString,
        ssl: cfg.ssl,
        max: poolSize,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 30_000,
        keepAlive: true,
        application_name: 'nexusos',
      });
      // An idle connection that dies (database restart, network blip) emits 'error' on the
      // pool. Without a listener Node treats that as an uncaught exception and kills the server.
      this.pool.on('error', (err: Error) => {
        console.error('[NexusDB] PostgreSQL idle connection error (will reconnect automatically):', err.message);
      });
    }
    try {
      await this._ensureTables();
    } catch (err) {
      // Leave the pool in place (it reconnects by itself) but report "not ready" so the caller retries.
      this.ready = false;
      throw err;
    }
    this.ready = true;
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await Promise.race([
        this.pool.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 3000).unref?.()),
      ]);
      return true;
    } catch { return false; }
  }

  async disconnect(): Promise<void> {
    const p = this.pool;
    this.pool = null; this.ready = false;
    if (p) { try { await p.end(); } catch { /* already closed */ } }
  }

  private db(): any {
    if (!this.pool) throw new Error('[NexusDB] PostgreSQL is not connected');
    return this.pool;
  }

  private async _ensureTables(): Promise<void> {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        // Serialise with any other server instance doing the same thing right now.
        await client.query('SELECT pg_advisory_xact_lock($1)', [PG_SCHEMA_LOCK_KEY]);
        await client.query(`
          CREATE TABLE IF NOT EXISTS nexus_documents (
            collection TEXT NOT NULL,
            id         TEXT NOT NULL,
            data       JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (collection, id)
          )`);
        await client.query('CREATE INDEX IF NOT EXISTS idx_nexus_docs_collection ON nexus_documents (collection)');
        // jsonb_path_ops: much smaller and faster to maintain than the default GIN opclass,
        // and it is all that the "@>" (array-contains) queries need.
        await client.query('CREATE INDEX IF NOT EXISTS idx_nexus_docs_data_pathops ON nexus_documents USING GIN (data jsonb_path_ops)');
        await client.query('COMMIT');
        return;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        if (attempt < 5 && pgRetryable(err)) {
          await new Promise((r) => setTimeout(r, 150 * attempt));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }

  // ── single-statement helpers (shared by normal calls, batch() and transactions) ──

  private async _set(q: PgQ, c: string, id: string, data: Record<string, any>, merge: boolean): Promise<void> {
    const now = new Date().toISOString();
    const doc = JSON.stringify({ ...data, id });
    if (merge) {
      await q.query(
        `INSERT INTO nexus_documents (collection, id, data)
         VALUES ($1, $2, jsonb_build_object('createdAt', $4::text, 'updatedAt', $4::text) || $3::jsonb)
         ON CONFLICT (collection, id)
         DO UPDATE SET data = nexus_documents.data || $3::jsonb || jsonb_build_object('updatedAt', $4::text),
                       updated_at = NOW()`,
        [c, id, doc, now],
      );
    } else {
      await q.query(
        `INSERT INTO nexus_documents (collection, id, data)
         VALUES ($1, $2, jsonb_build_object('createdAt', $4::text, 'updatedAt', $4::text) || $3::jsonb)
         ON CONFLICT (collection, id)
         DO UPDATE SET data = jsonb_build_object('createdAt', COALESCE(nexus_documents.data->>'createdAt', $4::text),
                                                 'updatedAt', $4::text) || $3::jsonb,
                       updated_at = NOW()`,
        [c, id, doc, now],
      );
    }
  }

  private async _update(q: PgQ, c: string, id: string, data: Record<string, any>): Promise<void> {
    await q.query(
      `UPDATE nexus_documents
          SET data = data || $3::jsonb || jsonb_build_object('updatedAt', $4::text), updated_at = NOW()
        WHERE collection = $1 AND id = $2`,
      [c, id, JSON.stringify(data), new Date().toISOString()],
    );
  }

  private async _delete(q: PgQ, c: string, id: string): Promise<void> {
    await q.query('DELETE FROM nexus_documents WHERE collection = $1 AND id = $2', [c, id]);
  }

  // ── INexusDBAdapter ───────────────────────────────────────────────────

  async get(c: string, id: string): Promise<Record<string, any> | null> {
    const r = await this.db().query('SELECT data FROM nexus_documents WHERE collection=$1 AND id=$2', [c, id]);
    return r.rows.length > 0 ? { id, ...r.rows[0].data } : null;
  }

  async add(c: string, data: Record<string, any>): Promise<string> {
    const id = data.id ?? crypto.randomUUID();
    await this._set(this.db(), c, id, data, false);
    return id;
  }

  async set(c: string, id: string, data: Record<string, any>, merge = true): Promise<void> {
    await this._set(this.db(), c, id, data, merge);
  }

  async update(c: string, id: string, data: Record<string, any>): Promise<void> {
    await this._update(this.db(), c, id, data);
  }

  async delete(c: string, id: string): Promise<void> {
    await this._delete(this.db(), c, id);
  }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    const conditions: string[] = ['collection = $1'];
    const params: any[] = [c];
    let i = 2;
    const textFields: string[] = [];

    for (const w of opts.where ?? []) {
      const f = pgField(w.field);
      const v = w.value;
      textFields.push(w.field);
      switch (w.op) {
        case '==':
          if (v === null || v === undefined) conditions.push(`${f.text} IS NULL`);
          else { conditions.push(`${f.text} = $${i++}`); params.push(pgScalar(v)); }
          break;
        case '!=':
          if (v === null || v === undefined) conditions.push(`${f.text} IS NOT NULL`);
          else { conditions.push(`(${f.text} IS NOT NULL AND ${f.text} <> $${i++})`); params.push(pgScalar(v)); }
          break;
        case '<': case '<=': case '>': case '>=':
          if (typeof v === 'number') {
            // Only compare real JSON numbers numerically — a stray text value must not blow the query up.
            conditions.push(`(CASE WHEN jsonb_typeof(${f.json}) = 'number' THEN (${f.text})::numeric END) ${w.op} $${i++}`);
            params.push(v);
          } else {
            // ISO-8601 timestamps and other strings compare correctly as text.
            conditions.push(`${f.text} ${w.op} $${i++}`);
            params.push(pgScalar(v));
          }
          break;
        case 'in': {
          const arr = (Array.isArray(v) ? v : [v]).map(pgScalar);
          if (arr.length === 0) { conditions.push('FALSE'); break; }
          conditions.push(`${f.text} = ANY($${i++}::text[])`); params.push(arr);
          break;
        }
        case 'not-in': {
          const arr = (Array.isArray(v) ? v : [v]).map(pgScalar);
          if (arr.length === 0) break;
          conditions.push(`(${f.text} IS NOT NULL AND NOT (${f.text} = ANY($${i++}::text[])))`); params.push(arr);
          break;
        }
        case 'array-contains':
          conditions.push(`${f.json} @> $${i++}::jsonb`); params.push(JSON.stringify([v]));
          break;
        default:
          throw new Error(`[NexusDB] Unsupported operator: ${String((w as any).op)}`);
      }
    }

    let sql = `SELECT id, data FROM nexus_documents WHERE ${conditions.join(' AND ')}`;
    const jsonFields: string[] = [];

    if (opts.orderBy) {
      const f = pgField(opts.orderBy);
      const desc = opts.orderDir === 'desc';
      jsonFields.push(opts.orderBy);
      if (opts.startAfter !== undefined && opts.startAfter !== null) {
        sql += ` AND ${f.json} ${desc ? '<' : '>'} $${i++}::jsonb`;
        params.push(JSON.stringify(opts.startAfter instanceof Date ? opts.startAfter.toISOString() : opts.startAfter));
      }
      // JSONB ordering sorts numbers numerically and strings alphabetically (a text sort
      // would put "9" after "10"). Rows missing the field go last; id makes paging stable.
      sql += ` ORDER BY ${f.json} ${desc ? 'DESC' : 'ASC'} NULLS LAST, id ${desc ? 'DESC' : 'ASC'}`;
    }

    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100_000) : this.maxRows;
    sql += ` LIMIT $${i++}`;
    params.push(limit);

    const r = await this.db().query(sql, params);
    if (!opts.limit && r.rows.length >= this.maxRows && !this.capWarned.has(c)) {
      this.capWarned.add(c);
      console.warn(`[NexusDB] find('${c}') hit the safety cap of ${this.maxRows} rows — pass an explicit limit/paging for large collections.`);
    }
    this._scheduleIndexes(c, textFields, jsonFields);
    return r.rows.map((row: any) => ({ id: row.id, ...row.data }));
  }

  /** All-or-nothing: either every write is saved or none is. */
  async batch(writes: BatchWrite[]): Promise<void> {
    if (!writes.length) return;
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      for (const w of writes) {
        if (w.type === 'set')         await this._set(client, w.collection, w.id, w.data ?? {}, true);
        else if (w.type === 'update') await this._update(client, w.collection, w.id, w.data ?? {});
        else if (w.type === 'delete') await this._delete(client, w.collection, w.id);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Real atomic transaction. Documents read with tx.get() are row-locked (SELECT … FOR UPDATE)
   * until commit, so two customers buying the last item at the same moment cannot both succeed.
   * Deadlocks / serialization failures are retried automatically.
   */
  async transaction<T>(cb: (tx: NexusDBTransaction) => Promise<T>): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const client = await this.db().connect();
      try {
        await client.query('BEGIN');
        const tx: NexusDBTransaction = {
          get: async (collection, id) => {
            const r = await client.query(
              'SELECT data FROM nexus_documents WHERE collection=$1 AND id=$2 FOR UPDATE', [collection, id]);
            return r.rows.length ? { id, ...r.rows[0].data } : null;
          },
          update: async (collection, id, data) => { await this._update(client, collection, id, data); },
          set: async (collection, id, data) => { await this._set(client, collection, id, data, true); },
        };
        const result = await cb(tx);
        await client.query('COMMIT');
        return result;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        lastErr = err;
        if (attempt < 4 && (err?.code === '40001' || err?.code === '40P01')) {
          await new Promise((r) => setTimeout(r, 40 * attempt * attempt));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
    throw lastErr;
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    pgField(field); // validates the name; the value itself is passed as a bound parameter below
    await this.db().query(
      `INSERT INTO nexus_documents (collection, id, data)
       VALUES ($1, $2, jsonb_build_object($3::text, $4::numeric, 'id', $2::text))
       ON CONFLICT (collection, id) DO UPDATE SET
         data = jsonb_set(
           nexus_documents.data,
           ARRAY[$3::text],
           to_jsonb(COALESCE((nexus_documents.data->>$3)::numeric, 0) + $4::numeric)
         ) || jsonb_build_object('updatedAt', $5::text),
         updated_at = NOW()`,
      [c, id, field, by, new Date().toISOString()],
    );
  }

  /**
   * Self-tuning: the first time a field is used in a filter or sort, an index for it is built
   * in the background (CREATE INDEX CONCURRENTLY never blocks reads or writes). This is what
   * keeps queries fast as a collection grows from hundreds to millions of documents without
   * anyone having to design indexes by hand.
   */
  private _scheduleIndexes(collection: string, textFields: string[], jsonFields: string[]): void {
    if (ENV.NEXUSDB_AUTO_INDEX === 'false' || !PG_COLLECTION_RE.test(collection)) return;
    const wanted: Array<['t' | 'j', string]> = [
      ...textFields.map((f) => ['t', f] as ['t', string]),
      ...jsonFields.map((f) => ['j', f] as ['j', string]),
    ];
    for (const [kind, field] of wanted) {
      const key = `${kind}|${collection}|${field}`;
      if (this.indexedKeys.has(key)) continue;
      const n = this.indexCountByCollection.get(collection) ?? 0;
      if (n >= 10 || this.indexedKeys.size >= 150) return; // never let write-amplification run away
      this.indexedKeys.add(key);
      this.indexCountByCollection.set(collection, n + 1);
      const expr = kind === 't' ? pgField(field).text : pgField(field).json;
      const name = `nx_${collection}_${field}_${kind}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48) + '_' + djb2(key);
      this.indexQueue = this.indexQueue.then(async () => {
        try {
          if (!this.pool) return;
          await this.pool.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON nexus_documents (${expr}) WHERE collection = '${collection}'`);
        } catch { /* indexes are an optimisation — never fail a request over one */ }
      });
    }
  }

  serverTimestamp() { return new Date().toISOString(); }
  increment(n: number) { return n; }
}

// ════════════════════════════════════════════════════════════════════════
// ADAPTER: Supabase (PostgreSQL + REST API + Realtime)
// ENV: SUPABASE_URL=https://xxx.supabase.co
//      SUPABASE_SERVICE_ROLE_KEY=service_role_key
// ════════════════════════════════════════════════════════════════════════

export class SupabaseAdapter implements INexusDBAdapter {
  name = 'Supabase';
  private client: any = null;

  async connect(): Promise<void> {
    const url = ENV.SUPABASE_URL;
    const key = await _getSecret('SUPABASE_SERVICE_ROLE_KEY', 'SupabaseAdapter');
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    const { createClient } = await import('@supabase/supabase-js');
    this.client = createClient(url, key);
    // Ensure table exists via pg-compatible call
    await this.client.rpc('exec_sql', {
      sql: `CREATE TABLE IF NOT EXISTS nexus_documents (
              collection TEXT, id TEXT, data JSONB,
              created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
              PRIMARY KEY (collection, id)
            )`
    }).catch(() => { /* table may already exist */ });
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    const { error } = await this.client.from('nexus_documents').select('id').limit(1);
    return !error;
  }

  async get(c: string, id: string): Promise<Record<string, any> | null> {
    const { data } = await this.client.from('nexus_documents')
      .select('data').eq('collection', c).eq('id', id).single();
    return data ? { id, ...data.data } : null;
  }

  async add(c: string, data: Record<string, any>): Promise<string> {
    const id = data.id ?? crypto.randomUUID();
    await this.client.from('nexus_documents').upsert({ collection: c, id, data: { ...data, id }, updated_at: new Date().toISOString() });
    return id;
  }

  async set(c: string, id: string, data: Record<string, any>, _merge = true): Promise<void> {
    await this.client.from('nexus_documents').upsert({ collection: c, id, data: { ...data, id }, updated_at: new Date().toISOString() });
  }

  async update(c: string, id: string, data: Record<string, any>): Promise<void> {
    const existing = await this.get(c, id);
    const merged = { ...(existing ?? {}), ...data, id };
    await this.set(c, id, merged);
  }

  async delete(c: string, id: string): Promise<void> {
    await this.client.from('nexus_documents').delete().eq('collection', c).eq('id', id);
  }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    let q = this.client.from('nexus_documents').select('id, data').eq('collection', c);
    // Supabase JSONB filtering via PostgREST's ->>/-> path syntax (no quotes
    // around the key — quoting it, as this used to, produces a column
    // reference PostgREST doesn't recognize and the filter is ignored).
    if (opts.where) {
      for (const w of opts.where) {
        const textPath = `data->>${w.field}`;
        switch (w.op) {
          case '==': q = q.eq(textPath, String(w.value)); break;
          case '!=': q = q.neq(textPath, String(w.value)); break;
          case '>':  q = q.gt(textPath, String(w.value)); break;
          case '>=': q = q.gte(textPath, String(w.value)); break;
          case '<':  q = q.lt(textPath, String(w.value)); break;
          case '<=': q = q.lte(textPath, String(w.value)); break;
          case 'in': q = q.in(textPath, (w.value as any[]).map(String)); break;
          case 'array-contains':
            // JSONB containment needs the raw jsonb path (-> not ->>).
            q = q.contains(`data->${w.field}`, [w.value]);
            break;
        }
      }
    }
    if (opts.orderBy) q = q.order(`data->>${opts.orderBy}`, { ascending: opts.orderDir !== 'desc' });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(`SupabaseAdapter.find failed: ${error.message}`);
    return (data ?? []).map((row: any) => ({ id: row.id, ...row.data }));
  }

  async batch(writes: BatchWrite[]): Promise<void> {
    for (const w of writes) {
      if (w.type === 'set')    await this.set(w.collection, w.id, w.data ?? {});
      if (w.type === 'update') await this.update(w.collection, w.id, w.data ?? {});
      if (w.type === 'delete') await this.delete(w.collection, w.id);
    }
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    const existing = await this.get(c, id) ?? {};
    const current = typeof existing[field] === 'number' ? (existing[field] as number) : 0;
    await this.update(c, id, { [field]: current + by });
  }

  serverTimestamp() { return new Date().toISOString(); }
  increment(n: number) { return n; }
}

// ════════════════════════════════════════════════════════════════════════
// ADAPTER: MongoDB
// ENV: MONGODB_URI=mongodb+srv://user:pass@cluster/dbname
//      MONGODB_DB=nexus
// ════════════════════════════════════════════════════════════════════════

export class MongoDBAdapter implements INexusDBAdapter {
  name = 'MongoDB';
  private client: any = null;
  private db: any = null;

  async connect(): Promise<void> {
    const uri = ENV.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not set');
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(uri, { maxPoolSize: 10 });
    await this.client.connect();
    this.db = this.client.db(ENV.MONGODB_DB ?? 'nexus');
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try { await this.db.command({ ping: 1 }); return true; }
    catch { return false; }
  }

  private col(c: string) { return this.db.collection(c); }

  async get(c: string, id: string): Promise<Record<string, any> | null> {
    const doc = await this.col(c).findOne({ _id: id as any });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: _id.toString(), ...rest };
  }

  async add(c: string, data: Record<string, any>): Promise<string> {
    const id = data.id ?? crypto.randomUUID();
    await this.col(c).insertOne({ _id: id as any, ...data, createdAt: new Date(), updatedAt: new Date() });
    return id;
  }

  async set(c: string, id: string, data: Record<string, any>, merge = true): Promise<void> {
    const update = merge ? { $set: { ...data, updatedAt: new Date() } } : { $set: { ...data, updatedAt: new Date() } };
    await this.col(c).updateOne({ _id: id as any }, update, { upsert: true });
  }

  async update(c: string, id: string, data: Record<string, any>): Promise<void> {
    await this.col(c).updateOne({ _id: id as any }, { $set: { ...data, updatedAt: new Date() } });
  }

  async delete(c: string, id: string): Promise<void> {
    await this.col(c).deleteOne({ _id: id as any });
  }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    const filter: Record<string, any> = {};
    if (opts.where) {
      for (const w of opts.where) {
        switch (w.op) {
          case '==': filter[w.field] = w.value; break;
          case '!=': filter[w.field] = { $ne: w.value }; break;
          case '>':  filter[w.field] = { $gt: w.value }; break;
          case '>=': filter[w.field] = { $gte: w.value }; break;
          case '<':  filter[w.field] = { $lt: w.value }; break;
          case '<=': filter[w.field] = { $lte: w.value }; break;
          case 'in': filter[w.field] = { $in: w.value }; break;
          case 'array-contains': filter[w.field] = w.value; break;
        }
      }
    }

    let cursor = this.col(c).find(filter);
    if (opts.orderBy) cursor = cursor.sort({ [opts.orderBy]: opts.orderDir === 'desc' ? -1 : 1 });
    if (opts.limit)   cursor = cursor.limit(opts.limit);

    const docs = await cursor.toArray();
    return docs.map(({ _id, ...rest }: any) => ({ id: _id.toString(), ...rest }));
  }

  async batch(writes: BatchWrite[]): Promise<void> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        for (const w of writes) {
          if (w.type === 'set')    await this.set(w.collection, w.id, w.data ?? {});
          if (w.type === 'update') await this.update(w.collection, w.id, w.data ?? {});
          if (w.type === 'delete') await this.delete(w.collection, w.id);
        }
      });
    } finally {
      await session.endSession();
    }
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    await this.col(c).updateOne(
      { _id: id as any },
      { $inc: { [field]: by }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );
  }

  serverTimestamp() { return new Date(); }
  increment(n: number) { return n; }
}

// ════════════════════════════════════════════════════════════════════════
// NEXUS DB — Singleton in front of the chosen database adapter(s)
//
// Safety rules (learned the hard way):
//  • In PRODUCTION the system NEVER silently switches to an in-memory database. That used to
//    happen whenever the real database was briefly unreachable at boot, and every order taken
//    afterwards was lost on the next restart. Now the server keeps retrying in the background
//    and /api/health reports "database down" until the real database answers.
//  • Operations go straight to the database (no extra "SELECT 1" before every call).
//  • A second, different database is never used as a hidden "fallback": that would split the
//    business data into two places. (Opt in with NEXUSDB_FIRESTORE_FALLBACK=true if you must.)
// ════════════════════════════════════════════════════════════════════════

class NexusDBClient {
  private primary: INexusDBAdapter | null = null;
  private fallbacks: INexusDBAdapter[] = [];
  private routes = new Map<string, INexusDBAdapter>();
  private _ready = false;
  private _initPromise: Promise<void> | null = null;
  private _lastError: unknown = null;
  private _lastAttemptAt = 0;
  private _retryDelayMs = 2000;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _health: { at: number; value: { healthy: boolean; provider: string } } | null = null;

  private static readonly isProd = () => ENV.NODE_ENV === 'production';

  // ── Bootstrap ──────────────────────────────────────────────────────────

  /** Safe to call from anywhere, any number of times, at the same moment. */
  async initialize(): Promise<void> {
    if (this._ready) return;
    if (!this._initPromise) {
      this._initPromise = this._doInitialize().finally(() => { this._initPromise = null; });
    }
    return this._initPromise;
  }

  private async _createPrimary(provider: string): Promise<INexusDBAdapter> {
    switch (provider) {
      case 'postgres': case 'postgresql': { const a = new PostgreSQLAdapter(); await a.connect(); return a; }
      case 'supabase': { const a = new SupabaseAdapter(); await a.connect(); return a; }
      case 'mongodb':  { const a = new MongoDBAdapter();  await a.connect(); return a; }
      case 'neon': {
        // Neon is PostgreSQL-compatible — reuse PostgreSQLAdapter with the Neon URL
        ENV.POSTGRES_URL = ENV.POSTGRES_URL || ENV.NEON_DATABASE_URL;
        const a = new PostgreSQLAdapter(); await a.connect(); return a;
      }
      case 'turso':  { const a = new TursoInlineAdapter();  await a.connect(); return a; }
      case 'sqlite': { const a = new SQLiteInlineAdapter(); await a.connect(); return a; }
      case 'memory': return new InMemoryAdapter();
      case 'firestore':
      default: return new FirestoreAdapter();
    }
  }

  private async _doInitialize(): Promise<void> {
    const provider = (ENV.DB_PROVIDER ?? 'firestore').toLowerCase();
    const allowMemoryFallback = !NexusDBClient.isProd() || ENV.NEXUSDB_ALLOW_MEMORY_FALLBACK === 'true';
    this._lastAttemptAt = Date.now();

    try {
      this.primary = await this._createPrimary(provider);
      this._lastError = null;
      this._retryDelayMs = 2000;
      console.log(`[NexusDB] Primary: ${this.primary.name}`);
    } catch (err) {
      this._lastError = err;
      console.error(`[NexusDB] Primary DB (${provider}) failed to connect:`, err instanceof Error ? err.message : err);
      if (allowMemoryFallback) {
        this.primary = new InMemoryAdapter();
        console.warn('[NexusDB] WARNING: Using in-memory fallback. Data will be lost on restart. (Development only.)');
      } else {
        this._scheduleReconnect();
        throw new Error(`[NexusDB] Database (${provider}) is not reachable yet — retrying in the background.`);
      }
    }

    this.fallbacks = [];
    if (ENV.NEXUSDB_FIRESTORE_FALLBACK === 'true' && provider !== 'firestore' && provider !== 'memory') {
      this.fallbacks.push(new FirestoreAdapter());
    }
    this._ready = true;
  }

  /** Keep trying to reach the database in the background (1s → 30s back-off). */
  private _scheduleReconnect(): void {
    if (this._retryTimer) return;
    const delay = this._retryDelayMs;
    this._retryDelayMs = Math.min(this._retryDelayMs * 2, 30_000);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.initialize().catch(() => { /* _doInitialize already scheduled the next retry */ });
    }, delay);
    (this._retryTimer as any)?.unref?.();
  }

  private async adapterFor(collection?: string): Promise<INexusDBAdapter> {
    if (!this._ready) {
      // Do not hammer a database that just refused us — callers during an outage get a fast error.
      if (this._lastError && Date.now() - this._lastAttemptAt < 1500) {
        throw new Error('[NexusDB] Database is not reachable right now. Please retry shortly.');
      }
      await this.initialize();
    }
    if (collection) {
      const routed = this.routes.get(collection);
      if (routed) return routed;
    }
    if (!this.primary) throw new Error('[NexusDB] No database adapter available');
    return this.primary;
  }

  /**
   * Send the named collections to a different adapter than the primary one. Used to keep the
   * documents the storefront reads directly (orders, products, users …) in the same Firestore
   * database the browser talks to, while heavy internal data stays in PostgreSQL.
   */
  setCollectionRoute(collections: string[], adapter: INexusDBAdapter): void {
    for (const c of collections) this.routes.set(c, adapter);
  }
  clearCollectionRoutes(): void { this.routes.clear(); }

  /** Run an operation; if the primary has become unreachable, try the optional fallback. */
  private async run<T>(collection: string | undefined, fn: (a: INexusDBAdapter) => Promise<T>): Promise<T> {
    const adapter = await this.adapterFor(collection);
    try {
      return await fn(adapter);
    } catch (err) {
      if (this.fallbacks.length > 0 && adapter === this.primary && NexusDBClient.isConnectionError(err)) {
        for (const fb of this.fallbacks) {
          try {
            if (await fb.ping()) {
              console.warn(`[NexusDB] Primary unreachable, using fallback: ${fb.name}`);
              return await fn(fb);
            }
          } catch { /* try next */ }
        }
      }
      throw err;
    }
  }

  private static isConnectionError(err: any): boolean {
    const code = String(err?.code ?? '');
    return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', '57P01', '57P02', '57P03'].includes(code)
      || code.startsWith('08');
  }

  // ── Public API ────────────────────────────────────────────────────────
  async get(collection: string, id: string): Promise<Record<string, any> | null> {
    return this.run(collection, (a) => a.get(collection, id));
  }

  async add(collection: string, data: Record<string, any>): Promise<string> {
    return this.run(collection, (a) => a.add(collection, data));
  }

  async set(collection: string, id: string, data: Record<string, any>, merge = true): Promise<void> {
    return this.run(collection, (a) => a.set(collection, id, data, merge));
  }

  async update(collection: string, id: string, data: Record<string, any>): Promise<void> {
    return this.run(collection, (a) => a.update(collection, id, data));
  }

  async delete(collection: string, id: string): Promise<void> {
    return this.run(collection, (a) => a.delete(collection, id));
  }

  async find(collection: string, options?: FindOptions): Promise<Array<Record<string, any>>> {
    return this.run(collection, (a) => a.find(collection, options));
  }

  async incrementField(collection: string, id: string, field: string, by: number): Promise<void> {
    return this.run(collection, (a) => a.incrementField(collection, id, field, by));
  }

  /** Atomic when every write targets the same adapter (the normal case). */
  async batch(writes: BatchWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const groups = new Map<INexusDBAdapter, BatchWrite[]>();
    for (const w of writes) {
      const a = await this.adapterFor(w.collection);
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a)!.push(w);
    }
    if (groups.size > 1) {
      console.warn('[NexusDB] batch() spans several databases — each part is atomic, the whole is not.');
    }
    for (const [a, ws] of groups) await a.batch(ws);
  }

  /**
   * Run several reads/updates as ONE all-or-nothing unit (inventory, payments, wallets …).
   *  • PostgreSQL: a real database transaction with row locks (SELECT … FOR UPDATE) and automatic
   *    retry on deadlock — two customers cannot both buy the last item.
   *  • Firestore: Firestore's own transaction API (server-side admin SDK when configured).
   *  • Anything else: runs step by step WITHOUT rollback (a warning is logged each time).
   */
  async runTransaction<T>(callback: (tx: NexusDBTransaction) => Promise<T>): Promise<T> {
    const adapter = await this.adapterFor();

    if (typeof adapter.transaction === 'function') {
      return adapter.transaction(callback);
    }

    if (adapter.name === 'Firestore') {
      const { db } = await import('../../firebase');
      const { runTransaction: firestoreRunTransaction, doc, serverTimestamp } = await import('firebase/firestore');
      return firestoreRunTransaction(db, async (firestoreTx: any) => {
        const tx: NexusDBTransaction = {
          get: async (collection: string, id: string) => {
            const snap = await firestoreTx.get(doc(db, collection, id));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
          },
          update: async (collection: string, id: string, data: Record<string, any>) => {
            firestoreTx.update(doc(db, collection, id), { ...data, updatedAt: serverTimestamp() });
          },
        };
        return callback(tx);
      });
    }

    const { logger } = await import('../core/logging/NexusLogger');
    logger.child('NexusDB').warn(
      `runTransaction() called with DB_PROVIDER='${adapter.name}' — this provider has no atomic transaction support in NexusDB. Operations run one after another WITHOUT rollback. Use PostgreSQL or Firestore for money-critical work.`,
    );
    const tx: NexusDBTransaction = {
      get: (collection: string, id: string) => adapter.get(collection, id),
      update: (collection: string, id: string, data: Record<string, any>) => adapter.update(collection, id, data),
    };
    return callback(tx);
  }

  /** Returns provider name for diagnostics */
  get providerName(): string { return this.primary?.name ?? 'not initialized'; }
  get isReady(): boolean { return this._ready; }
  get lastError(): string | null {
    return this._lastError ? (this._lastError instanceof Error ? this._lastError.message : String(this._lastError)) : null;
  }

  /** Health check — used by /api/health. Cached for 2 seconds so health probes cannot load the database. */
  async healthCheck(): Promise<{ healthy: boolean; provider: string; latencyMs: number; error?: string }> {
    const start = Date.now();
    if (this._health && start - this._health.at < 2000) {
      return { ...this._health.value, latencyMs: 0 };
    }
    let value: { healthy: boolean; provider: string; error?: string };
    try {
      const adapter = await this.adapterFor();
      const ok = await adapter.ping();
      value = { healthy: ok, provider: adapter.name, ...(ok ? {} : { error: 'ping failed' }) };
    } catch (err) {
      value = { healthy: false, provider: this.primary?.name ?? 'none', error: err instanceof Error ? err.message : String(err) };
    }
    this._health = { at: Date.now(), value };
    return { ...value, latencyMs: Date.now() - start };
  }

  /** Graceful shutdown: let in-flight queries finish and close pooled connections. */
  async close(): Promise<void> {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    const all = [this.primary, ...this.fallbacks, ...this.routes.values()];
    for (const a of new Set(all)) {
      try { await (a as any)?.disconnect?.(); } catch { /* ignore */ }
    }
    this._ready = false;
  }

  /**
   * Returns a server timestamp token appropriate for the active DB provider.
   * For Firestore: returns the FieldValue sentinel (resolved server-side).
   * For all other providers: returns the current ISO datetime string.
   * Business logic uses this instead of importing firebase/firestore directly.
   */
  serverTimestamp(): any {
    if (this.primary?.name === 'Firestore') {
      // Return a sentinel object; FirestoreAdapter resolves it properly.
      return { _isServerTimestamp: true, _type: 'serverTimestamp' };
    }
    return new Date().toISOString();
  }

  /**
   * Returns an atomic increment token for the active DB provider.
   * This is a HINT, not a guarantee — for atomic increments use incrementField().
   */
  increment(n: number): any {
    return n;
  }
}

/** Singleton — import this everywhere instead of firebase/firestore */
export const NexusDB = new NexusDBClient();


// ════════════════════════════════════════════════════════════════════════
// ADAPTER: Turso (libSQL edge SQLite — free 5GB tier)
// ENV: TURSO_DATABASE_URL=libsql://xxx.turso.io
//      TURSO_AUTH_TOKEN=eyJ...
// ════════════════════════════════════════════════════════════════════════

export class TursoInlineAdapter implements INexusDBAdapter {
  name = 'Turso';
  private client: any = null;

  async connect(): Promise<void> {
    const url = ENV.TURSO_DATABASE_URL;
    const token = await _getSecret('TURSO_AUTH_TOKEN', 'TursoAdapter');
    if (!url) throw new Error('TURSO_DATABASE_URL not set');
    const { createClient } = await import('@libsql/client');
    this.client = createClient({ url, authToken: token });
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS nexus_documents (
        collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (collection, id)
      )
    `);
  }

  async ping(): Promise<boolean> {
    try { await this.client.execute('SELECT 1'); return true; } catch { return false; }
  }

  async get(c: string, id: string): Promise<Record<string, any> | null> {
    const r = await this.client.execute({ sql: 'SELECT data FROM nexus_documents WHERE collection=? AND id=?', args: [c, id] });
    return r.rows[0] ? JSON.parse(r.rows[0].data as string) : null;
  }

  async add(c: string, data: Record<string, any>): Promise<string> {
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    await this.client.execute({
      sql: `INSERT INTO nexus_documents (collection,id,data,created_at,updated_at) VALUES (?,?,?,?,?)
            ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
      args: [c, id, JSON.stringify({ ...data, id }), now, now]
    });
    return id;
  }

  async set(c: string, id: string, data: Record<string, any>, _merge = true): Promise<void> {
    await this.add(c, { ...data, id });
  }

  async update(c: string, id: string, data: Record<string, any>): Promise<void> {
    const existing = await this.get(c, id) ?? {};
    await this.set(c, id, { ...existing, ...data, id });
  }

  async delete(c: string, id: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM nexus_documents WHERE collection=? AND id=?', args: [c, id] });
  }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    const r = await this.client.execute({ sql: 'SELECT id,data FROM nexus_documents WHERE collection=?', args: [c] });
    let results: Record<string, any>[] = r.rows.map((row: any) => JSON.parse(row.data as string));
    if (opts.where) {
      for (const w of opts.where) {
        results = results.filter(doc => {
          const v = doc[w.field];
          switch (w.op) {
            case '==': return v === w.value;
            case '!=': return v !== w.value;
            case '>': return v > w.value;
            case '>=': return v >= w.value;
            case '<': return v < w.value;
            case '<=': return v <= w.value;
            case 'in': return Array.isArray(w.value) && w.value.includes(v);
            default: return true;
          }
        });
      }
    }
    if (opts.orderBy) {
      const dir = opts.orderDir === 'desc' ? -1 : 1;
      results.sort((a, b) => (a[opts.orderBy!] < b[opts.orderBy!] ? -dir : dir));
    }
    if (opts.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async batch(writes: BatchWrite[]): Promise<void> {
    for (const w of writes) {
      if (w.type === 'set')    await this.set(w.collection, w.id, w.data ?? {});
      if (w.type === 'update') await this.update(w.collection, w.id, w.data ?? {});
      if (w.type === 'delete') await this.delete(w.collection, w.id);
    }
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    const existing = await this.get(c, id) ?? {};
    const current = typeof existing[field] === 'number' ? (existing[field] as number) : 0;
    await this.update(c, id, { [field]: current + by });
  }

  serverTimestamp() { return new Date().toISOString(); }
  increment(n: number) { return n; }
}

// ════════════════════════════════════════════════════════════════════════
// ADAPTER: SQLite (local persistent — better-sqlite3)
// ENV: SQLITE_PATH=./nexus.db  (default)
// ════════════════════════════════════════════════════════════════════════

export class SQLiteInlineAdapter implements INexusDBAdapter {
  name = 'SQLite';
  private db: any = null;

  async connect(): Promise<void> {
    const path = ENV.SQLITE_PATH || './nexus.db';
    const Database = (await import('better-sqlite3')).default;
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nexus_documents (
        collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_collection ON nexus_documents(collection);
    `);
  }

  async ping(): Promise<boolean> {
    try { this.db.prepare('SELECT 1').get(); return true; } catch { return false; }
  }

  async get(c: string, id: string): Promise<Record<string, any> | null> {
    const row = this.db.prepare('SELECT data FROM nexus_documents WHERE collection=? AND id=?').get(c, id) as any;
    return row ? JSON.parse(row.data) : null;
  }

  async add(c: string, data: Record<string, any>): Promise<string> {
    const id = data.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO nexus_documents (collection,id,data,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
    `).run(c, id, JSON.stringify({ ...data, id }), now, now);
    return id;
  }

  async set(c: string, id: string, data: Record<string, any>, _merge = true): Promise<void> {
    await this.add(c, { ...data, id });
  }

  async update(c: string, id: string, data: Record<string, any>): Promise<void> {
    const existing = await this.get(c, id) ?? {};
    await this.set(c, id, { ...existing, ...data, id });
  }

  async delete(c: string, id: string): Promise<void> {
    this.db.prepare('DELETE FROM nexus_documents WHERE collection=? AND id=?').run(c, id);
  }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    const rows = this.db.prepare('SELECT id,data FROM nexus_documents WHERE collection=? ORDER BY updated_at DESC').all(c) as any[];
    let results: Record<string, any>[] = rows.map((r: any) => JSON.parse(r.data));
    if (opts.where) {
      for (const w of opts.where) {
        results = results.filter(doc => {
          const v = doc[w.field];
          switch (w.op) {
            case '==': return v === w.value;
            case '!=': return v !== w.value;
            case '>': return v > w.value;
            case '>=': return v >= w.value;
            case '<': return v < w.value;
            case '<=': return v <= w.value;
            case 'in': return Array.isArray(w.value) && w.value.includes(v);
            case 'array-contains': return Array.isArray(v) && v.includes(w.value);
            default: return true;
          }
        });
      }
    }
    if (opts.orderBy) {
      const dir = opts.orderDir === 'desc' ? -1 : 1;
      results.sort((a, b) => (a[opts.orderBy!] < b[opts.orderBy!] ? -dir : dir));
    }
    if (opts.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async batch(writes: BatchWrite[]): Promise<void> {
    const batchFn = this.db.transaction(() => {
      const now = new Date().toISOString();
      for (const w of writes) {
        if (w.type === 'set' || w.type === 'update') {
          this.db.prepare(`
            INSERT INTO nexus_documents (collection,id,data,updated_at) VALUES (?,?,?,?)
            ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
          `).run(w.collection, w.id, JSON.stringify({ ...(w.data ?? {}), id: w.id }), now);
        } else if (w.type === 'delete') {
          this.db.prepare('DELETE FROM nexus_documents WHERE collection=? AND id=?').run(w.collection, w.id);
        }
      }
    });
    batchFn();
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    const existing = await this.get(c, id) ?? {};
    const current = typeof existing[field] === 'number' ? (existing[field] as number) : 0;
    await this.update(c, id, { [field]: current + by });
  }

  serverTimestamp() { return new Date().toISOString(); }
  increment(n: number) { return n; }
}
