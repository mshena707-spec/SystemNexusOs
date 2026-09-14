# Agent Protocol

**Status of this document:** ✅ Describes real, verified code (~1,600 lines across `src/lib/agents/`, `src/lib/orchestration/`, `src/lib/core/registry/AgentRegistry.ts`). Status of the underlying system: 🟡 Beta.

## Why this doc exists

CTO Audit Part 1 asked, as a worked example, that every AI module state its status like this:

> Supervisor AI — Status: Prototype. Current: Basic orchestration. Missing: Debate Engine, Confidence Ranking, Reflection.

That example is now out of date in one respect (Confidence Ranking exists — see below) and this doc replaces guessing with a real inventory.

## Chain of command (`src/lib/agents/AgentHierarchy.ts`)

A real, enforced 5-level authority system:

```
Level 0 — OWNER_AI      (highest authority)
Level 1 — SECURITY_AI
Level 2 — SYSTEM_AI
Level 3 — CUSTOMER_AI
Level 4 — BACKUP_AI      (lowest authority)
```

Rule: a **lower number can override a higher number**, never the reverse. Enforced at runtime — `AgentHierarchy.assertAuthority()` throws if a lower-privileged agent attempts to override a higher one. This is a small file (23 lines) but it does one job correctly and simply, which is the right shape for a security-relevant primitive. It's the kind of code you want to be boring.

## Orchestration layer (`src/lib/orchestration/`)

| Component | Lines | Status | Notes |
|---|---|---|---|
| `agents/CEOAgent.ts` | 244 | 🟡 Beta | Top-level decision agent |
| `agents/SupervisorAgent.ts` | 302 | 🟡 Beta | Mid-level coordination; wired to `NexusEventBus` |
| `agents/SpecialistAgents.ts` | 393 | 🟡 Beta | Domain-specific agents; wired to `NexusEventBus` |
| `pipeline/ConfidenceAndDecomposer.ts` | 229 | 🟡 Beta | Contains **`ConfidenceScorer`** and **`TaskDecomposer`** — real classes, real logic |
| `tools/ToolRegistry.ts` | 345 | 🟡 Beta | Typed tool definitions (`ToolDefinition<TInput,TOutput>`), registry pattern, built-in tool registration |
| `core/registry/AgentRegistry.ts` | 297 | 🟡 Beta | System-wide agent registration, wired to `NexusEventBus` |

**Correction to CTO Audit Part 1's example:** *Confidence Ranking is implemented* (`ConfidenceScorer` class, `ConfidenceAndDecomposer.ts`). Whether every agent decision actually routes through it before acting hasn't been independently traced end-to-end — that's the next thing to verify, not whether the class exists.

**Confirmed genuinely missing:** no file, class, or folder matching "Debate Engine" (multi-agent adversarial deliberation before a decision) or "Reflection" (post-hoc self-critique loop) was found anywhere in the repo. If these are still product goals, they should be scaffolded as named, empty modules with a ⚪ Planned tag — that's more useful than leaving them implied only in prose docs, because it gives the next engineer (or AI agent) a concrete place to start instead of a green field.

## How a request should flow (as designed)

```
Incoming request/event
        │
        ▼
AgentRegistry — is there a registered agent for this?
        │
        ▼
AgentHierarchy.assertAuthority() — is this agent allowed to act here?
        │
        ▼
SupervisorAgent — routes to a SpecialistAgent, or escalates to CEOAgent
        │
        ▼
TaskDecomposer — breaks the request into subtasks (if needed)
        │
        ▼
ConfidenceScorer — scores the proposed action/response
        │
        ▼
ToolRegistry — executes any tool calls the agent needs
        │
        ▼
NexusEventBus.emit(...) — result broadcast to interested modules
```

This is a reasonable, standard multi-agent shape. The gap isn't the design — it's that nothing currently *proves* this flow is followed on every path, because there's no test suite (see `FEATURE_STATUS.md`). A single integration test that fires a mock request through `AgentRegistry → SupervisorAgent → ConfidenceScorer → NexusEventBus` and asserts the event fired would do more for confidence in this system than any new feature would.

## Recommendation

1. Add the missing Debate Engine / Reflection modules as explicitly ⚪ Planned stubs with a one-paragraph spec each, so the *next* audit (or the next contributor) doesn't have to re-derive whether they exist.
2. Write one integration test covering the flow above. This is the highest-leverage single test in the codebase — it touches five modules at once.
3. Confirm, by tracing one real request, that `ConfidenceScorer` output actually gates agent behavior (e.g., low confidence → escalate to `CEOAgent` or a human) rather than being computed and logged but not acted on. This is a common half-implemented pattern and worth ruling out explicitly.
