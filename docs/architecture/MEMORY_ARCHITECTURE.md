# Memory Architecture

**Status of this document:** ✅ Describes real, verified code across `src/lib/memory/` (~1,960 lines total). Status of the underlying system: 🟡 Beta — real and structured, but retrieval quality and retention policy under production load are unverified.

## Why this doc exists

"AI-Native Business OS" only means something if the AI actually remembers things correctly, for the right audience, and forgets things it shouldn't keep. That's a security and product question, not just an engineering one — this doc is the reference for both.

## Memory taxonomy (`src/lib/memory/interfaces/MemoryTypes.ts`)

The system defines eight distinct memory kinds, not one generic key-value store:

| Type | Purpose |
|---|---|
| `PersonalMemory` | Tied to one user/customer |
| `SharedMemory` | Visible across a team/tenant |
| `ImmutableMemory` | Write-once, cannot be edited (audit-relevant facts) |
| `OwnerMemory` | Business-owner-only scope |
| `RestrictedMemory` | Access-gated (see ACL below) |
| `EpisodicMemory` | Event/interaction sequences (`EpisodeEntry[]`) |
| `SemanticMemory` | Distilled facts/knowledge, not raw transcripts |
| `LearningMemory` | Feedback loop data — what the system is learning from outcomes |

Each entry also carries a `MemoryScope`: `global | tenant | session | user | agent`. This is a real, thought-through model — most "AI memory" implementations in the wild collapse everything into one flat vector store. This one doesn't.

## Components

| File | Lines | Responsibility |
|---|---|---|
| `brain/MemoryBrain.ts` | 537 | Core read/write/consolidation logic |
| `brain/ConversationMemory.ts` | 265 | Session/conversation-scoped memory |
| `NexusMemoryEngine.ts` | 711 | Top-level orchestration entry point; emits events on `NexusEventBus` |
| `acl/MemoryACL.ts` | 233 | Access control — decides who can read/write which memory type/scope |
| `interfaces/MemoryTypes.ts` | 214 | Type definitions (table above) |

All persistence goes through `NexusDB` (see `DATABASE_SCHEMA.md`) — memory is backend-agnostic by construction, which is correct: swapping the primary database shouldn't require rewriting the memory system.

## Data flow

```
User/Agent interaction
      │
      ▼
NexusMemoryEngine  ──emits──▶  NexusEventBus  ──consumed by──▶  other domains
      │                                                          (orchestration,
      ▼                                                           BI, support)
MemoryACL.check(scope, actor)
      │
   allow / deny
      │
      ▼
MemoryBrain (read/write/consolidate)
      │
      ▼
NexusDB.get/add/update/find  ──▶  active DB_PROVIDER backend
```

## What's genuinely strong here

- The **ACL-first design** means "restricted" and "owner" memory aren't just conventions — they're enforced at a dedicated layer, which is the right place for that check. This matters for the audit's own "AI Governance" concern (docs/governance/AI_GOVERNANCE.md): the biggest single risk in an AI-native OS is an agent reading data it shouldn't and acting on it.
- `ImmutableMemory` as a distinct type gives you a defensible audit trail primitive for free, if it's consistently used for anything a regulator or a customer dispute might later ask about (e.g., "why did the AI refund this order?").

## Open questions this doc surfaces (not yet answered by code inspection alone — flag for Part 2 or a follow-up round)

1. **Retention/expiry policy.** Nothing found in this pass defines TTLs or pruning rules for `EpisodicMemory`. Unbounded episodic growth is a real cost and privacy liability (GDPR/CCPA "right to be forgotten" applies here if any customer data flows into memory).
2. **Cross-tenant leakage testing.** `MemoryACL` exists, but there's no automated test suite anywhere in the repo (see `FEATURE_STATUS.md`) — so ACL correctness currently rests entirely on manual review. For a multi-tenant business OS, this is the single most important thing to add test coverage for before onboarding a second real customer.
3. **Vector/semantic search backing.** `SemanticMemory` implies embedding-based retrieval; `src/lib/core/interfaces/IVectorDB.ts` exists as an interface, but which vector store actually backs it in production wasn't confirmed this round (no vector DB — e.g. Qdrant, pgvector, Pinecone — appears as a dependency in `package.json`). Worth a direct answer before this is marketed as semantic recall rather than keyword/metadata recall.

## Recommendation

Add explicit retention rules per memory type to `MemoryTypes.ts` (even a `ttlDays?: number` field is enough to start), and prioritize ACL test coverage over new memory features — this is the module where a silent bug is a trust/legal problem, not just a bug.
