# ADR-0008: Plugin architecture

Status: Accepted
Date: 2026-07-18

## Context

CTO Audit Part 2, section 9: "According to your vision, new AI Agents will be added in the future. So, Plugin System should be created from now on... new agents can be added without changing the core code." Confirmed by direct search: no file or folder with "plugin" in the name existed anywhere in the repository. New agents were being added by editing `SpecialistAgents.ts` directly (see the 6 existing specialist agents, `docs/architecture/AGENT_PROTOCOL.md`) — which works, but means every new agent is a core-file edit, exactly what this section asked to avoid.

## Decision

Introduce `src/plugins/PluginRegistry.ts`: a `NexusPlugin` bundles one or more `IAgent` implementations (registered with the existing `AgentRegistry`) and any tools they need (registered with the existing `ToolRegistry`), optionally gated behind a `FeatureFlags` entry (ADR-0007), as a single loadable/unloadable unit. This does **not** replace or ask for migration of the 6 existing specialist agents in `SpecialistAgents.ts` — those are fine where they are. This is the path for the *next* new agent.

`BaseAgent` (`SpecialistAgents.ts`) was changed from file-private to exported, so plugin authors extend the same base class — with its `ConfidenceScorer` wiring built in — rather than duplicating that logic per plugin.

A real, working example ships with this decision: `src/plugins/loyalty-advisor/` — a genuinely new capability (none of the 6 existing specialist agents cover personalized loyalty-perk suggestions), not a wrapper around something that already existed, so it proves net-new extensibility rather than just re-packaging. It queries the real `LoyaltyEngine`, is gated behind `ENABLE_LOYALTY_ADVISOR` (off by default), and is loaded at boot via `loadStandardPlugins()` in `server.ts`.

## Consequences

**Easier:** the next new agent (marketing-adjacent, finance-adjacent, inventory-adjacent — matching the audit's own example folder names) is a new folder under `src/plugins/`, not an edit to `SpecialistAgents.ts` or `AgentRegistry.ts`.

**Harder / cost:** two patterns for defining an agent now coexist (the 6 in `SpecialistAgents.ts`, and anything under `src/plugins/`) — both are valid, but a new contributor needs `CONTRIBUTING.md`'s AI Agent Rules (or this ADR) to know which to reach for. Recommendation stated there: prefer `src/plugins/` for anything genuinely new; `SpecialistAgents.ts` remains the home for the original 6 unless there's a specific reason to move one.

## Verification

`PluginRegistry.ts` and `src/plugins/loyalty-advisor/index.ts` both type-check cleanly against the real TypeScript compiler. One genuine bug was caught and fixed in the process: the example plugin initially referenced `LoyaltyBalance.points`, but the real field (checked directly against `LoyaltyEngine.ts`) is `currentPoints`.
