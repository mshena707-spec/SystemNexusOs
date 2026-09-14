# ADR-0015: Tool Governance extension (owner, riskLevel, retryPolicy)

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 3, section 10, asks that every tool have Permission, Timeout, Retry, Owner, Audit, Rate Limit, and Risk Level. Checked against `ToolDefinition`/`NexusToolRegistryImpl` (`ToolRegistry.ts`): Permission (`allowedRoles`/`requiresApproval`), Timeout, Rate Limit, and a basic execution-log Audit trail already existed — more governance than the audit's "not available" framing suggested. Owner, Retry, and Risk Level were the confirmed gap.

## Decision

Added `owner`, `riskLevel` (`'low'|'medium'|'high'|'critical'`), and `retryPolicy` as optional fields on `ToolDefinition`. Wired into real behavior: `retryPolicy` triggers actual retries via the existing `RetryManager` (Part 2, reused not duplicated) — opt-in per tool, deliberately not default, since a naive retry on a tool with a side effect (e.g. a payment charge) risks a duplicate action. `owner`/`riskLevel` are now recorded on every execution-log entry. A failed `high`/`critical`-risk tool now emits `system.health.degraded`, reusing the existing event taxonomy rather than a new channel.

## Consequences

**Easier:** tool failures are now risk-weighted for alerting — a failed critical tool surfaces automatically; a failed low-risk one doesn't need to.

**Harder / cost:** none of the 20+ existing tool registrations (`registerBuiltInTools()`) were retroactively given `owner`/`riskLevel`/`retryPolicy` values as part of this change — the fields exist and work, but are unpopulated on existing tools until someone deliberately assigns them. Recommend populating `riskLevel` on payment- and fraud-related tools first, since those are the highest-consequence category per `docs/governance/AI_GOVERNANCE.md`.

## Verification

Type-checks cleanly against the real compiler, including the retry-wiring change to `execute()`'s control flow.
