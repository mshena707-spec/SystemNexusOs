# ADR-0013: Learning Approval Gate

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 3, section 12, states plainly: "AI should not Direct Memory Modify." Checked against real code: `SupervisorAgent._recordDecision` called `MemoryEngine.writeSemanticKnowledge` directly, immediately, fire-and-forget, on every supervised task — exactly the pattern the audit warns against, not a hypothetical risk.

## Decision

`src/lib/memory/LearningApprovalGate.ts`. Confidence-gated, not universally human-gated: writes at or above 0.9 confidence still commit immediately (this path fires on every supervised task — full human review wouldn't scale, and the audit's own §9 already established confidence-based gating as the system's pattern elsewhere). Writes below that threshold are persisted to a pending queue (`NexusDB`, not memory-only — survives a restart) via `submit()`, and require an explicit `approve()` or `reject()` call rather than committing un-reviewed. Every submission also runs through `PromptShield.checkMemoryPoisoning` (ADR-0011) — a poisoned write attempt is rejected outright regardless of confidence.

`SupervisorAgent._recordDecision` was changed to route through this gate instead of writing directly — the confirmed real instance, not left as a hypothetical example.

## Consequences

**Easier:** memory writes originating from AI decisions now have a real, inspectable trail for anything below high confidence, and a concrete mechanism to prevent low-confidence or malicious content from silently becoming "learned" knowledge other agents later read as fact.

**Harder / cost:** a pending queue exists but nothing yet automatically surfaces it to a human reviewer (no admin UI, no scheduled digest) — `listPending()` exists for this to be built on top of, but wasn't built this round. Until that exists, low-confidence learning is effectively paused (queued, never auto-approved) rather than reviewed — worth knowing before assuming the pipeline is fully closed.

## Follow-up

Add an admin route/dashboard surfacing `LearningApprovalGate.listPending()`, and confirm whether the queue should have a max age (a submission pending review for 6 months is arguably as much a smell as writing unreviewed).

## Verification

Type-checks cleanly against the real compiler, including the change to `SupervisorAgent._recordDecision`'s call site and the now-unused `MemoryEngine` import removed from that file as a result.
