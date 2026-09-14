# ADR-0019: Agent Permission Matrix completion (fileAccess, networkAccess, deletePermission, learningPermission)

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 3, section 4 asked for a permission matrix covering Memory/Tool/API/Agent access (completed in ADR-0014). CTO Audit Part 4, section 4, names the same concept with a slightly different, more complete list: "Memory Permission, API Permission, Tool Permission, File Permission, Network Permission, Delete Permission, Learning Permission." File, Network, Delete, and Learning were the remaining gap.

## Decision

Added `fileAccess`, `networkAccess`, `deletePermission`, `learningPermission` to `AgentCapabilities` — all optional, all default to the restrictive reading when unset (no access), so every agent declared before these fields existed is correctly interpreted as not having them, not as unrestricted.

`learningPermission` is the one field in this set that's **actually enforced**, not just declared: `LearningApprovalGate.submit()` (ADR-0013) now resolves the submitting agent via `AgentRegistry.resolve()` and blocks the submission outright if `learningPermission === false`. Deliberately fail-open for sources that aren't a resolvable registered agent (so this doesn't break every pre-existing caller) and fail-closed only when an agent explicitly opts out.

## Consequences

**Easier:** the full permission list both Part 3 and Part 4 asked for now exists as real fields, with the highest-stakes one (learning) enforced, not just documented.

**Harder / cost:** `fileAccess`/`networkAccess`/`deletePermission` remain declared metadata, same honest caveat as `escalationRules` in ADR-0014 — no agent currently has runtime code checking these before performing a file/network/delete operation. Real enforcement would mean auditing every agent's tool usage against these flags, a larger change than adding the fields.

## Follow-up

Wire `fileAccess`/`networkAccess`/`deletePermission` into real enforcement points once it's clear which agents actually need file/network access outside the tool-calling pattern (`ToolDefinition.resourceAccess`, ADR-0017, covers the tool-mediated case already) — building enforcement before knowing the real usage pattern risks guessing wrong.

## Verification

Type-checks cleanly against the real compiler, including the `LearningApprovalGate` enforcement change.
