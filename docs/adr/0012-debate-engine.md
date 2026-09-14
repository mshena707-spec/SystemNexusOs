# ADR-0012: Debate Engine

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 3, section 8: confirmed missing (no file/class matching "Debate" or "Reflection" found in either Part 1 or this round's search). Scored 3.0/10 — the audit's own lowest score in Part 3, and it held up under inspection, unlike several other "missing" claims this round (see `docs/architecture/AI_MULTI_AGENT_ARCHITECTURE.md`).

## Decision

`src/lib/orchestration/pipeline/DebateEngine.ts`. Genuine multi-round debate: round 1, each participating agent (via existing `AgentRegistry`/`IAgent`) answers independently; round 2+, each agent is shown every other participant's answer and explicitly prompted to critique and revise or defend with reasoning — not just re-asked the same question. Converges early once all participants are high-confidence and in agreement, bounding cost. Reuses the existing `ArbitrationSystem` (from `SupervisorAgent.ts`, not duplicated) for final synthesis over the last round only.

Deliberately kept distinct from `ArbitrationSystem`: arbitration picks/synthesizes between independently-produced answers; debate makes agents engage with each other's reasoning before a final answer is produced. The audit's own described flow (Agent A → B → C → Debate → Critic → Supervisor) implies exactly this distinction.

## Consequences

**Easier:** high-stakes decisions can now get genuine multi-agent scrutiny instead of either a single agent's answer or independent-then-arbitrated answers that never actually engaged with each other.

**Harder / cost:** debate is strictly more expensive than a single call — up to `rounds × participants` LLM calls, hard-capped at 4 rounds in this implementation. Documented in the file's own header as "use for costly-to-be-wrong decisions, not the default path" — this should not become how every agent request is processed.

## Verification

Type-checks cleanly against the real compiler. Not executed against a live provider — the round-construction and early-convergence logic is verified structurally correct, not verified for output quality against real LLM responses.
