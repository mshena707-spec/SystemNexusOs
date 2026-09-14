# AI Governance

**Status of this document:** ✅ New, grounded in real mechanisms found across `AGENT_PROTOCOL.md`, `MEMORY_ARCHITECTURE.md`, and `EVENT_BUS.md`. This is the one CTO Audit Part 1 "missing document" that's less about describing existing code and more about stating policy — code alone can't answer "who is accountable when the AI is wrong."

## Why this doc exists

This system has AI agents that can, per `API_SPECIFICATION.md`, act across procurement (13 routes), finance (12), payments (11), pricing (5), and fraud (3) admin surfaces. That is real operational authority. "The AI handles it" is not a governance policy on its own — this doc states the actual rules, grounded in what the code already enforces, plus what it should additionally guarantee before those numbers grow.

## What the code already enforces (real, verified)

1. **A hard authority hierarchy** (`AgentHierarchy.ts`): `OWNER_AI (0) > SECURITY_AI (1) > SYSTEM_AI (2) > CUSTOMER_AI (3) > BACKUP_AI (4)`. A lower-privileged agent cannot override a higher one — this is enforced by a runtime assertion that throws, not just a convention. This is the right foundation for governance: authority limits that live in code, not only in a policy document nobody re-reads.
2. **A memory ACL layer** (`MemoryACL.ts`) that gates who/what can read `OwnerMemory` vs `RestrictedMemory` vs `SharedMemory` — meaning an agent's *knowledge* is scoped, not just its *actions*.
3. **An `agent.approval.required` event type** already exists in `NexusEventBus`'s taxonomy — meaning the system was designed with the concept of "this needs a human" as a first-class case, not an exception to be bolted on.
4. **An immutable audit log** (`ImmutableAuditLog.ts`) — actions taken can be reconstructed after the fact.

## Policy this doc adds (not yet all verified as *actually wired end-to-end* — see gaps below)

### 1. Escalation thresholds
Define, per admin domain, what confidence level or dollar/risk threshold requires `agent.approval.required` to fire rather than the agent acting autonomously. `ConfidenceScorer` (`AGENT_PROTOCOL.md`) already computes a confidence value — the open question is whether every high-stakes action path (issuing a refund, approving a procurement order, changing a price) actually checks it before acting, or only some do. **This is the single most important thing to verify next, not to build from scratch** — the primitives exist.

### 2. Human override is always possible
Per the hierarchy, `OWNER_AI` sits above every automated agent, and (presumably) a human owner sits above `OWNER_AI` itself via the admin UI (`CEOCommandCenter.tsx`, `OwnerAIControlApp.tsx`). State this explicitly: no agent action should be irreversible or unreviewable by a human with owner-level access. Cross-check this against `DISASTER_RECOVERY.md`'s restore/dry-run capability — reversibility of *data* and reversibility of *agent decisions* are related but not the same guarantee, and both should hold.

### 3. Explainability minimum bar
Every autonomous action logged via `ImmutableAuditLog` should carry enough context (which agent, what confidence score, what event triggered it) to answer "why did the system do this" without reading source code. Whether the current log entries meet this bar wasn't independently verified this round — worth a spot-check on a handful of real log entries.

### 4. Domain-specific caution
Fraud detection (`CODFraudDetector`, `FraudDetectionEngine`) and pricing (`DynamicPricingApp` per `SYSTEM_ARCHITECTURE.md`) are the two areas where an autonomous AI mistake most directly costs money or damages customer trust. These deserve the tightest escalation thresholds under policy #1 — recommend a lower confidence bar (more human review, not less) here than in, say, marketing content generation, where a mistake is cheaper to correct.

## Gaps (honest, not yet resolved)

- No automated test verifies the authority hierarchy actually blocks an override attempt (see `FEATURE_STATUS.md` — no test suite exists yet, repo-wide).
- No confirmed, single place where "everything currently awaiting human approval" is visible — `agent.approval.required` events exist, but whether anything subscribes to them and surfaces them in the admin UI wasn't confirmed this round (see the recommended unified alert feed in `EVENT_BUS.md`'s recommendations).
- This document states policy; it does not yet certify the policy is met on every code path. Treat it as the target, verify against it incrementally.

## Recommendation

Before this system is described as "autonomous" in any customer- or investor-facing material, confirm policy #1 and the approval-feed gap above are actually closed. Until then, describe it accurately as "AI-assisted with human-in-the-loop for high-stakes decisions" — which, based on what's actually built here, is both true and still a genuinely strong claim.
