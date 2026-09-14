# Core Architecture

**Status of this document:** ✅ New, answers CTO Audit Part 2 sections 1–6 and 14. Every claim below was checked against real code (grep, reads, and — where noted — the real TypeScript compiler), not accepted from the audit at face value.

## 1. The layer model, and how it's now enforced

The audit's proposed layering (Presentation → Application → Business → AI → Infrastructure → Storage) matches what's actually in the repo. What didn't exist before this round: anything that would *fail* if the boundary were crossed. `.dependency-cruiser.cjs` (new, repo root) now encodes this as a real, runnable check:

```bash
npm run depcruise
```

Rules enforced: `src/lib` may never import `src/components`/`src/pages` (error); the AI layer (`ai`, `agents`, `orchestration`, `memory`, `personal_ai`) specifically may never import UI (error, re-stated beyond the general rule since this boundary was the one called out as unclear); no circular dependencies (error); business-domain folders importing AI-domain internals directly, bypassing `NexusDB`/`NexusEventBus`/`core/interfaces` (warning); no direct DB-driver imports outside `NexusDB.ts` (error). See the config file itself for full comments on each rule's reasoning — this doc won't duplicate them.

**Caveat, stated plainly:** this could not be executed in the sandbox this was written in (no network access to install `dependency-cruiser` or run it against the real graph). Run it after `npm install` and treat the first run as calibration — some `warn`-level rules may need a tuned exception list once real violations surface.

## 2. Modularity — the "God Module" claim, checked precisely

The audit's example ("if a module handles Chat + Memory + Analytics + API + Security together, it will be hard to maintain") was checked directly: every file under `src/lib` was scanned for how many *distinct* top-level domains it imports from. Only one file imports from 5+ distinct domains: **`server.ts` itself** (12 domains) — which is expected and appropriate for a route-registration entry point whose entire job is composing everything together. No other file in the codebase shows this pattern.

**Verdict:** the specific God Module failure mode the audit described doesn't currently exist as a distinct violation. `server.ts`'s size (3,724 lines, `docs/architecture/API_SPECIFICATION.md`) remains the real, already-documented concern — but it's a *size* problem, not a *responsibility-mixing* problem in the sense the audit's example describes.

## 3 & 4. Dependency graph and SOLID — measured, not estimated

### Dependency Inversion (audit gave this 7/10, "more work needed")

Confirmed accurate. `core/interfaces` has exactly 2 interfaces (`IAIProvider`, `IVectorDB`), adopted in 5 files — real but early. Two *other* mechanisms independently achieve the same goal without going through these interfaces: `NexusDB` (`docs/architecture/DATABASE_SCHEMA.md`) for data access, and `NexusEventBus` (`docs/architecture/EVENT_BUS.md`) for cross-domain side effects. Net effect: dependency inversion is happening in practice more than the interface-adoption count alone suggests, just through three uncoordinated mechanisms instead of one. No action taken this round beyond documenting this precisely — consolidating onto one pattern is a larger call than a documentation pass should make unilaterally.

### Liskov Substitution (audit gave this 8/10, wanted a standard `initialize/reason/execute/learn/shutdown` lifecycle)

**More was already in place here than the audit's phrasing suggested.** A real `IAgent` interface already exists (`src/lib/core/registry/AgentRegistry.ts`) with `execute()` required and `ping()`/`shutdown()` optional, plus a genuinely well-designed `AgentInput`/`AgentOutput`/`AgentCapabilities` type system (including `traceId`, `requiresApproval`, `memoryAccess` scoping, and a `confidence` score on every output). **7 of the 8 agent-like classes in this codebase correctly implement it**: `SupervisorAgent` directly, and 6 specialist agents (`PlannerAgent`, `CriticAgent`, `CustomerSupportAgent`, `FraudDetectorAgent`, `OrderProcessorAgent`, `MarketingAgent`) via a shared `abstract class BaseAgent implements IAgent` in `SpecialistAgents.ts` — a clean, correct use of an abstract base class, not ad hoc duplication.

**The one confirmed exception: `CEOAgent`** (`src/lib/orchestration/agents/CEOAgent.ts`). It does not implement `IAgent` — no `execute()`, no `agentId`, not registered with `AgentRegistry`. Reading the actual class confirms why: it's structurally a report-synthesis service (aggregates data, calls `NexusUnifiedCore` once for interpretation, returns a formatted brief) — not an agent that reasons and acts through tools like its six siblings. It's real, working code (used daily via a cron job generating the CEO's morning brief), just not the same *kind* of object as the others despite the shared naming pattern.

**Action taken this round:** extended `IAgent` with two new **optional** methods — `initialize()` and `reason()` and `learn()` — matching the audit's proposed 5-stage lifecycle. Optional, not required, specifically so this is non-breaking: all 7 existing implementers remain valid without any change. **Action not taken:** forcing `CEOAgent` to implement `IAgent`. Given it's actively used in a scheduled job and this pass has no way to run it and confirm behavior is preserved, retrofitting it safely needs either a test around it first or a deliberate, tested change — not a drive-by interface conformance edit. Recommendation: either (a) make it conform properly once it has test coverage, or (b) accept that it's a different kind of object and rename it per `docs/architecture/NAMING_CONVENTIONS.md` (e.g. `CEOBriefingService`) so its class name stops implying a peer relationship with `SupervisorAgent` that doesn't structurally exist.

### Interface Segregation (audit gave this 7.5/10)

`ToolDefinition<TInput, TOutput>` and `AgentCapabilities` were read directly — both are reasonably scoped, not bloated god-interfaces. No specific oversized interface was found to flag beyond what the audit already estimated; treat the 7.5/10 as a fair, unconfirmed-but-unrefuted estimate.

## 5. AI Layer Placement

The audit's proposed internal structure (AI Runtime → Agent Runtime → Tools → Memory → LLM Providers) roughly matches what exists: `orchestration/agents` (agent runtime) → `orchestration/tools` (`ToolRegistry`) → `memory` (`NexusMemoryEngine`) → AI provider adapters (`core/adapters/*`, per `docs/adr/0005-multi-provider-ai-strategy.md`). The boundary the audit called "unclear" is now enforced, not just described — see the `ai-layer-independent-of-ui` rule in `.dependency-cruiser.cjs` (section 1 above).

## 6. Business Layer / AI Layer separation

The audit's principle ("OrderService can use AI, but AI will not know the business rules of OrderService") was checked in the direction that matters most: does any AI-domain file import business-domain internals? **Zero found** (same check as `docs/architecture/DOMAIN_MAP.md`'s dependency-direction audit). The `business-domain-should-not-import-ai-internals-directly` dependency-cruiser rule (section 1) covers the reverse direction as a warning, to keep it that way as the codebase grows — it's a warning rather than an error because zero violations were found, so there's nothing to justify blocking builds over yet.

## 14. Scalability — service boundary target state

The audit's proposed future shape (Gateway → Core → AI → Marketplace → Finance → Notification → Analytics as separately deployable services) is a real, valid target for a system at much higher scale than this one currently is — but extracting services is a large infrastructure project, not something to do as a side effect of a documentation/architecture audit. What's true today, useful for planning that eventually: `docs/architecture/DOMAIN_MAP.md`'s three-domain classification (Business/AI/Infrastructure, 21/10/23 folders) is the natural pre-existing fault line to extract along *if and when* that becomes necessary — the domains already don't import each other's internals directly (confirmed above and in `DOMAIN_MAP.md`), which is exactly the property that makes a future extraction tractable instead of a rewrite. No extraction work was done or attempted this round; this section exists so the option is documented, not assumed away.
