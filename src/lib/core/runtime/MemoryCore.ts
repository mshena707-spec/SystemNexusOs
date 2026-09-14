import { GlobalStorage } from '../../storage/StorageRegistry';

export interface BaseEntity {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Universal Memory Core (Phase E - Write Logic)
 * Interacts transparently with the GlobalStorage router.
 * Safe, type-strict writes. Protects original creation dates.
 */
export class SafeMemoryCore {
  
  static async insert<T extends BaseEntity>(collection: string, data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const engine = await GlobalStorage.getEngine();
    
    // Safety 1: Strict Timestamps enforcement
    const document = {
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    // Engine abstract adding
    const newId = await engine.add(collection, document);
    console.log(`[MemoryCore] Safe Insert into ${collection} using engine: ${engine.name}`);
    return newId;
  }

  static async update<T extends BaseEntity>(collection: string, id: string, updates: Partial<Omit<T, 'id' | 'createdAt'>>): Promise<void> {
    const engine = await GlobalStorage.getEngine();
    
    // Safety 2: Never map over or destroy createdAt implicitly
    const sanitizedUpdates = {
      ...updates,
      updatedAt: Date.now() // Safety: Auto timestamp
    };
    
    await engine.update(collection, id, sanitizedUpdates);
    console.log(`[MemoryCore] Safe Update in ${collection}/${id}`);
  }

  static async upsert(collection: string, id: string, data: any): Promise<void> {
    const engine = await GlobalStorage.getEngine();
    const existing = await engine.get(collection, id);
    
    if (existing) {
      await this.update(collection, id, data);
    } else {
      await engine.set(collection, id, {
         ...data,
         createdAt: Date.now(),
         updatedAt: Date.now()
      });
      console.log(`[MemoryCore] Upserted new record at ${collection}/${id}`);
    }
  }

  static async softDelete(collection: string, id: string): Promise<void> {
    const engine = await GlobalStorage.getEngine();
    await engine.update(collection, id, { 
       isDeleted: true, 
       deletedAt: Date.now(),
       updatedAt: Date.now()
    });
    console.log(`[MemoryCore] Soft-deleted ${collection}/${id}`);
  }

  static async fetch(collection: string, id: string): Promise<any | null> {
    const engine = await GlobalStorage.getEngine();
    return engine.get(collection, id);
  }
}
