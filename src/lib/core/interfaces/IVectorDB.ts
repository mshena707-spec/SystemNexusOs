/**
 * Vector DB Abstraction Layer (Phase 3 Upgrade)
 * Allows hot-swapping between Firestore (default), Qdrant, and Supabase pgvector
 * without modifying orchestrator logic.
 */
export interface VectorDocument {
  id: string;
  problem: string;
  solution: string;
  embedding: number[];
  satisfactionScore: number;
  metadata: any;
}

export interface IVectorDB {
  upsert(doc: VectorDocument): Promise<void>;
  search(queryEmbedding: number[], limit: number, minScore: number): Promise<{doc: VectorDocument, score: number}[]>;
  getAll(limit: number): Promise<VectorDocument[]>;
}

// Note: Concrete implements like QdrantAdapter or PgVectorAdapter would be injected here.
