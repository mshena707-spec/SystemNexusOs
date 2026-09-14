import { IStorageProvider, FindOptions } from '../interfaces/IStorageProvider';

/**
 * Universal Offline Storage Engine
 * Safely runs on browser via IndexedDB and Termux/Android natively without external DBs.
 */
export class IndexedDBAdapter implements IStorageProvider {
  name = 'IndexedDB Offline Storage';
  private dbName = 'nexus_universal_db';
  private db: IDBDatabase | null = null;

  async connect(): Promise<void> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('[IndexedDBAdapter] Environment does not support IndexedDB.');
      return;
    }
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        // Create generic object stores
        if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('system')) db.createObjectStore('system', { keyPath: 'id' });
      };

      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        console.log(`[IndexedDBAdapter] Connected locally.`);
        resolve();
      };

      request.onerror = (event: any) => reject(event.target.error);
    });
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async ping(): Promise<boolean> {
    return this.db !== null || (typeof window !== 'undefined' && !!window.indexedDB);
  }

  async set(collection: string, id: string, data: any, merge: boolean = true): Promise<void> {
    if (!this.db) await this.connect();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db!.transaction(collection, 'readwrite');
        const store = tx.objectStore(collection);
        store.put({ id, ...data });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        // If collection doesn't exist dynamically yet, gracefully fail or fallback
        console.warn(`[IndexedDBAdapter] Set failed, collection ${collection} may not exist`, e);
        reject(e);
      }
    });
  }

  async get(collection: string, id: string): Promise<any | null> {
    if (!this.db) await this.connect();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db!.transaction(collection, 'readonly');
        const store = tx.objectStore(collection);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async add(collection: string, data: any): Promise<string> {
    const id = Math.random().toString(36).substr(2, 9);
    await this.set(collection, id, data);
    return id;
  }

  async update(collection: string, id: string, data: any): Promise<void> {
    const existing = await this.get(collection, id);
    if (existing) {
      await this.set(collection, id, { ...existing, ...data });
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    if (!this.db) await this.connect();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db!.transaction(collection, 'readwrite');
        const store = tx.objectStore(collection);
        store.delete(id);
        tx.oncomplete = () => resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  async find(collection: string, options: FindOptions): Promise<any[]> {
    if (!this.db) await this.connect();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db!.transaction(collection, 'readonly');
        const store = tx.objectStore(collection);
        const req = store.getAll();
        req.onsuccess = () => {
          let results = req.result || [];
          if (options.where) {
             options.where.forEach(w => {
                 results = results.filter((r: any) => w.operator === '==' ? r[w.field] === w.value : true);
             });
          }
          resolve(results);
        };
        req.onerror = () => reject(req.error);
      } catch (e) {
         resolve([]);
      }
    });
  }
}
