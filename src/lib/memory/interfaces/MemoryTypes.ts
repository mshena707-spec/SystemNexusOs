/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           NEXUS MEMORY ENGINE — TYPE SYSTEM                  ║
 * ║  Phase 2: Production-grade multi-type memory architecture    ║
 * ║                                                              ║
 * ║  8 Memory Types:                                             ║
 * ║   1. Personal    — Agent-specific, not shared                ║
 * ║   2. Shared      — Multi-agent readable                      ║
 * ║   3. Immutable   — Write-once, append-only                   ║
 * ║   4. Owner       — Visible only to system owner              ║
 * ║   5. Restricted  — Role-based access control                 ║
 * ║   6. Episodic    — Conversation & event history              ║
 * ║   7. Semantic    — Embedding/vector memory                   ║
 * ║   8. Learning    — Feedback-driven optimization              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ── Memory Type Enum ──────────────────────────────────────────────────────
export enum MemoryType {
  PERSONAL   = 'personal',
  SHARED     = 'shared',
  IMMUTABLE  = 'immutable',
  OWNER      = 'owner',
  RESTRICTED = 'restricted',
  EPISODIC   = 'episodic',
  SEMANTIC   = 'semantic',
  LEARNING   = 'learning',
}

// ── Memory Scopes ─────────────────────────────────────────────────────────
export type MemoryScope = 'global' | 'tenant' | 'session' | 'user' | 'agent';

// ── Base memory entry (all types extend this) ─────────────────────────────
export interface BaseMemoryEntry {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  ownerId: string;           // userId or agentId who created this
  tenantId?: string;         // Multi-tenancy support
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;        // null = permanent
  version: number;           // Optimistic concurrency
  tags: string[];            // For filtering and search
  metadata?: Record<string, any>;
  /**
   * Added per CTO Audit Part 5, section 7 (Memory Quality Score). Completes
   * the set alongside pre-existing `accessCount` (on PersonalMemory — Usage
   * Count) and `confidence` (on LearningMemory) — those were real and
   * type-specific; `importance` was the confirmed gap, added here on the
   * base type since relative importance is meaningful for every memory kind,
   * not just learned knowledge. 0-1 scale, matching `confidence`'s existing
   * convention. Optional — unset should be read as "not yet scored", not "0".
   * NOT YET WIRED into retrieval ranking (query()'s actual sort logic) — see
   * docs/architecture/MEMORY_KNOWLEDGE_SYSTEM.md for why that's a separate,
   * not-yet-done follow-up rather than bundled into this field addition.
   */
  importance?: number;
}

// ── 1. PERSONAL MEMORY — Agent-specific, not shared ──────────────────────
export interface PersonalMemory extends BaseMemoryEntry {
  type: MemoryType.PERSONAL;
  agentId: string;           // Which agent owns this
  content: string;
  embedding?: number[];      // Cached embedding for fast retrieval
  accessCount: number;
  lastAccessedAt: number;
}

// ── 2. SHARED MEMORY — Multiple agents can read ───────────────────────────
export interface SharedMemory extends BaseMemoryEntry {
  type: MemoryType.SHARED;
  content: string;
  readBy: string[];          // Agent IDs that have read this
  writePolicy: 'single_writer' | 'multi_writer' | 'owner_only';
  lockHolder?: string;       // For write locking
  lockedAt?: number;
  embedding?: number[];
}

// ── 3. IMMUTABLE MEMORY — Write-once, append-only (audit trail) ───────────
export interface ImmutableMemory extends BaseMemoryEntry {
  type: MemoryType.IMMUTABLE;
  content: string;
  hash: string;              // SHA-256 of content for integrity verification
  /** Added per CTO Audit Part 5, section 19 ("Digital Signature"). Distinct
   *  from `hash`: a hash proves content hasn't changed since it was computed,
   *  but anyone can compute a correct hash for altered content — it doesn't
   *  prove WHO created the entry. This is an HMAC-SHA256 over the content,
   *  keyed by a secret only legitimate writers have access to (via
   *  SecretVault, Part 4) — verifiable, and not forgeable without the key.
   *  Optional so pre-existing entries (written before this field existed)
   *  remain valid; verify() treats a missing signature as "not signed",
   *  distinct from "signature verification failed". */
  signature?: string;
  signedBy: string;          // Agent or user who created it
  witnessIds: string[];      // Other agents who acknowledged this record
  chainPrev?: string;        // Previous immutable record ID (blockchain-like)
}

// ── 4. OWNER MEMORY — System owner eyes only ─────────────────────────────
export interface OwnerMemory extends BaseMemoryEntry {
  type: MemoryType.OWNER;
  content: string;           // Encrypted at rest in production
  encryptionKeyId?: string;
  accessLog: Array<{
    accessedAt: number;
    accessedBy: string;
    action: 'read' | 'write';
    ipAddress?: string;
  }>;
}

// ── 5. RESTRICTED MEMORY — Role-based access ─────────────────────────────
export interface RestrictedMemory extends BaseMemoryEntry {
  type: MemoryType.RESTRICTED;
  content: string;
  allowedRoles: string[];    // e.g. ['admin', 'ceo', 'analyst']
  allowedUserIds: string[];
  deniedUserIds: string[];
  classification: 'confidential' | 'internal' | 'public';
  embedding?: number[];
}

// ── 6. EPISODIC MEMORY — Conversation & event timeline ───────────────────
export interface EpisodicMemory extends BaseMemoryEntry {
  type: MemoryType.EPISODIC;
  sessionId: string;
  userId: string;
  agentId?: string;
  episode: EpisodeEntry[];
  summary?: string;          // AI-generated summary of episode
  summaryEmbedding?: number[];
  sentiment?: number;        // -1 to 1
  outcome?: 'resolved' | 'unresolved' | 'escalated' | 'abandoned';
  platform?: string;         // whatsapp, web, telegram, etc.
}

export interface EpisodeEntry {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  tokensUsed?: number;
  modelUsed?: string;
  confidence?: number;
  toolCalls?: Array<{ tool: string; input: any; output: any }>;
}

// ── 7. SEMANTIC MEMORY — Embedding-based knowledge ───────────────────────
export interface SemanticMemory extends BaseMemoryEntry {
  type: MemoryType.SEMANTIC;
  content: string;           // Original text
  embedding: number[];       // Vector representation (768 or 1536 dims)
  embeddingModel: string;    // e.g. 'text-embedding-3-small'
  dimensions: number;
  score?: number;            // Relevance score when retrieved
  source?: string;           // Where this knowledge came from
  sourceUrl?: string;
  chunkIndex?: number;       // If chunked from a larger document
  documentId?: string;       // Parent document ID
  collection: string;        // Logical grouping (e.g. 'product_kb', 'faq')
}

// ── 8. LEARNING MEMORY — Feedback-driven optimization ────────────────────
export interface LearningMemory extends BaseMemoryEntry {
  type: MemoryType.LEARNING;
  stimulus: string;          // Input that triggered learning
  response: string;          // What was output
  feedback: 'positive' | 'negative' | 'neutral' | 'correction';
  correctedResponse?: string; // If feedback was a correction
  feedbackSource: 'user' | 'automated' | 'owner' | 'critic_agent';
  confidenceShift: number;   // How much this changed the model's confidence
  reinforcementWeight: number; // How much to weight this in future decisions
  agentId?: string;
  applied: boolean;          // Has this been used to update behavior?
  appliedAt?: number;
}

// ── Unified memory entry union ────────────────────────────────────────────
export type MemoryEntry =
  | PersonalMemory
  | SharedMemory
  | ImmutableMemory
  | OwnerMemory
  | RestrictedMemory
  | EpisodicMemory
  | SemanticMemory
  | LearningMemory;

// ── Memory query interface ────────────────────────────────────────────────
export interface MemoryQuery {
  types?: MemoryType[];
  ownerId?: string;
  agentId?: string;
  userId?: string;
  sessionId?: string;
  tags?: string[];
  collection?: string;
  since?: number;            // Timestamp
  until?: number;
  limit?: number;
  includeExpired?: boolean;
  textSearch?: string;
  // Vector search (Phase 2 Qdrant)
  embedding?: number[];
  similarityThreshold?: number;
  topK?: number;
}

// ── Memory write options ──────────────────────────────────────────────────
export interface MemoryWriteOptions {
  ttlSeconds?: number;       // Time to live (null = permanent)
  tags?: string[];
  metadata?: Record<string, any>;
  merge?: boolean;           // Merge with existing if same ID
  encrypt?: boolean;         // Encrypt content (for OWNER type)
  generateEmbedding?: boolean; // Auto-generate vector embedding
}

// ── Memory ACL check result ───────────────────────────────────────────────
export interface MemoryACLResult {
  allowed: boolean;
  reason?: string;
  requiredRole?: string;
  /** Added per CTO Audit Part 5, section 16: "Cross Agent Memory... Read
   *  Summary Only... No Full Access." When true, the caller is allowed to
   *  read this entry but should receive a truncated/summarized view, not
   *  the full content — see MemoryACL.canReadCrossAgent(). */
  summaryOnly?: boolean;
}

// ── Memory statistics ─────────────────────────────────────────────────────
export interface MemoryStats {
  totalEntries: number;
  byType: Record<MemoryType, number>;
  totalSizeBytes: number;
  oldestEntry: number | null;
  newestEntry: number | null;
  expiredCount: number;
  vectorIndexSize?: number;
}
