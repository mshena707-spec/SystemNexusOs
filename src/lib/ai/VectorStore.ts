import { NexusDB } from '../database/NexusDB';
import { EmbeddingService } from './Embeddings';
import { Telemetry } from '../observability/Telemetry';

export interface VectorDocument {
  id?: string;
  content: string;
  metadata: any;
  embedding?: number[];
  type: 'bot_memory' | 'knowledge_base' | 'general';
}

export class VectorStore {
  
  /**
   * Adaptive Rewrite Engine
   * Generates 2-4 optimized alternative queries to improve recall.
   */
  private static async generateQueryRewrites(userQuery: string): Promise<string[]> {
    const wordCount = userQuery.trim().split(/\s+/).length;
    // Simple queries don't need rewrites
    if (wordCount < 3) return [userQuery];

    try {
      const { AIGateway } = await import('../core/AIGateway');
      const ai = AIGateway.getProvider();
      
      const prompt = `You are an AI Search Specialist. The user wants to search our business knowledge base/memory.\nUser Query: "${userQuery}"\n\nGenerate up to 3 alternative search queries optimized for embedding-based retrieval.\nInclude synonyms, business terminology, and variations in intent.\nIf the query is in Bangla, provide English equivalents and vice versa.\nOutput ONLY the alternative queries, one per line, no numbering, no formatting.`;
      
      const text = await ai.generateChat([{ role: 'user', content: prompt }]);
      
      if (!text) return [userQuery];
      
      const rewrites = text.split('\n').map(q => q.trim()).filter(q => q.length > 0).slice(0, 3);
      
      // Always include original query
      return Array.from(new Set([userQuery, ...rewrites]));
    } catch (e) {
      console.warn("[VectorStore] Query rewrite failed, falling back to original query:", e);
      return [userQuery];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) deduplication & re-ranking
   */
  private static applyRRF(rankedLists: { doc: VectorDocument, score: number }[][]): VectorDocument[] {
    const k = 60; // Standard RRF constant
    const rrfScores = new Map<string, { doc: VectorDocument, score: number }>();

    rankedLists.forEach((list) => {
      // Sort list to ensure correct rank
      list.sort((a, b) => b.score - a.score);
      list.forEach((item, rank) => {
        const id = item.doc.id!;
        const rrfContribution = 1.0 / (k + rank + 1);
        
        if (rrfScores.has(id)) {
          const existing = rrfScores.get(id)!;
          existing.score += rrfContribution;
        } else {
          rrfScores.set(id, { doc: item.doc, score: rrfContribution });
        }
      });
    });

    // Convert map to array and sort by RRF score descending
    const finalized = Array.from(rrfScores.values());
    finalized.sort((a, b) => b.score - a.score);
    return finalized.map(r => r.doc);
  }

  /**
   * Advanced Semantic Search with Multi-Query Retrieval & RRF
   */
  static async semanticSearch(userQuery: string, limit: number = 3, minScore: number = 0.5): Promise<VectorDocument[]> {
    const trace = Telemetry.startTrace('VectorStore.multiQuerySearch', 'system', 'system');
    const span = trace.startSpan('multi_query_search', { originalQuery: userQuery });

    try {
      // 1. Adaptive Query Rewrite
      const rewriteSpan = trace.startSpan('query_rewrite', {}, span.id);
      const searchQueries = await this.generateQueryRewrites(userQuery);
      trace.endSpan(rewriteSpan.id, 'success', undefined, { queriesGenerated: searchQueries.length, queries: searchQueries });

      // 2. Parallel Embedding Generation
      const embedSpan = trace.startSpan('parallel_embeddings', {}, span.id);
      const queryEmbeddings = await Promise.all(
        searchQueries.map(q => EmbeddingService.generateEmbedding(q))
      );
      trace.endSpan(embedSpan.id, 'success');
      
      // 3. Document Fetch (Optimized: Fetch once)
      const fetchSpan = trace.startSpan('fetch_documents', {}, span.id);
      let snapshotDocs: any[] = [];
      {
         snapshotDocs = await NexusDB.find('bot_memories', { where: [{ field: 'customerSatisfied', op: '==', value: true }] });
      }
      trace.endSpan(fetchSpan.id, 'success', undefined, { docCount: snapshotDocs.length });
      
      // 4. Parallel Scoring per Query List
      const rankedLists: { doc: VectorDocument, score: number }[][] = searchQueries.map(() => []);

      for (const docSnap of snapshotDocs) {
        const data = docSnap.data();
        let docEmbedding = data.embedding;
        
        // Lazy-compute embedding if missing
        if (!docEmbedding && data.problem && data.solution) {
           const textToEmbed = `Problem: ${data.problem}\nSolution: ${data.solution}`;
           docEmbedding = await EmbeddingService.generateEmbedding(textToEmbed);
           NexusDB.update('bot_memories', docSnap.id, { embedding: docEmbedding }).catch(console.error);
        }
        
        if (docEmbedding) {
          const docData: VectorDocument = {
            id: docSnap.id,
            content: `Problem: ${data.problem}\nSolution: ${data.solution}`,
            metadata: data,
            type: 'bot_memory'
          };

          // Score against each query embedding
          queryEmbeddings.forEach((qEmbedding, idx) => {
             if (qEmbedding) {
               const score = EmbeddingService.cosineSimilarity(qEmbedding, docEmbedding!);
               if (score >= minScore) {
                 rankedLists[idx].push({ doc: docData, score });
               }
             }
          });
        }
      }
      
      // 5. Merge + Deduplicate via Reciprocal Rank Fusion (RRF)
      const rrfSpan = trace.startSpan('rerank_and_fuse', {}, span.id);
      const topResults = this.applyRRF(rankedLists).slice(0, limit);
      trace.endSpan(rrfSpan.id, 'success', undefined, { finalHits: topResults.length });

      trace.endSpan(span.id, 'success', undefined, { hits: topResults.length });
      await trace.endTrace('success');
      return topResults;
    } catch (e: any) {
      trace.endSpan(span.id, 'error', e.message);
      await trace.endTrace('error');
      console.error("[VectorStore] Search error:", e);
      return [];
    }
  }

  static async saveMemoryContext(problem: string, solution: string, metadata: any = {}, sentimentScore: number = 1.0) {
    if (sentimentScore < 0.7) {
      console.log(`[VectorStore] Memory rejected due to low customer satisfaction score (${sentimentScore}). Preventing data poisoning.`);
      return;
    }

    const { BackgroundQueue } = await import('../core/QueueWorker');
    
    // Phase 2: Offload heavy embedding to the Queue System!
    BackgroundQueue.enqueue('save_memory_context', async () => {
       let textToEmbed = `Problem: ${problem}\nSolution: ${solution}`;

       try {
         const { AIGateway } = await import('../core/AIGateway');
         const ai = AIGateway.getProvider();
         const prompt = `Extract the core intent, keywords, and exact resolution from this problem/solution pair so it can be retrieved efficiently from a Vector Database. Be concise.\n\nProblem: ${problem}\nSolution: ${solution}`;
         const summaryRes = await ai.generateChat([{ role: 'user', content: prompt }]);
         
         if (summaryRes) {
           textToEmbed = summaryRes;
         }
       } catch(e: any) {
         const errMsg = e?.message || String(e);
         if (errMsg.includes("API key not valid") || errMsg.includes("API_KEY_INVALID") || errMsg.includes("API key should be set") || errMsg.includes("insufficient authentication scopes") || errMsg.includes("MY_GEMINI_API_KEY") || errMsg.includes("Circuit Breaker is OPEN")) {
           // Skip context sharpening silently if no active API key or circuit breaker is open
         } else {
           console.warn("[VectorStore] Failed to sharpen embedding context:", e);
         }
       }

       const embedding = await EmbeddingService.generateEmbedding(textToEmbed);
       
       {
         try {
           await NexusDB.add('bot_memories', {
             problem,
             solution,
             embedding,
             resolvedBy: metadata?.resolvedBy || 'Nexus_System',
             customerSatisfied: sentimentScore >= 0.7,
             locked: false,
             timestamp: NexusDB.serverTimestamp()
           });
           console.log("[VectorStore] Memory successfully persisted to DB.");
         } catch (e) {
           console.warn("[VectorStore] Skipping memory write (Firebase backend auth error):", e);
         }
       }
    });
  }
}
