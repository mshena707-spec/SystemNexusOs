# Memory & Knowledge System

**Status of this document:** ✅ Answers CTO Audit Part 5 in full — the audit's own highest-priority part ("the power of your system will be memory"). Same standard as Parts 1-4: every claim checked against real code.

## The headline finding

**This audit's characterization of "current" memory architecture doesn't match the real implementation — by a wide margin.** Section 2 describes today's system as "Cache → Temporary Memory → Shared Objects → Database" and section 3 says "there is no separation" of memory levels. The real `MemoryTypes.ts` already defines **8 distinct memory types** (Personal, Shared, Immutable, Owner, Restricted, Episodic, Semantic, Learning) with real ACL enforcement (`MemoryACL.ts`), a 4-backend adapter system (Firestore/Postgres/Qdrant/Redis, all genuinely wired in `NexusMemoryEngine.ts`), hash-based integrity checking, and — from this series' own earlier rounds — a confidence-gated learning approval queue and a TTL-based cleanup sweep. This is much closer to the audit's own "Future Structure" than its "Current Structure" description.

This doesn't mean the audit's specific critical findings are wrong — several are precisely correct (version history, digital signatures, quality scoring were genuinely thin or absent) — but the framing of the *starting point* needs correcting before the rest of this document makes sense.

## §1 Memory Philosophy — no correction needed

Agreed, and consistent with `docs/governance/AI_GOVERNANCE.md`'s existing framing.

## §2 & §3 Memory Architecture / Types — mostly already real

| Audit's proposed type | Reality |
|---|---|
| Working Memory (auto-clear) | Not a distinct named type — closest existing analog is session-scoped context, not confirmed as a formal "Working" tier |
| Session Memory | Same — not a formally distinct type from Personal |
| Personal Memory | ✅ Real (`PersonalMemory`) |
| Shared Memory | ✅ Real (`SharedMemory`) |
| Owner Memory | ✅ Real (`OwnerMemory`), encrypted at rest since Part 4 |
| Security Memory | Closest existing analog is `RestrictedMemory` (role/allowlist-gated) — not confirmed as Security-AI-specific |
| Business Memory | Not a distinct type — business data mostly lives in `NexusDB` collections (orders, products), not the memory system |
| Learning Memory | ✅ Real (`LearningMemory`), gated by `LearningApprovalGate` (Part 3) |
| Immutable Memory | ✅ Real (`ImmutableMemory`), hash-verified, now signature-verified (§19 below) |
| Archive Memory | Not a distinct type — `memory_cleanup` (Part 2) deletes expired entries rather than archiving them |

**Net:** 4 of 10 named types are exact matches, 2 more have a close existing analog under a different name, 4 (Working, Session, Business, Archive as formal tiers) are genuinely not distinct types today. Not built this round — introducing 4 new formal memory types is a schema-level decision with real migration implications, appropriately a dedicated round rather than bundled into this one.

## §4 Memory Ownership / Metadata — mostly already real

The audit's requested metadata list — Memory ID, Owner, Created By, Created Time, Permission, Version, Confidence, Importance, Source — checked field by field against `BaseMemoryEntry`: `id` ✅, `ownerId` ✅ (doubles as Created By), `createdAt` ✅, `version` ✅ (see §6 for the real gap — it's a counter, not history), `tags`/`scope`/`tenantId` ✅ (the closest existing analog to "Permission" at the base-entry level; full permission logic lives in `MemoryACL`, not on the entry itself). **Confirmed gap, closed this round:** `importance` — added to `BaseMemoryEntry` (optional, 0-1 scale, matching `confidence`'s existing convention on `LearningMemory`). `source` already exists as an option on `writeSemanticKnowledge`'s write path specifically, not as a base-entry field.

## §5 Memory Permission / ACL — already real

`MemoryACL.canRead`/`canWrite`/`canDelete` (233 lines) already implement per-type policy close to the audit's own worked example: `OwnerMemory` requires `caller.isOwner`, `RestrictedMemory` checks explicit allow/deny lists and roles, `PersonalMemory` restricts to the owning agent. No correction needed to the substance; the audit's implied "6.0/10, needs a Permission Matrix" undersells what exists. Real, narrower gap: cross-agent visibility was previously all-or-nothing (full read or hard deny) — addressed in §16 below.

## §6 Memory Versioning — confirmed accurate, the audit's own lowest score, built this round

Verified precisely: `version: number` exists on every entry but is purely an optimistic-concurrency counter — every write sets `version: 1`, and only one place in the entire file increments it. No prior version is ever kept, and — more fundamentally — **there was no update/revise method anywhere in `NexusMemoryEngine` to intercept in the first place**; every `writeX()` method creates a new entry.

**Built:** `src/lib/memory/MemoryVersionHistory.ts` — the first update/revise path for memory entries in this codebase, not a retrofit. `updateWithHistory()` archives a full snapshot to a separate `memory_versions` collection before applying changes; `getHistory()` and `rollback()` complete the audit's requested flow. Full-snapshot storage, not diffs — deliberate: a rollback that depends on successfully replaying a chain of diffs is a worse failure mode than one that reads a single stored snapshot.

## §7 Memory Quality — partially built

`accessCount` (Usage Count) already existed on `PersonalMemory`; `confidence` already existed on `LearningMemory`. **Built this round:** `importance` added to the base type (§4). **Not built:** wiring these into actual retrieval ranking — `query()`'s real sort behavior was checked and does not currently weight by confidence/importance/freshness/usage together. Adding the fields without also rushing the ranking logic was a deliberate scope boundary — ranking changes affect what every existing caller of `query()` gets back, a behavioral change substantial enough to deserve its own dedicated verification, not a same-round bundle with a schema addition.

## §8 Semantic Memory — corrects this series' own earlier finding

**Part 1's `MEMORY_ARCHITECTURE.md` said:** "no vector DB... appears as a dependency in `package.json`," flagged as an open question. **Correction:** Qdrant integration is real — `NexusMemoryEngine.ts` has a fully wired `QdrantMemoryAdapter` with `connect()`/`upsert()`/`search()`/`delete()`. It doesn't appear in `package.json` because it's REST-API-based (`NexusConfig.storage.qdrantUrl` + `apiKey`, plain `fetch` calls), not an installed client SDK — a valid, if easy-to-miss-via-`package.json`-scanning, integration approach. This series' own Part 1 finding was incomplete, not just the audit's — corrected here rather than left standing.

## §9 Knowledge Graph — real but unused skeleton, not "flat"

`src/lib/intelligence/KnowledgeGraph.ts` exists (confirmed by direct read, not just a name match): `addNode`/`linkNodes`/`inferContext` with real (if minimal) logic. **Confirmed real limitations:** in-memory only (a `Map`, not persisted — doesn't survive a restart, doesn't share state across instances, the same class of gap `FeatureFlagManager.ts` had before Part 2's fix), zero importers anywhere else in the codebase (unused), and `inferContext` only returns direct edges — no multi-hop traversal, so the audit's own worked example (Customer → Order → Product → Complaint, a 3-hop chain) isn't actually retrievable from it as written. Not rebuilt from scratch this round (that would repeat the exact duplicate-implementation pattern this series has repeatedly flagged as a codebase anti-pattern) — flagged as the right foundation to extend, specifically not a green field. See `docs/adr/0022` for the recommended, not-yet-done extension path (NexusDB persistence + multi-hop traversal).

## §10 Memory Retrieval Ranking — confirmed real gap, not built

Checked directly: `query()`'s actual sort behavior does not weight by importance/freshness/confidence/semantic-similarity together as the audit's proposed order describes. Vector search (`Qdrant`) provides similarity ranking for that specific path; the generic `query()` method does not layer the other signals on top. Not built this round — see §7's reasoning for why ranking changes were scoped out of this pass.

## §11 Memory Compression — not independently verified this round

`personal_ai/UltraCompressor.ts` exists (referenced by the `ENABLE_ULTRA_COMPRESSION` feature flag added in Part 2) — not re-read in depth this round given time spent on higher-priority items. Flagged as "likely real, not verified this pass" rather than assumed either way.

## §12 & §18 Learning Pipeline / AI Learning Governance — already built (Part 3)

`LearningApprovalGate` (Part 3, extended in Part 4 with `learningPermission` enforcement) already implements the audit's proposed flow closely: confidence-checked, queued-or-committed, explicit approval for anything below threshold. No new work needed — see `docs/adr/0013`.

## §13 Memory Poisoning Protection — already built (Part 3/4)

`PromptShield.checkMemoryPoisoning()` (Part 3) runs on every `LearningApprovalGate` submission. No new work needed.

## §14 Memory Expiration — partially real, tiering not built

`memory_cleanup` (Part 2) sweeps entries past `expiresAt`/`ttlSeconds` — a single, uniform mechanism, not the audit's proposed tiered policy (7 days / 30 days / 5 years / never by type). The underlying field already supports arbitrary per-entry expiration; a tiering *policy* (which types get which default TTL) is a product decision as much as an engineering one — not built this round pending that decision.

## §15 Backup Memory — already documented (Part 1)

`docs/architecture/DISASTER_RECOVERY.md` already covers real backup/restore routes and already flags the exact gap the audit names (no defined RPO/RTO tiers). Nothing new this round.

## §16 Cross-Agent Memory (summary-only) — confirmed gap across 3 rounds, built this round

Flagged as missing in Part 1's `MEMORY_ARCHITECTURE.md`, again in Part 3's `AI_MULTI_AGENT_ARCHITECTURE.md`, and now explicitly named here. **Built:** `MemoryACL.canReadCrossAgent()` — a new, separate method (not a modification to `canRead()`, to avoid changing existing callers' behavior) that allows an agent to see another agent's otherwise-private memory in summary form rather than a hard deny. Paired with `MemoryACL.summarize()` — deliberately simple truncation, not an AI-generated summary (which would be a new AI operation with its own cost/latency/hallucination surface, out of scope for an access-control primitive).

## §17 Memory Synchronization — not independently verified this round

The audit's proposed conflict resolution ("Supervisor will make the decision") maps naturally onto the existing `ArbitrationSystem` (`SupervisorAgent.ts`, documented in Part 3) — plausible this already has a real path, not confirmed by direct trace this round given time constraints.

## §19 Knowledge Integrity — hash confirmed real, signature confirmed missing, built this round

`hashContent()` (SHA-256) and a `verifyImmutable()` check already existed, plus a `chainPrev` field (blockchain-style hash chaining) and `witnessIds` — genuinely more sophisticated than "not implemented." **Confirmed real gap:** `signedBy` was a plain string field recording claimed authorship, not a verifiable cryptographic signature — a hash proves content wasn't altered *after* being hashed, but doesn't prove who created it (anyone can compute a correct hash for altered content). **Built:** real HMAC-SHA256 signing (`ImmutableMemory.signature`, keyed via `SecretVault` from Part 4), with constant-time verification (`crypto.timingSafeEqual`, avoiding a timing-attack surface a plain `===` would have). Additive — pre-existing unsigned entries remain valid; `verifyImmutableSignature()` treats a missing signature as "not signed," distinct from "signature invalid."

## §20 Future Memory Architecture — mostly already the present

Redis ✅ (`RedisMemoryAdapter`, real), Postgres ✅ (`PostgreSQLMemoryAdapter`, real), Qdrant ✅ (§8, real), Object Storage — not independently verified this round. Neo4j / formal Knowledge Graph is the one piece genuinely not present as proposed — see §9.
