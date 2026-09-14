/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  NEXUS MEMORY BRAIN — Phase C                                       ║
 * ║                                                                      ║
 * ║  The complete memory pipeline for every AI query:                   ║
 * ║                                                                      ║
 * ║  Query → STM Check → LTM Vector Search → Confidence Score           ║
 * ║       → Answer Reuse (if confident) OR AI Call (if not)             ║
 * ║       → Feedback Collection → Knowledge Update                      ║
 * ║       → API Cost Reduction on next identical query                  ║
 * ║                                                                      ║
 * ║  Every successful answer reduces future API usage.                  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { EmbeddingService } from '../../ai/Embeddings';

// ── Types ────────────────────────────────────────────────────────────────

export interface MemoryLookupResult {
  found: boolean;
  answer?: string;
  confidence: number;          // 0.0 – 1.0
  source: 'stm' | 'ltm' | 'kb' | 'none';
  entryId?: string;
  hitCount?: number;
  savedApiCall: boolean;
}

export interface MemoryStoreRequest {
  query: string;
  answer: string;
  agentId: string;
  userId?: string;
  modelUsed?: string;
  tokensUsed?: number;
  costUsd?: number;
  sessionId?: string;
  domain?: 'customer' | 'business' | 'operational' | 'general';
  tags?: string[];
}

export interface FeedbackRequest {
  entryId: string;
  helpful: boolean;
  correction?: string;
  userId?: string;
}

export interface MemoryStats {
  totalEntries: number;
  stmHits: number;
  ltmHits: number;
  kbHits: number;
  totalMisses: number;
  hitRate: number;
  estimatedApiSavingsUsd: number;
  avgConfidenceOnHit: number;
  topQueries: Array<{ query: string; hits: number }>;
}

// ── Constants ────────────────────────────────────────────────────────────

const STM_TTL_MS         = 30 * 60 * 1000;   // 30 min short-term
const LTM_CONFIDENCE     = 0.82;              // minimum cosine for LTM reuse
const KB_CONFIDENCE      = 0.78;              // minimum for knowledge base reuse
const STM_EXACT_THRESH   = 0.95;             // near-exact match in STM
const MAX_STM_ENTRIES    = 200;               // per-session STM cap
const AVG_COST_PER_CALL  = 0.0015;           // USD estimate per AI call saved

// ── In-process STM (session-scoped) ──────────────────────────────────────

interface STMEntry {
  query: string;
  embedding: number[];
  answer: string;
  confidence: number;
  hitCount: number;
  storedAt: number;
  expiresAt: number;
  entryId: string;
}

const sessionSTM = new Map<string, STMEntry[]>(); // sessionId → entries

// ── Stats (in-memory, flushed to Firestore every 5 min) ─────────────────

const _stats = {
  stmHits: 0, ltmHits: 0, kbHits: 0, misses: 0,
  confidenceSum: 0, confidenceCount: 0, savedUsd: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY BRAIN — Main class
// ═══════════════════════════════════════════════════════════════════════════

export class MemoryBrain {

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: LOOKUP — search STM → LTM → Knowledge Base
  // Returns answer if found with sufficient confidence, otherwise found=false
  // ─────────────────────────────────────────────────────────────────────────
  static async lookup(
    query: string,
    options: {
      sessionId?: string;
      agentId?: string;
      domain?: string;
      userId?: string;
    } = {}
  ): Promise<MemoryLookupResult> {

    const { sessionId = 'global', agentId = 'system' } = options;

    // 1a. Generate embedding for the query
    let queryEmbedding: number[];
    try {
      queryEmbedding = await EmbeddingService.generateEmbedding(query);
    } catch {
      return { found: false, confidence: 0, source: 'none', savedApiCall: false };
    }

    // 1b. STM check (fastest — in-process)
    const stmResult = this._searchSTM(sessionId, queryEmbedding, query);
    if (stmResult) {
      _stats.stmHits++;
      _stats.confidenceSum += stmResult.confidence;
      _stats.confidenceCount++;
      _stats.savedUsd += AVG_COST_PER_CALL;
      stmResult.hitCount++;
      return {
        found: true,
        answer: stmResult.answer,
        confidence: stmResult.confidence,
        source: 'stm',
        entryId: stmResult.entryId,
        hitCount: stmResult.hitCount,
        savedApiCall: true,
      };
    }

    // 1c. LTM vector search (Firestore semantic memory)
    const ltmResult = await this._searchLTM(queryEmbedding, query, agentId, options.domain);
    if (ltmResult) {
      _stats.ltmHits++;
      _stats.confidenceSum += ltmResult.confidence;
      _stats.confidenceCount++;
      _stats.savedUsd += AVG_COST_PER_CALL;
      // Promote to STM for fast reuse this session
      this._writeSTM(sessionId, { query, embedding: queryEmbedding, answer: ltmResult.answer, confidence: ltmResult.confidence, entryId: ltmResult.entryId! });
      return { found: true, answer: ltmResult.answer, confidence: ltmResult.confidence, source: 'ltm', entryId: ltmResult.entryId, savedApiCall: true };
    }

    // 1d. Knowledge base search (business facts, product info, FAQs)
    const kbResult = await this._searchKnowledgeBase(queryEmbedding, query);
    if (kbResult) {
      _stats.kbHits++;
      _stats.confidenceSum += kbResult.confidence;
      _stats.confidenceCount++;
      _stats.savedUsd += AVG_COST_PER_CALL;
      this._writeSTM(sessionId, { query, embedding: queryEmbedding, answer: kbResult.answer, confidence: kbResult.confidence, entryId: kbResult.entryId! });
      return { found: true, answer: kbResult.answer, confidence: kbResult.confidence, source: 'kb', entryId: kbResult.entryId, savedApiCall: true };
    }

    _stats.misses++;
    return { found: false, confidence: 0, source: 'none', savedApiCall: false };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: STORE — save AI response to memory for future reuse
  // ─────────────────────────────────────────────────────────────────────────
  static async store(req: MemoryStoreRequest): Promise<string | null> {
    const { query, answer, agentId, sessionId = 'global' } = req;

    let embedding: number[];
    try {
      embedding = await EmbeddingService.generateEmbedding(query);
    } catch {
      return null;
    }

    // Write to STM immediately
    const entryId = `mem_${Date.now()}_${agentId.slice(0,6)}`;
    this._writeSTM(sessionId, { query, embedding, answer, confidence: 1.0, entryId });

    // Write to LTM (Firestore semantic memory) asynchronously
    this._writeLTM({
      entryId,
      query,
      answer,
      embedding,
      agentId,
      userId: req.userId,
      modelUsed: req.modelUsed,
      tokensUsed: req.tokensUsed,
      costUsd: req.costUsd,
      domain: req.domain ?? 'general',
      tags: req.tags ?? [],
    }).catch(err => console.error('[MemoryBrain] LTM write failed:', err));

    return entryId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: FEEDBACK — user rates the answer
  // Updates confidence, triggers knowledge correction if needed
  // ─────────────────────────────────────────────────────────────────────────
  static async recordFeedback(req: FeedbackRequest): Promise<void> {
    const { entryId, helpful, correction, userId } = req;
    if (!entryId) return;

    try {
      const { db } = await import('../../../firebase');
      const { doc, updateDoc, serverTimestamp, collection, addDoc } = await import('firebase/firestore');

      // Update the memory entry
      const memRef = doc(db, 'memory_semantic', entryId);
      await updateDoc(memRef, {
        feedback: helpful ? 'positive' : 'negative',
        feedbackCount: 1,          // increment on real usage
        helpfulCount: helpful ? 1 : 0,
        lastFeedbackAt: serverTimestamp(),
        confidence: helpful ? 1.0 : 0.3,  // downgrade on negative
        ...(correction ? { correctedAnswer: correction } : {}),
      });

      // If correction provided, write a new corrected entry to KB
      if (correction && !helpful) {
        await this._writeToKnowledgeBase({
          query: '',              // will be set by fetch below
          answer: correction,
          source: 'human_correction',
          authorId: userId ?? 'system',
          tags: ['correction', 'human_verified'],
          confidence: 1.0,
        }, entryId);
      }

      // Record to learning memory
      await addDoc(collection(db, 'memory_learning'), {
        entryId,
        feedback: helpful ? 'positive' : 'negative',
        correctedAnswer: correction ?? null,
        userId: userId ?? null,
        createdAt: serverTimestamp(),
      });

    } catch (err) {
      console.error('[MemoryBrain] Feedback write failed:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: KNOWLEDGE BASE — write business facts, FAQs, product info
  // Used by: owner (manual), automation (product updates), learning (corrections)
  // ─────────────────────────────────────────────────────────────────────────
  static async writeKnowledge(
    question: string,
    answer: string,
    options: {
      source?: string;
      authorId?: string;
      tags?: string[];
      category?: 'product' | 'policy' | 'faq' | 'pricing' | 'operational';
    } = {}
  ): Promise<string> {
    let embedding: number[];
    try {
      embedding = await EmbeddingService.generateEmbedding(question);
    } catch {
      embedding = [];
    }

    const id = `kb_${Date.now()}_${(options.authorId ?? 'sys').slice(0,6)}`;
    const { db } = await import('../../../firebase');
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');

    await setDoc(doc(db, 'knowledge_base', id), {
      id,
      question,
      answer,
      embedding,
      source: options.source ?? 'manual',
      authorId: options.authorId ?? 'system',
      tags: options.tags ?? [],
      category: options.category ?? 'faq',
      confidence: 1.0,
      hitCount: 0,
      helpfulCount: 0,
      feedbackCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return id;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUSINESS LEARNING — capture order/product/customer patterns
  // ─────────────────────────────────────────────────────────────────────────
  static async learnFromBusiness(event: {
    type: 'order_pattern' | 'product_question' | 'customer_preference' | 'delivery_issue' | 'payment_issue';
    data: Record<string, any>;
    userId?: string;
  }): Promise<void> {
    try {
      const { db } = await import('../../../firebase');
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'business_learning'), {
        ...event,
        createdAt: serverTimestamp(),
      });

      // For product questions, auto-add to knowledge base
      if (event.type === 'product_question' && event.data.question && event.data.answer) {
        await this.writeKnowledge(event.data.question, event.data.answer, {
          source: 'business_learning',
          category: 'product',
          tags: ['auto', event.type],
        });
      }
    } catch (err) {
      console.error('[MemoryBrain] Business learning write failed:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OPERATIONAL LEARNING — capture system behavior patterns
  // ─────────────────────────────────────────────────────────────────────────
  static async learnFromOperation(event: {
    type: 'api_failure' | 'slow_query' | 'rider_pattern' | 'sla_breach' | 'fraud_pattern';
    data: Record<string, any>;
  }): Promise<void> {
    try {
      const { db } = await import('../../../firebase');
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'operational_learning'), {
        ...event,
        createdAt: serverTimestamp(),
      });
    } catch { /* non-blocking */ }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATS — return memory performance metrics
  // ─────────────────────────────────────────────────────────────────────────
  static getStats(): MemoryStats {
    const total = _stats.stmHits + _stats.ltmHits + _stats.kbHits + _stats.misses;
    return {
      totalEntries: sessionSTM.size,
      stmHits: _stats.stmHits,
      ltmHits: _stats.ltmHits,
      kbHits: _stats.kbHits,
      totalMisses: _stats.misses,
      hitRate: total > 0 ? Math.round((_stats.stmHits + _stats.ltmHits + _stats.kbHits) / total * 100) : 0,
      estimatedApiSavingsUsd: Math.round(_stats.savedUsd * 10000) / 10000,
      avgConfidenceOnHit: _stats.confidenceCount > 0 ? Math.round(_stats.confidenceSum / _stats.confidenceCount * 100) / 100 : 0,
      topQueries: [],  // populated by periodic Firestore query if needed
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRIVATE: STM (in-process, session-scoped)
  // ═══════════════════════════════════════════════════════════════════════

  private static _searchSTM(sessionId: string, queryEmb: number[], queryText: string): STMEntry | null {
    const entries = sessionSTM.get(sessionId) ?? [];
    const now = Date.now();
    const live = entries.filter(e => e.expiresAt > now);
    if (live.length !== entries.length) sessionSTM.set(sessionId, live);

    let best: STMEntry | null = null;
    let bestScore = STM_EXACT_THRESH;

    for (const e of live) {
      // Fast exact text check first
      if (e.query.toLowerCase().trim() === queryText.toLowerCase().trim()) {
        return e; // perfect match
      }
      const score = EmbeddingService.cosineSimilarity(queryEmb, e.embedding);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  private static _writeSTM(sessionId: string, entry: Omit<STMEntry, 'hitCount' | 'storedAt' | 'expiresAt'>): void {
    const now = Date.now();
    const entries = (sessionSTM.get(sessionId) ?? []).filter(e => e.expiresAt > now);
    if (entries.length >= MAX_STM_ENTRIES) entries.shift(); // evict oldest
    entries.push({ ...entry, hitCount: 0, storedAt: now, expiresAt: now + STM_TTL_MS });
    sessionSTM.set(sessionId, entries);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRIVATE: LTM (Firestore semantic memory)
  // ═══════════════════════════════════════════════════════════════════════

  private static async _searchLTM(
    queryEmb: number[],
    queryText: string,
    agentId: string,
    domain?: string,
  ): Promise<{ answer: string; confidence: number; entryId: string } | null> {
    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');

      // Fetch recent positively-rated entries
      const constraints: any[] = [
        where('feedback', 'in', ['positive', null]),
        where('confidence', '>=', LTM_CONFIDENCE),
        orderBy('confidence', 'desc'),
        orderBy('hitCount', 'desc'),
        limit(50),
      ];
      if (domain) constraints.unshift(where('domain', '==', domain));

      const snap = await getDocs(query(collection(db, 'memory_semantic'), ...constraints));
      const entries = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const hits = entries
        .filter(e => Array.isArray(e.embedding) && e.embedding.length > 0)
        .map(e => ({
          id: e.id,
          answer: e.answer ?? e.content,
          score: EmbeddingService.cosineSimilarity(queryEmb, e.embedding),
        }))
        .filter(e => e.score >= LTM_CONFIDENCE)
        .sort((a, b) => b.score - a.score);

      if (hits.length === 0) return null;
      return { answer: hits[0].answer, confidence: hits[0].score, entryId: hits[0].id };
    } catch {
      return null;
    }
  }

  private static async _writeLTM(entry: {
    entryId: string; query: string; answer: string; embedding: number[];
    agentId: string; userId?: string; modelUsed?: string;
    tokensUsed?: number; costUsd?: number; domain: string; tags: string[];
  }): Promise<void> {
    const { db } = await import('../../../firebase');
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');

    await setDoc(doc(db, 'memory_semantic', entry.entryId), {
      id: entry.entryId,
      query: entry.query,
      answer: entry.answer,
      content: `Q: ${entry.query}\nA: ${entry.answer}`,
      embedding: entry.embedding,
      agentId: entry.agentId,
      userId: entry.userId ?? null,
      modelUsed: entry.modelUsed ?? null,
      tokensUsed: entry.tokensUsed ?? null,
      costUsd: entry.costUsd ?? null,
      domain: entry.domain,
      tags: entry.tags,
      confidence: 1.0,
      feedback: null,
      feedbackCount: 0,
      helpfulCount: 0,
      hitCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRIVATE: Knowledge Base (Firestore knowledge_base collection)
  // ═══════════════════════════════════════════════════════════════════════

  private static async _searchKnowledgeBase(
    queryEmb: number[],
    queryText: string,
  ): Promise<{ answer: string; confidence: number; entryId: string } | null> {
    try {
      const { db } = await import('../../../firebase');
      const { collection, getDocs, query, orderBy, limit } = await import('firebase/firestore');

      const snap = await getDocs(
        query(collection(db, 'knowledge_base'), orderBy('hitCount', 'desc'), limit(100))
      );
      const entries = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const hits = entries
        .filter(e => Array.isArray(e.embedding) && e.embedding.length > 0)
        .map(e => ({
          id: e.id,
          answer: e.answer,
          score: EmbeddingService.cosineSimilarity(queryEmb, e.embedding),
        }))
        .filter(e => e.score >= KB_CONFIDENCE)
        .sort((a, b) => b.score - a.score);

      if (hits.length === 0) return null;

      // Increment hit count in background
      this._incrementKBHit(hits[0].id).catch(() => {});
      return { answer: hits[0].answer, confidence: hits[0].score, entryId: hits[0].id };
    } catch {
      return null;
    }
  }

  private static async _incrementKBHit(id: string): Promise<void> {
    const { db } = await import('../../../firebase');
    const { doc, updateDoc, increment, serverTimestamp } = await import('firebase/firestore');
    await updateDoc(doc(db, 'knowledge_base', id), {
      hitCount: increment(1),
      lastHitAt: serverTimestamp(),
    });
  }

  private static async _writeToKnowledgeBase(entry: {
    query: string; answer: string; source: string; authorId: string;
    tags: string[]; confidence: number;
  }, sourceEntryId?: string): Promise<void> {
    // Fetch original query if sourceEntryId provided
    let question = entry.query;
    if (sourceEntryId && !question) {
      try {
        const { db } = await import('../../../firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'memory_semantic', sourceEntryId));
        question = snap.data()?.query ?? '';
      } catch { /* silent */ }
    }
    if (question) {
      await this.writeKnowledge(question, entry.answer, {
        source: entry.source,
        authorId: entry.authorId,
        tags: entry.tags,
      });
    }
  }
}
