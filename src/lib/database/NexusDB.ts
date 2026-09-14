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
}

// ════════════════════════════════════════════════════════════════════════
// ADAPTER: In-Memory (testing / standalone / fallback)
// ════════════════════════════════════════════════════════════════════════


// ── Secret access helper — lazy to avoid NexusDB → SecretVault → NexusLogger → NexusDB circular import
async function _getSecret(key: string, module: string): Promise<string | undefined> {
  try {
    const { SecretVault } = await import('../security/vault/SecretVault');
    return SecretVault.get(key, { caller: 'system', module }) ?? process.env[key];
  } catch {
    return process.env[key];
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
// ════════════════════════════════════════════════════════════════════════

export class PostgreSQLAdapter implements INexusDBAdapter {
  name = 'PostgreSQL';
  private pool: any = null;

  async connect(): Promise<void> {
    const url = process.env.POSTGRES_URL;
    if (!url) throw new Error('POSTGRES_URL not set');
    const { Pool } = await import('pg');
    let poolSize = 10;
    try {
      const { CapacityEstimator } = await import('../infrastructure/CapacityEstimator');
      poolSize = (await CapacityEstimator.getRecommendedTuning()).dbPoolSize;
    } catch { /* hardware detection not available yet — keep the safe default */ }
    this.pool = new Pool({ connectionString: url, max: poolSize, idleTimeoutMillis: 30_000 });
    // Ensure meta-tables exist
    await this._ensureTables();
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try { await this.pool.query('SELECT 1'); return true; }
    catch { return false; }
  }

  private async _ensureTables(): Promise<void> {
    // Generic key-value table for all collections
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS nexus_documents (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_nexus_docs_collection ON nexus_documents (collection);
      CREATE INDEX IF NOT EXISTS idx_nexus_docs_data ON nexus_documents USING GIN (data);
    `);
  }

  async get(c: string, id: string): Promise<Record<string, any> | null> {
    const r = await this.pool.query(
      'SELECT data FROM nexus_documents WHERE collection=$1 AND id=$2',
      [c, id]
    );
    return r.rows.length > 0 ? { id, ...r.rows[0].data } : null;
  }

  async add(c: string, data: Record<string, any>): Promise<string> {
    const id = data.id ?? crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO nexus_documents (collection, id, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (collection, id) DO UPDATE SET data=$3, updated_at=NOW()`,
      [c, id, JSON.stringify({ ...data, id })]
    );
    return id;
  }

  async set(c: string, id: string, data: Record<string, any>, merge = true): Promise<void> {
    if (merge) {
      await this.pool.query(
        `INSERT INTO nexus_documents (collection, id, data)
         VALUES ($1, $2, $3)
         ON CONFLICT (collection, id)
         DO UPDATE SET data = nexus_documents.data || $3::jsonb, updated_at=NOW()`,
        [c, id, JSON.stringify({ ...data, id })]
      );
    } else {
      await this.pool.query(
        `INSERT INTO nexus_documents (collection, id, data)
         VALUES ($1, $2, $3)
         ON CONFLICT (collection, id)
         DO UPDATE SET data=$3, updated_at=NOW()`,
        [c, id, JSON.stringify({ ...data, id })]
      );
    }
  }

  async update(c: string, id: string, data: Record<string, any>): Promise<void> {
    await this.pool.query(
      `UPDATE nexus_documents
       SET data = data || $3::jsonb, updated_at=NOW()
       WHERE collection=$1 AND id=$2`,
      [c, id, JSON.stringify(data)]
    );
  }

  async delete(c: string, id: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM nexus_documents WHERE collection=$1 AND id=$2',
      [c, id]
    );
  }

  async find(c: string, opts: FindOptions = {}): Promise<Array<Record<string, any>>> {
    const conditions: string[] = ['collection=$1'];
    const params: any[] = [c];
    let i = 2;

    if (opts.where) {
      for (const w of opts.where) {
        const jsonPath = `data->>'${w.field}'`;
        switch (w.op) {
          case '==':  conditions.push(`${jsonPath} = $${i++}`); params.push(String(w.value)); break;
          case '!=':  conditions.push(`${jsonPath} != $${i++}`); params.push(String(w.value)); break;
          case '>':   conditions.push(`(${jsonPath})::numeric > $${i++}`); params.push(w.value); break;
          case '>=':  conditions.push(`(${jsonPath})::numeric >= $${i++}`); params.push(w.value); break;
          case '<':   conditions.push(`(${jsonPath})::numeric < $${i++}`); params.push(w.value); break;
          case '<=':  conditions.push(`(${jsonPath})::numeric <= $${i++}`); params.push(w.value); break;
          case 'in':  conditions.push(`${jsonPath} = ANY($${i++}::text[])`); params.push(w.value.map(String)); break;
          case 'array-contains':
            // JSONB containment: does the array at data->field include this value?
            // (Previously unhandled — fell through with no SQL condition added,
            // so the filter was silently dropped instead of applied.)
            conditions.push(`data->'${w.field}' @> $${i++}::jsonb`);
            params.push(JSON.stringify([w.value]));
            break;
        }
      }
    }

    let sql = `SELECT id, data FROM nexus_documents WHERE ${conditions.join(' AND ')}`;

    if (opts.orderBy) {
      const dir = opts.orderDir === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY (data->>'${opts.orderBy}') ${dir}`;
    }
    if (opts.limit) { sql += ` LIMIT $${i++}`; params.push(opts.limit); }

    const r = await this.pool.query(sql, params);
    return r.rows.map((row: any) => ({ id: row.id, ...row.data }));
  }

  async batch(writes: BatchWrite[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const w of writes) {
        if (w.type === 'set')    await this.set(w.collection, w.id, w.data ?? {});
        if (w.type === 'update') await this.update(w.collection, w.id, w.data ?? {});
        if (w.type === 'delete') await this.delete(w.collection, w.id);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async incrementField(c: string, id: string, field: string, by: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO nexus_documents (collection, id, data)
       VALUES ($1, $2, jsonb_build_object($3::text, $4::numeric))
       ON CONFLICT (collection, id) DO UPDATE SET
         data = jsonb_set(
           nexus_documents.data,
           ARRAY[$3::text],
           to_jsonb(COALESCE((nexus_documents.data->$3)::numeric, 0) + $4::numeric)
         ), updated_at=NOW()`,
      [c, id, field, by]
    );
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
    const url = process.env.SUPABASE_URL;
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
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not set');
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(uri, { maxPoolSize: 10 });
    await this.client.connect();
    this.db = this.client.db(process.env.MONGODB_DB ?? 'nexus');
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
// NEXUS DB — Singleton with auto-failover across adapters
// ════════════════════════════════════════════════════════════════════════

class NexusDBClient {
  private primary: INexusDBAdapter | null = null;
  private fallbacks: INexusDBAdapter[] = [];
  private _ready = false;

  // ── Bootstrap ──────────────────────────────────────────────────────────
  async initialize(): Promise<void> {
    if (this._ready) return;

    const provider = process.env.DB_PROVIDER ?? 'firestore';

    // Primary adapter
    try {
      switch (provider) {
        case 'postgres': {
          const adapter = new PostgreSQLAdapter();
          await adapter.connect();
          this.primary = adapter;
          break;
        }
        case 'supabase': {
          const adapter = new SupabaseAdapter();
          await adapter.connect();
          this.primary = adapter;
          break;
        }
        case 'mongodb': {
          const adapter = new MongoDBAdapter();
          await adapter.connect();
          this.primary = adapter;
          break;
        }
        case 'neon': {
          // Neon is PostgreSQL-compatible — reuse PostgreSQLAdapter with Neon URL
          process.env.POSTGRES_URL = process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
          const adapter = new PostgreSQLAdapter();
          await adapter.connect();
          this.primary = adapter;
          break;
        }
        case 'turso': {
          // Turso uses @libsql/client (SQLite-compatible) — minimal adapter
          const adapter = new TursoInlineAdapter();
          await adapter.connect();
          this.primary = adapter;
          break;
        }
        case 'sqlite': {
          const adapter = new SQLiteInlineAdapter();
          await adapter.connect();
          this.primary = adapter;
          break;
        }
        case 'memory': {
          this.primary = new InMemoryAdapter();
          break;
        }
        case 'firestore':
        default: {
          this.primary = new FirestoreAdapter();
          break;
        }
      }
      console.log(`[NexusDB] Primary: ${this.primary.name}`);
    } catch (err) {
      console.error(`[NexusDB] Primary DB (${provider}) failed to connect:`, err);
      // Fall back to in-memory
      this.primary = new InMemoryAdapter();
      console.warn('[NexusDB] WARNING: Using in-memory fallback. Data will be lost on restart.');
    }

    // Always register Firestore as fallback if not already primary
    if (provider !== 'firestore' && provider !== 'memory') {
      this.fallbacks.push(new FirestoreAdapter());
    }

    this._ready = true;
  }

  private async getAdapter(): Promise<INexusDBAdapter> {
    if (!this._ready) await this.initialize();
    if (this.primary && await this.primary.ping()) return this.primary;

    for (const fb of this.fallbacks) {
      if (await fb.ping()) {
        console.warn(`[NexusDB] Primary down, using fallback: ${fb.name}`);
        return fb;
      }
    }

    throw new Error('[NexusDB] All database adapters are unavailable');
  }

  // ── Public API ────────────────────────────────────────────────────────
  async get(collection: string, id: string): Promise<Record<string, any> | null> {
    return (await this.getAdapter()).get(collection, id);
  }

  async add(collection: string, data: Record<string, any>): Promise<string> {
    return (await this.getAdapter()).add(collection, data);
  }

  async set(collection: string, id: string, data: Record<string, any>, merge = true): Promise<void> {
    return (await this.getAdapter()).set(collection, id, data, merge);
  }

  async update(collection: string, id: string, data: Record<string, any>): Promise<void> {
    return (await this.getAdapter()).update(collection, id, data);
  }

  async delete(collection: string, id: string): Promise<void> {
    return (await this.getAdapter()).delete(collection, id);
  }

  async find(collection: string, options?: FindOptions): Promise<Array<Record<string, any>>> {
    return (await this.getAdapter()).find(collection, options);
  }

  async incrementField(collection: string, id: string, field: string, by: number): Promise<void> {
    return (await this.getAdapter()).incrementField(collection, id, field, by);
  }

  async batch(writes: BatchWrite[]): Promise<void> {
    return (await this.getAdapter()).batch(writes);
  }

  /**
   * Added during CTO Audit Part 8 response (2026-07-25): CTO Audit Part 3
   * found `InventoryReservationService.ts` already calling
   * `NexusDB.runTransaction(...)`, confirmed by tsc to not exist on this
   * class — a real, previously-unfixed bug (docs/governance/
   * TECHNICAL_DEBT_REGISTER.md). CTO Audit Part 8, section 9, separately
   * asks for exactly this capability ("Order → Inventory → Payment →
   * Delivery... All must be Atomic. Rollback Support Must be there").
   *
   * STATED HONESTLY: real atomicity is only delivered for the Firestore
   * backend (the confirmed production default — docs/adr/0002), using
   * Firestore's own native transaction API. For every other DB_PROVIDER,
   * this runs the callback's get/update calls sequentially WITHOUT true
   * cross-operation atomicity — a partial failure partway through will NOT
   * roll back earlier writes on those backends. This is a real, meaningful
   * limitation, not a footnote: a caller relying on this for financial
   * correctness on a non-Firestore deployment should know that up front,
   * which is why this logs a warning every time the non-atomic path runs,
   * not just documents it here.
   */
  async runTransaction<T>(callback: (tx: NexusDBTransaction) => Promise<T>): Promise<T> {
    const adapter = await this.getAdapter();

    if (adapter.name === 'Firestore') {
      const { db } = await import('../../firebase');
      const { runTransaction: firestoreRunTransaction, doc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');
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
      `runTransaction() called with DB_PROVIDER='${adapter.name}' — this provider does not yet have real atomic transaction support in NexusDB. Operations will run sequentially without rollback-on-failure guarantees. See NexusDB.runTransaction's own doc comment.`
    );
    const tx: NexusDBTransaction = {
      get: (collection: string, id: string) => adapter.get(collection, id),
      update: (collection: string, id: string, data: Record<string, any>) => adapter.update(collection, id, data),
    };
    return callback(tx);
  }

  /** Returns provider name for diagnostics */
  get providerName(): string { return this.primary?.name ?? 'not initialized'; }

  /** Health check — used by /api/health */
  async healthCheck(): Promise<{ healthy: boolean; provider: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const adapter = await this.getAdapter();
      const ok = await adapter.ping();
      return { healthy: ok, provider: adapter.name, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, provider: 'none', latencyMs: Date.now() - start };
    }
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
   * For Firestore: returns firebase increment(n). For others: returns plain number.
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
    const url = process.env.TURSO_DATABASE_URL;
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
    const path = process.env.SQLITE_PATH || './nexus.db';
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
