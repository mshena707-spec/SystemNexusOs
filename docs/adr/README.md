# Architecture Decision Records

CTO Audit Part 1, section 9, asked for these: a written record of *why* a major technical choice was made, so that six months from now nobody has to guess (or worse, silently re-litigate a decision that was already made for a good reason).

## Why this matters more than usual for this codebase specifically

This project has 20 `PHASE_*_CHANGELOG.md` files recording *what* was built, phase by phase — that's valuable history. What's missing is *why*, in the specific cases where there was a real choice to make. The clearest example found this round: `package.json` lists six different database client libraries. Without an ADR, that reads as indecision. With one (`0001` below), it's a documented, deliberate architecture — the difference between those two readings is entirely this folder.

## Rule going forward

Write a new ADR when a decision is:
- **Expensive to reverse** (a database, a queue technology, an auth scheme)
- **Not obvious from reading the code** (why Firestore *and* five other backends, not just why Firestore)
- **Likely to be questioned later** by a new engineer, an investor's technical diligence, or an AI coding agent about to "helpfully" simplify something that was actually intentional

Don't write one for reversible, low-stakes choices (a component name, a folder location for one file) — `NAMING_CONVENTIONS.md` and `DOMAIN_MAP.md` already cover those.

## Format

```
# ADR-XXXX: <short title>
Status: Proposed | Accepted | Superseded by ADR-YYYY
Date: YYYY-MM-DD

## Context
What situation made this decision necessary?

## Decision
What was decided.

## Consequences
What this makes easier, what this makes harder, what it costs.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-pluggable-multi-backend-database-layer.md) | Pluggable multi-backend database layer (NexusDB) | Accepted (retroactive) |
| [0002](0002-firestore-as-default-database-provider.md) | Firestore as the default database provider | Accepted (retroactive) |
| [0003](0003-redis-client-consolidation.md) | Consolidate on one Redis client library | Proposed |
| [0004](0004-event-bus-as-cross-domain-convention.md) | Event bus as the standard for cross-domain communication | Accepted (retroactive), enforcement Proposed |
| [0005](0005-multi-provider-ai-strategy.md) | Multi-provider AI strategy (Gemini + Ollama + WebLLM) | Accepted (retroactive) |
| [0006](0006-global-error-framework.md) | Global error framework (NexusError) | Accepted |
| [0007](0007-feature-flag-service.md) | Persistent feature flag service | Accepted |
| [0008](0008-plugin-architecture.md) | Plugin architecture | Accepted |
| [0009](0009-dependency-cruiser-enforcement.md) | Dependency-cruiser for layer/domain enforcement | Accepted (unexecuted — see verification note) |
| [0010](0010-agent-lifecycle-standard.md) | Standard agent lifecycle (extend IAgent) | Accepted |
| [0011](0011-prompt-shield.md) | PromptShield - pattern-based AI security | Accepted |
| [0012](0012-debate-engine.md) | Debate Engine | Accepted |
| [0013](0013-learning-approval-gate.md) | Learning Approval Gate | Accepted |
| [0014](0014-agent-profile-extension.md) | Agent Profile extension | Accepted |
| [0015](0015-tool-governance-extension.md) | Tool Governance extension | Accepted |
| [0016](0016-secret-vault.md) | Secret Vault | Accepted |
| [0017](0017-tool-sandbox.md) | Tool Sandbox (scope-limited) | Accepted |
| [0018](0018-memory-encryption.md) | Owner memory encryption at rest | Accepted |
| [0019](0019-agent-permission-matrix-completion.md) | Agent Permission Matrix completion | Accepted |
| [0020](0020-memory-version-history.md) | Memory version history and rollback | Accepted |
| [0021](0021-immutable-memory-signatures.md) | Digital signatures for Immutable Memory | Accepted |
| [0022](0022-cross-agent-summary-access.md) | Cross-agent summary-only memory access | Accepted |
| [0023](0023-fraud-and-pricing-extensions.md) | Coupon abuse / refund fraud detection, competitor-aware pricing | Accepted |
| [0024](0024-persisted-knowledge-graph.md) | Persisted, multi-hop Business Knowledge Graph | Accepted |
| [0025](0025-memory-dashboard-and-server-ts-fix.md) | Memory Dashboard + critical server.ts parse-error fix | Accepted |
| [0026](0026-nexusdb-transactions.md) | NexusDB.runTransaction() -- real atomicity for Firestore, honest best-effort elsewhere | Accepted |

"Accepted (retroactive)" means: the decision was already made and built: this ADR documents it after the fact, because CTO Audit Part 1 found it undocumented. 0006-0010 are Part 2 decisions; 0011-0015 are Part 3 decisions (AI & Multi-Agent Architecture); 0016-0019 are Part 4 decisions (Security & Infrastructure); 0020-0022 are Part 5 decisions (Memory & Knowledge System); 0023-0024 are Part 6 decisions; 0025 is a Part 7 decision; 0026 is a Part 8 decision (Backend & Database) - all made and built in the same round as their ADR.
