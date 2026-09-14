# ADR-0010: Standard agent lifecycle (extend IAgent, don't replace it)

Status: Accepted
Date: 2026-07-18

## Context

CTO Audit Part 2, section 4 (Liskov Substitution): "Agent interface should be more standard. All agents should follow the same lifecycle: `initialize() reason() execute() learn() shutdown()`." Investigation found this was more done than the audit's phrasing implied: a real `IAgent` interface already existed (`src/lib/core/registry/AgentRegistry.ts`) with `execute()` required, `ping()`/`shutdown()` optional, and 7 of 8 agent classes already implementing it correctly (`SupervisorAgent` directly; 6 specialists via a shared `BaseAgent` abstract class). The one confirmed exception, `CEOAgent`, doesn't implement `IAgent` at all — and reading its actual implementation shows why: it's structurally a report-synthesis service, not a reasoning/tool-using agent like its siblings.

## Decision

Extend the existing `IAgent` interface with `initialize()` and `reason()` and `learn()` as **optional** methods, rather than defining a new, competing interface. All three are additive: existing implementers remain valid with zero changes. `reason()` is typed to return `{ plan: string; confidence: number }`, deliberately separate from `execute()`, so an agent can expose "what I'm about to do and how confident I am" before committing to a side effect — the natural hook point for the `agent.approval.required` human-in-the-loop flow (`docs/governance/AI_GOVERNANCE.md`).

`CEOAgent` was deliberately **not** retrofitted to implement `IAgent` as part of this change. It's used in a live scheduled job (`cron.schedule('0 6 * * *', ...)` generating the CEO's daily brief); forcing interface conformance on actively-used code with no test coverage to confirm behavior is preserved is a different, riskier kind of change than adding optional methods to an interface nothing is forced to implement.

## Consequences

**Easier:** the audit's full 5-stage lifecycle is now expressible without a breaking change or a parallel interface; future agents (including plugin-based ones, ADR-0008) have `initialize`/`learn` hooks available from day one.

**Harder / cost:** `initialize`/`reason`/`learn` being optional means nothing enforces that a *new* agent actually implements them beyond code review discipline (`CONTRIBUTING.md`'s Review Rules) — consider promoting them to required once enough real agents have meaningful implementations that a no-op default would be obviously wrong, rather than before.

## Follow-up

`CEOAgent` remains a named, open item: either give it real test coverage and then make it conform to `IAgent` properly, or accept it's a different kind of object and rename it per `docs/architecture/NAMING_CONVENTIONS.md` (e.g. `CEOBriefingService`) so its name stops implying a peer relationship with `SupervisorAgent` it doesn't structurally have. Not resolved by this ADR — flagged for a deliberate decision.

## Verification

The interface extension and the `BaseAgent` export change it depends on (`SpecialistAgents.ts`) both type-check cleanly against the real TypeScript compiler, including confirming all 6 existing `BaseAgent` subclasses remain valid under the extended interface.
