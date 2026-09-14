# ADR-0022: Cross-agent summary-only memory access

Status: Accepted
Date: 2026-07-20

## Context

CTO Audit Part 5, section 16: "Cross Agent Memory... Rule: Read Summary Only. No Full Access." This is the third time this exact gap has been flagged across this audit series — Part 1's `MEMORY_ARCHITECTURE.md` and Part 3's `AI_MULTI_AGENT_ARCHITECTURE.md` both noted it as confirmed-missing without building it. Checked directly: `MemoryACL.canRead()` for `PersonalMemory` is a hard binary — the owning agent gets full access, every other agent gets a hard deny. No middle ground existed.

## Decision

`MemoryACL.canReadCrossAgent()` — a new, **separate** method, not a modification to `canRead()`. Deliberately additive: changing `canRead()`'s existing denials into summary-allows would be a real behavior change for every existing caller; a new method is opt-in for whichever caller wants this specific access pattern. Returns `{ allowed: true, summaryOnly: true }` for entries `canRead()` would otherwise deny (except `OwnerMemory`/`RestrictedMemory`, which remain hard-denied even for summaries — summarizing them would leak their existence/shape). Paired with `MemoryACL.summarize()`: plain truncation, deliberately not an AI-generated summary, which would be a new AI operation with its own cost/latency/hallucination surface — out of scope for what's fundamentally an access-control primitive.

## Consequences

**Easier:** `SupervisorAgent` (or any agent) can now get contextual awareness of what another agent knows without either a hard deny or an inappropriate full-access grant — directly useful for the arbitration/debate flows built in Part 3.

**Harder / cost:** `summarize()`'s truncation is naive (character-length cutoff) — genuinely useful for "is there anything here at all" context, not for nuanced partial disclosure. A caller wanting a smarter summary should generate one explicitly and cache it, not expect this function to do it silently.

## Related finding, same section

While investigating this, found `src/lib/intelligence/KnowledgeGraph.ts` (Part 5, section 9) already exists with real (if minimal) node/edge/traversal logic — contradicting the audit's "Knowledge... Flat" framing. Not rebuilt (would repeat the duplicate-implementation pattern this series has repeatedly flagged) — real limitations found and documented instead: in-memory only (a `Map`, doesn't persist or survive a restart), zero importers anywhere (unused), and single-hop-only traversal (the audit's own Customer→Order→Product→Complaint example needs multi-hop, which isn't implemented). Recommended follow-up: persist via `NexusDB` and extend `inferContext` for multi-hop traversal, extending the existing file rather than starting over.

## Verification

Type-checks cleanly against the real compiler.
