/**
 * PHASE 5 & 6: DATABASE ABSTRACTION & VECTOR DB SUPPORT
 * Allows switching DBs without code changing elsewhere.
 */

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export interface VectorQueryOptions {
  vector: number[];
  similarityThreshold: number;
  limit?: number;
}

export interface IDataAdapter {
  initialize(): Promise<void>;
  
  // Standard NoSQL/SQL Interface
  get(collection: string, id: string): Promise<any>;
  list(collection: string, options?: QueryOptions): Promise<any[]>;
  create(collection: string, data: any): Promise<string>;
  update(collection: string, id: string, data: any): Promise<boolean>;
  delete(collection: string, id: string): Promise<boolean>;

  // Vector DB Interface (Phase 6)
  vectorSearch?(collection: string, options: VectorQueryOptions): Promise<any[]>;
}

// Fallback/Default implementation (Simulation/Firestore placeholder)
export class FallbackDataAdapter implements IDataAdapter {
  private memoryStore: Map<string, Map<string, any>> = new Map();

  async initialize() {
    console.log('[DataAdapter] Initialized Fallback Database');
  }

  async get(collection: string, id: string) {
    return this.memoryStore.get(collection)?.get(id) || null;
  }

  async list(collection: string) {
    const colList = this.memoryStore.get(collection);
    return colList ? Array.from(colList.values()) : [];
  }

  async create(collection: string, data: any) {
    if (!this.memoryStore.has(collection)) this.memoryStore.set(collection, new Map());
    const id = crypto.randomUUID();
    this.memoryStore.get(collection)!.set(id, { id, ...data });
    return id;
  }

  async update(collection: string, id: string, data: any) {
    const item = await this.get(collection, id);
    if (!item) return false;
    this.memoryStore.get(collection)!.set(id, { ...item, ...data });
    return true;
  }

  async delete(collection: string, id: string) {
    return this.memoryStore.get(collection)?.delete(id) || false;
  }
}

export class DBFactory {
  static getAdapter(): IDataAdapter {
    // In future: Detect EnvironmentManager config to return Firebase / PostgreSQL / Qdrant
    return new FallbackDataAdapter();
  }
}
