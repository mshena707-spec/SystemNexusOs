# ADR-0014: Agent Profile extension (allowedAPIs, allowedAgents, confidenceThreshold, escalationRules)

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 3, section 4, asks for a unified per-agent profile covering Hierarchy + Role + Permission + Memory + Tool + API, enforced together. Role, Allowed Memory, Allowed Tools, and Priority already existed on `AgentCapabilities` (`AgentRegistry.ts`); Hierarchy is enforced separately by `AgentHierarchy` (Part 2). Allowed APIs, Allowed Agents, Confidence Threshold, and Escalation Rules were the confirmed gap.

## Decision

Added all four as **optional** fields on `AgentCapabilities` — additive, non-breaking, matching the pattern used for the Part 2 `IAgent` lifecycle extension. Populated with real values on two agents as worked examples rather than left as an unused schema: `SupervisorAgent` (`confidenceThreshold: 0.5`, formalizing a value already hardcoded in its retry logic) and `FraudDetectorAgent` (`confidenceThreshold: 0.75`, tighter per `docs/governance/AI_GOVERNANCE.md`'s recommendation for high-stakes domains).

`allowedAgents` deliberately left unset on `SupervisorAgent` — its job is routing to whichever agent a task needs, so an allowlist there would work against its core function. Documented as a conscious choice in the code, not an oversight.

## Consequences

**Easier:** confidence thresholds and escalation intent are now declared, inspectable properties of an agent instead of magic numbers scattered at call sites.

**Harder / cost:** `escalationRules` are currently declarative metadata only — `SupervisorAgent`'s code doesn't yet act on `escalateTo: 'human'` by notifying anyone; it returns a fallback response. This ADR documents the schema and the honest gap between declaring an escalation rule and enforcing it, rather than implying enforcement that doesn't exist yet.

## Verification

Type-checks cleanly against the real compiler, confirmed against both edited agent files.
