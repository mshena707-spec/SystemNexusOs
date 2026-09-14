# ADR-0020: Memory version history and rollback

Status: Accepted
Date: 2026-07-20

## Context

CTO Audit Part 5, section 6 — scored 4.5/10, the lowest score in this audit part. Confirmed accurate: `version: number` exists on every memory entry but is used purely as an optimistic-concurrency counter (every write sets `version: 1`; only one place in the codebase ever increments it). More fundamentally, no update/revise method existed anywhere in `NexusMemoryEngine` — every `writeX()` method creates a brand-new entry, so there was no existing update path to retrofit.

## Decision

`src/lib/memory/MemoryVersionHistory.ts`: the first update/revise path for memory entries in this codebase. `updateWithHistory()` reads the current entry, archives a **full snapshot** (not a diff) to a separate `memory_versions` collection, then applies changes and increments version. `getHistory()` and `rollback()` complete the flow — rollback itself creates a new version (a forward-moving restoration, not a silent rewrite of history).

Full snapshots over diffs: a rollback that depends on successfully replaying a chain of diffs is a worse failure mode (one broken diff in the chain breaks every rollback past it) than one that reads a single stored snapshot.

## Consequences

**Easier:** a corrupted or incorrectly-learned memory update is now recoverable, closing the exact risk `docs/architecture/AI_MULTI_AGENT_ARCHITECTURE.md` and `docs/adr/0013` (Learning Approval Gate) were built to reduce but couldn't fully close without this.

**Harder / cost:** snapshot storage grows with every update to a high-churn entry — no pruning/archival policy for old versions exists yet. A caught-and-fixed mistake during implementation: an initial collection-name mapping was guessed wrong (`${type}_memory` instead of the real `memory_${type}`) and would have made the entire module silently fail to find any entry — caught by checking the real adapter code, not by the compiler (a string mismatch, not a type error). See `docs/governance/TECHNICAL_DEBT_REGISTER.md`.

**Stated honestly:** this calls `NexusDB` directly, while `NexusMemoryEngine`'s core write methods use their own dedicated adapter instances. For the default Firestore backend these resolve to the same underlying documents, but the two are configured independently — not verified as always in sync outside that default configuration.

## Verification

Type-checks cleanly against the real compiler.
