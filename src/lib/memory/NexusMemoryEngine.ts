/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              NEXUS MEMORY ENGINE — CENTRAL ORCHESTRATOR       ║
 * ║  Phase 2: Production-grade 8-type memory system              ║
 * ║                                                              ║
 * ║  STORAGE ROUTING:                                            ║
 * ║   Personal/Shared/Episodic/Restricted → Firestore            ║
 * ║   Immutable/Owner/Learning → PostgreSQL (Firestore fallback) ║
 * ║   Semantic → Qdrant (cosine search fallback)                 ║
 * ║   All types → Redis cache layer (fast reads)                 ║
 * ║                                                              ║
 * ║  ALL WRITES go through MemoryACL first.                      ║
 * ║  Agents NEVER directly access storage backends.              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   // Write personal memory
 *   await MemoryEngine.writePersonal('agent-1', 'user-123', 'Customer prefers spicy food');
 *
 *   // Store conversation episode
 *   await MemoryEngine.appendEpisode('session-abc', 'user-123', [
 *     { role: 'user', content: 'I want to order turmeric', timestamp: Date.now() }
 *   ]);
 *
 *   // Semantic search
 *   const results = await MemoryEngine.semanticSearch('spicy food preferences', { topK: 5 });
 *
 *   // Record learning
 *   await MemoryEngine.recordLearning('agent-1', 'What is your price?', 'Our price is $10', 'positive');
 */

import crypto from 'crypto';
import {
  MemoryType, MemoryEntry, MemoryQuery, MemoryWriteOptions, MemoryStats,
  PersonalMemory, SharedMemory, ImmutableMemory, OwnerMemory,
  RestrictedMemory, EpisodicMemory, SemanticMemory, LearningMemory,
  EpisodeEntry,
} from './interfaces/MemoryTypes';
import { MemoryACL, MemoryCaller } from './acl/MemoryACL';
import { FirestoreMemoryAdapter } from './adapters/MemoryAdapters';
import { PostgreSQLMemoryAdapter } from './adapters/MemoryAdapters';
import { QdrantMemoryAdapter } from './adapters/MemoryAdapters';
import { RedisMemoryAdapter } from './adapters/MemoryAdapters';
import { logger } from '../core/logging/NexusLogger';
import { EventBus } from '../core/events/NexusEventBus';
import { MemoryEncryption } from './MemoryEncryption';
import { SecretVault } from '../security/vault/SecretVault';

const log = logger.child('MemoryEngine');

// ── Helpers ───────────────────────────────────────────────────────────────
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * CTO Audit Part 5, section 19 ("Digital Signature"). HMAC-SHA256 rather than
 * asymmetric (RSA/ECDSA) signing — deliberate: this system has one signing
 * authority (the server itself, via a shared key in SecretVault) rather than
 * multiple independent parties needing separately verifiable keys, which is
 * the scenario asymmetric signing is for. If external parties ever need to
 * independently verify a record without trusting this server, revisit with
 * asymmetric signing — HMAC verification requires the same secret used to sign.
 */
function signContent(content: string, signedBy: string): string | undefined {
  if (!SecretVault.hasSecret('IMMUTABLE_MEMORY_SIGNING_KEY')) {
    log.warn('IMMUTABLE_MEMORY_SIGNING_KEY not configured — writing without a signature (hash-only integrity)');
    return undefined;
  }
  const key = SecretVault.get('IMMUTABLE_MEMORY_SIGNING_KEY', { caller: 'system', module: 'MemoryEngine.signContent' });
  return crypto.createHmac('sha256', key).update(`${signedBy}:${content}`).digest('hex');
}

function verifySignatureInternal(content: string, signedBy: string, signature: string): boolean {
  if (!SecretVault.hasSecret('IMMUTABLE_MEMORY_SIGNING_KEY')) return false;
  const key = SecretVault.get('IMMUTABLE_MEMORY_SIGNING_KEY', { caller: 'system', module: 'MemoryEngine.verifySignature' });
  const expected = crypto.createHmac('sha256', key).update(`${signedBy}:${content}`).digest('hex');
  // Constant-time comparison — a plain === on signatures is a timing-attack
  // surface; crypto.timingSafeEqual is the standard defense.
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── SYSTEM CALLER (for internal operations) ───────────────────────────────
const SYSTEM_CALLER: MemoryCaller = {
  id: 'system',
  type: 'system',
  roles: ['admin'],
  isOwner: false,
};

// ════════════════════════════════════════════════════════════════════════
// MEMORY ENGINE
// ════════════════════════════════════════════════════════════════════════
class NexusMemoryEngineImpl {
  private firestore = new FirestoreMemoryAdapter();
  private postgres = new PostgreSQLMemoryAdapter();
  private qdrant = new QdrantMemoryAdapter();
  private redis = new RedisMemoryAdapter();
  private initialized = false;
  private stats = {
    reads: 0, writes: 0, denials: 0, cacheHits: 0,
  };

  // ── Initialization ────────────────────────────────────────────────────
  async initialize(): Promise<void> {
    if (this.initialized) return;
    log.info('Initializing Memory Engine...');

    const [fsOk, pgOk, qdOk, rdOk] = await Promise.allSettled([
      this.firestore.connect(),
      this.postgres.connect(),
      this.qdrant.connect(),
      this.redis.connect(),
    ]);

    log.info('Memory Engine initialized', {
      firestore: (fsOk as any).value,
      postgres:  (pgOk as any).value,
      qdrant:    (qdOk as any).value,
      redis:     (rdOk as any).value,
    });

    this.initialized = true;
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. PERSONAL MEMORY
  // ════════════════════════════════════════════════════════════════════
  async writePersonal(
    agentId: string,
    ownerId: string,
    content: string,
    opts: MemoryWriteOptions = {},
    caller: MemoryCaller = SYSTEM_CALLER,
  ): Promise<PersonalMemory | null> {
    const entry: PersonalMemory = {
      id: genId('pm'),
      type: MemoryType.PERSONAL,
      scope: 'agent',
      agentId,
      ownerId,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: opts.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : undefined,
      version: 1,
      tags: opts.tags || [],
      metadata: opts.metadata,
      accessCount: 0,
      lastAccessedAt: Date.now(),
    };

    const acl = MemoryACL.canWrite(null, MemoryType.PERSONAL, caller);
    if (!acl.allowed) {
      MemoryACL.logAccessDenied('write', entry.id, MemoryType.PERSONAL, caller, acl.reason!);
      this.stats.denials++;
      return null;
    }

    await this._ensureInit();
    await this.firestore.write(entry);
    await this.redis.cacheEntry(entry.id, entry, 300);
    this.stats.writes++;
    EventBus.emitAsync('memory.written', { type: MemoryType.PERSONAL, id: entry.id, agentId }, 'MemoryEngine');
    log.debug('Personal memory written', { id: entry.id, agentId });
    return entry;
  }

  async readPersonal(id: string, caller: MemoryCaller): Promise<PersonalMemory | null> {
    await this._ensureInit();
    this.stats.reads++;

    // Check Redis cache first
    const cached = await this.redis.getCachedEntry(id);
    if (cached) {
      const acl = MemoryACL.canRead(cached, caller);
      if (!acl.allowed) { this.stats.denials++; return null; }
      this.stats.cacheHits++;
      return cached as PersonalMemory;
    }

    const entry = await this.firestore.read(id, MemoryType.PERSONAL) as PersonalMemory | null;
    if (!entry) return null;

    const acl = MemoryACL.canRead(entry, caller);
    if (!acl.allowed) {
      MemoryACL.logAccessDenied('read', id, MemoryType.PERSONAL, caller, acl.reason!);
      this.stats.denials++;
      return null;
    }

    // Update access count
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    await this.redis.cacheEntry(id, entry, 300);
    return entry;
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. SHARED MEMORY
  // ════════════════════════════════════════════════════════════════════
  async writeShared(
    ownerId: string,
    content: string,
    writePolicy: SharedMemory['writePolicy'] = 'multi_writer',
    opts: MemoryWriteOptions = {},
    caller: MemoryCaller = SYSTEM_CALLER,
  ): Promise<SharedMemory | null> {
    const entry: SharedMemory = {
      id: genId('sm'),
      type: MemoryType.SHARED,
      scope: 'global',
      ownerId,
      content,
      writePolicy,
      readBy: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: opts.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : undefined,
      version: 1,
      tags: opts.tags || [],
    };

    const acl = MemoryACL.canWrite(null, MemoryType.SHARED, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    // Acquire write lock for single_writer policy
    if (writePolicy === 'single_writer') {
      const locked = await this.redis.acquireLock(entry.id, caller.id, 30);
      if (!locked) { log.warn('Shared memory write lock failed', { entryId: entry.id }); return null; }
    }

    await this._ensureInit();
    await this.firestore.write(entry);
    await this.redis.cacheEntry(entry.id, entry, 120);

    if (writePolicy === 'single_writer') {
      await this.redis.releaseLock(entry.id, caller.id);
    }

    this.stats.writes++;
    EventBus.emitAsync('memory.written', { type: MemoryType.SHARED, id: entry.id }, 'MemoryEngine');
    return entry;
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. IMMUTABLE MEMORY (Write-once, append-only audit log)
  // ════════════════════════════════════════════════════════════════════
  async writeImmutable(
    ownerId: string,
    signedBy: string,
    content: string,
    opts: { chainPrev?: string; witnesses?: string[] } = {},
    caller: MemoryCaller = SYSTEM_CALLER,
  ): Promise<ImmutableMemory | null> {
    const acl = MemoryACL.canWrite(null, MemoryType.IMMUTABLE, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    const entry: ImmutableMemory = {
      id: genId('im'),
      type: MemoryType.IMMUTABLE,
      scope: 'global',
      ownerId,
      signedBy,
      content,
      hash: hashContent(content),
      signature: signContent(content, signedBy),
      witnessIds: opts.witnesses || [],
      chainPrev: opts.chainPrev,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      tags: [],
    };

    await this._ensureInit();

    // Primary: PostgreSQL append-only table
    if (this.postgres.isConnected()) {
      await this.postgres.writeImmutable(entry);
    } else {
      // Fallback: Firestore
      await this.firestore.write(entry);
    }

    this.stats.writes++;
    log.info('Immutable record written', { id: entry.id, hash: entry.hash, signedBy });
    return entry;
  }

  /** Verify immutable record integrity (hash) */
  async verifyImmutable(entry: ImmutableMemory): Promise<boolean> {
    const expected = hashContent(entry.content);
    const valid = entry.hash === expected;
    if (!valid) {
      log.error('IMMUTABLE MEMORY INTEGRITY VIOLATION', undefined, {
        entryId: entry.id, expectedHash: expected, storedHash: entry.hash,
      });
      EventBus.emitAsync('memory.corrupted', { entryId: entry.id, type: MemoryType.IMMUTABLE }, 'MemoryEngine');
    }
    return valid;
  }

  /** Verify WHO created the record, not just that content is unaltered — see
   *  ImmutableMemory.signature's doc comment for the hash-vs-signature
   *  distinction. Returns false (not throws) for entries written before
   *  signing existed (no `signature` field) — check `entry.signature` first
   *  if you need to distinguish "not signed" from "signature invalid". */
  async verifyImmutableSignature(entry: ImmutableMemory): Promise<boolean> {
    if (!entry.signature) return false;
    const valid = verifySignatureInternal(entry.content, entry.signedBy, entry.signature);
    if (!valid) {
      log.error('IMMUTABLE MEMORY SIGNATURE VERIFICATION FAILED', undefined, {
        entryId: entry.id, claimedSignedBy: entry.signedBy,
      });
      EventBus.emitAsync('security.breach_attempt', { entryId: entry.id, subtype: 'signature_forgery_suspected' }, 'MemoryEngine');
    }
    return valid;
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. OWNER MEMORY
  // ════════════════════════════════════════════════════════════════════
  async writeOwner(
    content: string,
    opts: MemoryWriteOptions = {},
    caller: MemoryCaller,
  ): Promise<OwnerMemory | null> {
    const acl = MemoryACL.canWrite(null, MemoryType.OWNER, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    // CTO Audit Part 4, section 14: was `content, // In production: encrypt this
    // field` — implemented now via MemoryEncryption (AES-256-GCM, keyed through
    // SecretVault). Stored as a JSON-stringified EncryptedPayload within the
    // existing `content: string` field — no interface change needed, and
    // MemoryEncryption.decrypt() passes plain strings through unchanged, so
    // pre-existing unencrypted entries remain readable.
    const encryptedResult = MemoryEncryption.encrypt(content);
    const storedContent = typeof encryptedResult === 'string' ? encryptedResult : JSON.stringify(encryptedResult);

    const entry: OwnerMemory = {
      id: genId('om'),
      type: MemoryType.OWNER,
      scope: 'user',
      ownerId: caller.id,
      content: storedContent,
      accessLog: [{
        accessedAt: Date.now(),
        accessedBy: caller.id,
        action: 'write',
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      tags: opts.tags || [],
    };

    await this._ensureInit();
    if (this.postgres.isConnected()) {
      // Uses storedContent (possibly encrypted), not the raw `content` parameter —
      // using the raw parameter here would have written plaintext to Postgres
      // even with MEMORY_ENCRYPTION_KEY configured, defeating the encryption
      // above for any deployment using the Postgres backend.
      await this.postgres.writeLearning({ ...entry, stimulus: storedContent, response: '', feedback: 'owner' });
    }
    await this.firestore.write(entry);
    this.stats.writes++;
    return entry;
  }

  /** Convenience read path for OWNER memory that transparently decrypts —
   *  see MemoryEncryption.ts. Reading Owner memory via the generic query()
   *  method instead returns the raw (possibly still-encrypted) stored string;
   *  use this method when you need the actual plaintext content. */
  async readOwner(id: string, caller: MemoryCaller): Promise<OwnerMemory | null> {
    await this._ensureInit();
    const entry = await this.firestore.read(id, MemoryType.OWNER) as OwnerMemory | null;
    if (!entry) return null;
    const acl = MemoryACL.canRead(entry, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    let parsed: string | ReturnType<typeof MemoryEncryption.encrypt> = entry.content;
    try {
      const maybeJson = JSON.parse(entry.content);
      if (MemoryEncryption.isEncrypted(maybeJson)) parsed = maybeJson;
    } catch {
      // not JSON — was stored as plain string (no key configured at write time)
    }
    return { ...entry, content: MemoryEncryption.decrypt(parsed) };
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. RESTRICTED MEMORY
  // ════════════════════════════════════════════════════════════════════
  async writeRestricted(
    ownerId: string,
    content: string,
    allowedRoles: string[],
    classification: RestrictedMemory['classification'] = 'internal',
    opts: MemoryWriteOptions = {},
    caller: MemoryCaller = SYSTEM_CALLER,
  ): Promise<RestrictedMemory | null> {
    const acl = MemoryACL.canWrite(null, MemoryType.RESTRICTED, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    const entry: RestrictedMemory = {
      id: genId('rm'),
      type: MemoryType.RESTRICTED,
      scope: 'global',
      ownerId,
      content,
      allowedRoles,
      allowedUserIds: [],
      deniedUserIds: [],
      classification,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      tags: opts.tags || [],
    };

    await this._ensureInit();
    await this.firestore.write(entry);
    this.stats.writes++;
    return entry;
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. EPISODIC MEMORY (Conversation history)
  // ════════════════════════════════════════════════════════════════════
  async createEpisode(
    sessionId: string,
    userId: string,
    platform?: string,
    agentId?: string,
  ): Promise<EpisodicMemory> {
    const entry: EpisodicMemory = {
      id: `ep_${sessionId}`,
      type: MemoryType.EPISODIC,
      scope: 'session',
      ownerId: userId,
      sessionId,
      userId,
      agentId,
      platform,
      episode: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      tags: [],
    };

    await this._ensureInit();
    await this.firestore.write(entry);
    await this.redis.cacheEntry(entry.id, entry, 3600); // 1 hour session cache
    return entry;
  }

  async appendToEpisode(
    sessionId: string,
    entries: EpisodeEntry[],
    caller: MemoryCaller = SYSTEM_CALLER,
  ): Promise<boolean> {
    await this._ensureInit();
    const id = `ep_${sessionId}`;

    // Check cache first
    let episode = await this.redis.getCachedEntry(id) as EpisodicMemory | null;
    if (!episode) {
      episode = await this.firestore.read(id, MemoryType.EPISODIC) as EpisodicMemory | null;
    }

    if (!episode) {
      log.warn('Episode not found', { sessionId });
      return false;
    }

    const acl = MemoryACL.canWrite(episode, MemoryType.EPISODIC, caller);
    if (!acl.allowed) { this.stats.denials++; return false; }

    episode.episode.push(...entries);
    episode.updatedAt = Date.now();
    episode.version++;

    await this.firestore.write(episode);
    await this.redis.cacheEntry(id, episode, 3600);
    this.stats.writes++;
    return true;
  }

  async getEpisode(sessionId: string, caller: MemoryCaller): Promise<EpisodicMemory | null> {
    await this._ensureInit();
    const id = `ep_${sessionId}`;

    const cached = await this.redis.getCachedEntry(id);
    if (cached) {
      const acl = MemoryACL.canRead(cached, caller);
      if (!acl.allowed) { this.stats.denials++; return null; }
      this.stats.cacheHits++;
      return cached as EpisodicMemory;
    }

    const episode = await this.firestore.read(id, MemoryType.EPISODIC) as EpisodicMemory | null;
    if (!episode) return null;

    const acl = MemoryACL.canRead(episode, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    await this.redis.cacheEntry(id, episode, 3600);
    this.stats.reads++;
    return episode;
  }

  /** Generate AI summary for an episode */
  async summarizeEpisode(sessionId: string): Promise<string | null> {
    const episode = await this.getEpisode(sessionId, SYSTEM_CALLER);
    if (!episode || episode.episode.length === 0) return null;

    try {
      const { NexusUnifiedCore } = await import('../core/NexusUnifiedCore');
      const transcript = episode.episode
        .map((e: any) => `${e.role}: ${e.content}`)
        .join('\n');

      const result = await NexusUnifiedCore.process(
        `Summarize this conversation in 2-3 sentences:\n${transcript}`,
        { agentRole: 'system', systemInstruction: 'You are a summarization engine. Be concise.' }
      );

      episode.summary = result.text;
      episode.updatedAt = Date.now();
      await this.firestore.write(episode);
      await this.redis.cacheEntry(`ep_${sessionId}`, episode, 3600);
      return result.text;
    } catch (e) {
      log.error('Episode summarization failed', e instanceof Error ? e : undefined);
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. SEMANTIC MEMORY (Vector/embedding search)
  // ════════════════════════════════════════════════════════════════════
  async writeSemanticKnowledge(
    content: string,
    collection: string,
    ownerId: string,
    opts: {
      source?: string;
      sourceUrl?: string;
      tags?: string[];
      documentId?: string;
      chunkIndex?: number;
    } = {},
    caller: MemoryCaller = SYSTEM_CALLER,
  ): Promise<SemanticMemory | null> {
    const acl = MemoryACL.canWrite(null, MemoryType.SEMANTIC, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    // Generate embedding
    let embedding: number[] = [];
    try {
      const { EmbeddingService } = await import('../ai/Embeddings');
      embedding = await EmbeddingService.generateEmbedding(content);
    } catch (e) {
      log.warn('Embedding generation failed — storing without vector', { error: String(e) });
    }

    const entry: SemanticMemory = {
      id: genId('seman'),
      type: MemoryType.SEMANTIC,
      scope: 'global',
      ownerId,
      content,
      embedding,
      embeddingModel: 'text-embedding-3-small',
      dimensions: embedding.length,
      collection,
      source: opts.source,
      sourceUrl: opts.sourceUrl,
      documentId: opts.documentId,
      chunkIndex: opts.chunkIndex,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      tags: opts.tags || [],
    };

    await this._ensureInit();

    // Write to Qdrant (primary) + Firestore (backup)
    if (this.qdrant.isConnected() && embedding.length > 0) {
      await this.qdrant.upsert(entry);
    }
    await this.firestore.write(entry);
    this.stats.writes++;

    EventBus.emitAsync('memory.written', { type: MemoryType.SEMANTIC, id: entry.id, collection }, 'MemoryEngine');
    return entry;
  }

  async semanticSearch(
    query: string,
    opts: {
      collection?: string;
      topK?: number;
      threshold?: number;
      caller?: MemoryCaller;
    } = {},
  ): Promise<Array<{ content: string; score: number; metadata: any }>> {
    await this._ensureInit();
    this.stats.reads++;

    try {
      const { EmbeddingService } = await import('../ai/Embeddings');
      const embedding = await EmbeddingService.generateEmbedding(query);

      if (this.qdrant.isConnected()) {
        const results = await this.qdrant.search(embedding, {
          collection: opts.collection,
          limit: opts.topK || 5,
          threshold: opts.threshold || 0.7,
        });
        return results.map((r: any) => ({ content: r.content, score: r.score, metadata: r.payload }));
      }

      // Fallback: cosine similarity in Firestore (slower but works)
      return await this._cosineFallbackSearch(embedding, opts);
    } catch (e) {
      log.error('Semantic search failed', e instanceof Error ? e : undefined);
      return [];
    }
  }

  private async _cosineFallbackSearch(
    queryEmbedding: number[],
    opts: { collection?: string; topK?: number; threshold?: number },
  ): Promise<Array<{ content: string; score: number; metadata: any }>> {
    try {
      const entries = await this.firestore.query({
        types: [MemoryType.SEMANTIC],
        collection: opts.collection,
        limit: 200,
      });

      const { EmbeddingService } = await import('../ai/Embeddings');

      return entries
        .filter((e: any) => e.embedding?.length > 0)
        .map((e: any) => {
          const cosineSim = EmbeddingService.cosineSimilarity(queryEmbedding, e.embedding);

          // ── Quality-weighted ranking (Part 11 — closes gap from Part 5) ──
          // The quality fields (importance, accessCount, lastAccessed, qualityScore)
          // were added to the MemoryEntry schema in Part 5 but retrieval ranking
          // ignored them, making them decorative. Now we blend them in.
          //
          // Final score formula:
          //   finalScore = 0.70 × cosineSim
          //              + 0.15 × importanceNorm   (0.0–1.0)
          //              + 0.10 × recencyNorm       (0.0–1.0, decays over 30 days)
          //              + 0.05 × accessFreqNorm    (0.0–1.0, capped at 100 accesses)
          //
          // Weights are intentionally conservative — cosine similarity is still
          // dominant because a highly-important-but-irrelevant memory should not
          // outrank a highly-relevant one.

          const importanceNorm = Math.min(1.0, (e.importance ?? 0.5));
          const accessFreqNorm = Math.min(1.0, (e.accessCount ?? 0) / 100);
          const lastAccessed   = e.lastAccessed ? new Date(e.lastAccessed).getTime() : 0;
          const ageMs          = lastAccessed ? Date.now() - lastAccessed : 30 * 86400000;
          const recencyNorm    = Math.max(0, 1 - ageMs / (30 * 86400000)); // full decay over 30 days

          const finalScore = (0.70 * cosineSim)
            + (0.15 * importanceNorm)
            + (0.10 * recencyNorm)
            + (0.05 * accessFreqNorm);

          return {
            content:  e.content,
            score:    finalScore,
            metadata: {
              source:       e.source,
              collection:   e.collection,
              tags:         e.tags,
              importance:   e.importance,
              accessCount:  e.accessCount,
              qualityScore: e.qualityScore,
              _cosineSim:   cosineSim,   // expose raw sim for debugging
            },
          };
        })
        .filter((r: any) => r.score >= (opts.threshold || 0.6))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, opts.topK || 5);
    } catch (_) {
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 8. LEARNING MEMORY (Feedback-driven optimization)
  // ════════════════════════════════════════════════════════════════════
  async recordLearning(
    agentId: string,
    stimulus: string,
    response: string,
    feedback: LearningMemory['feedback'],
    opts: {
      correctedResponse?: string;
      feedbackSource?: LearningMemory['feedbackSource'];
      confidenceShift?: number;
    } = {},
    caller: MemoryCaller = SYSTEM_CALLER,
  ): Promise<LearningMemory | null> {
    const acl = MemoryACL.canWrite(null, MemoryType.LEARNING, caller);
    if (!acl.allowed) { this.stats.denials++; return null; }

    const entry: LearningMemory = {
      id: genId('lm'),
      type: MemoryType.LEARNING,
      scope: 'agent',
      ownerId: agentId,
      agentId,
      stimulus,
      response,
      feedback,
      correctedResponse: opts.correctedResponse,
      feedbackSource: opts.feedbackSource || 'automated',
      confidenceShift: opts.confidenceShift ?? (feedback === 'positive' ? 0.1 : feedback === 'negative' ? -0.1 : 0),
      reinforcementWeight: feedback === 'positive' ? 1.5 : feedback === 'negative' ? 0.5 : 1.0,
      applied: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      tags: [`agent:${agentId}`, `feedback:${feedback}`],
    };

    await this._ensureInit();

    if (this.postgres.isConnected()) {
      await this.postgres.writeLearning(entry);
    }
    await this.firestore.write(entry);

    this.stats.writes++;
    log.debug('Learning recorded', { agentId, feedback, confidenceShift: entry.confidenceShift });
    return entry;
  }

  async getLearningContext(agentId: string, limit = 20): Promise<LearningMemory[]> {
    await this._ensureInit();
    if (this.postgres.isConnected()) {
      return this.postgres.queryLearning(agentId, limit) as any;
    }
    const entries = await this.firestore.query({
      types: [MemoryType.LEARNING],
      agentId,
      limit,
    });
    return entries as LearningMemory[];
  }

  // ════════════════════════════════════════════════════════════════════
  // UNIFIED QUERY ACROSS ALL TYPES
  // ════════════════════════════════════════════════════════════════════
  async query(q: MemoryQuery, caller: MemoryCaller = SYSTEM_CALLER): Promise<MemoryEntry[]> {
    await this._ensureInit();
    const entries = await this.firestore.query(q);
    return entries.filter((entry: any) => MemoryACL.canRead(entry, caller).allowed);
  }

  // ════════════════════════════════════════════════════════════════════
  // DELETE
  // ════════════════════════════════════════════════════════════════════
  async delete(id: string, type: MemoryType, caller: MemoryCaller): Promise<boolean> {
    await this._ensureInit();
    const entry = await this.firestore.read(id, type);
    if (!entry) return false;

    const acl = MemoryACL.canDelete(entry, caller);
    if (!acl.allowed) {
      MemoryACL.logAccessDenied('delete', id, type, caller, acl.reason!);
      this.stats.denials++;
      return false;
    }

    await this.firestore.delete(id, type);
    if (type === MemoryType.SEMANTIC && this.qdrant.isConnected()) {
      await this.qdrant.delete(id);
    }
    await this.redis.del(`mem:${id}`);
    return true;
  }

  // ════════════════════════════════════════════════════════════════════
  // STATS & ADMIN
  // ════════════════════════════════════════════════════════════════════
  getStats(): MemoryStats & { runtimeStats: Record<string, number> } {
    return {
      totalEntries: 0,
      byType: {} as any,
      totalSizeBytes: 0,
      oldestEntry: null,
      newestEntry: null,
      expiredCount: 0,
      runtimeStats: { ...this.stats },
    };
  }

  getAdapterStatus() {
    return {
      firestore: 'active',
      postgres: this.postgres.isConnected() ? 'active' : 'not configured',
      qdrant: this.qdrant.isConnected() ? 'active' : 'not configured',
      redis: this.redis.isConnected() ? 'active (in-process fallback)' : 'disconnected',
    };
  }

  private async _ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

/** Global Memory Engine singleton */
export const MemoryEngine = new NexusMemoryEngineImpl();
