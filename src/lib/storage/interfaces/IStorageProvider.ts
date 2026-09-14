export interface FindOptions {
  limit?: number;
  orderByField?: string;
  orderDirection?: 'asc' | 'desc';
  where?: { field: string; operator: string; value: any }[];
}

/**
 * Universal Storage Abstraction (Phase E)
 * Prevents vendor lock-in. Any database can implement this interface.
 */
export interface IStorageProvider {
  name: string;
  ping(): Promise<boolean>;
  
  get(collection: string, id: string): Promise<any | null>;
  set(collection: string, id: string, data: any, merge?: boolean): Promise<void>;
  add(collection: string, data: any): Promise<string>;
  update(collection: string, id: string, data: any): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  
  find(collection: string, options: FindOptions): Promise<any[]>;
  
  // Connects/Disconnects gracefully
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
