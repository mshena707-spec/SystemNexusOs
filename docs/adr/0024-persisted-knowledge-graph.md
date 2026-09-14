# ADR-0024: Persisted, multi-hop Business Knowledge Graph

Status: Accepted
Date: 2026-07-22

## Context

CTO Audit Part 5 found `src/lib/intelligence/KnowledgeGraph.ts` already existed (`addNode`/`linkNodes`/`inferContext`, real if minimal logic) but was in-memory only (a `Map` — doesn't survive a restart, doesn't share state across horizontally-scaled instances) and completely unused (zero importers anywhere). CTO Audit Part 6, section 19, asks for exactly this capability applied to business entities (Customer → Order → Product → Supplier), unaware the skeleton already existed.

## Decision

Extended the existing file rather than building a second, competing implementation — this codebase has a repeatedly-documented history (`docs/governance/TECHNICAL_DEBT_REGISTER.md`) of exactly that duplication pattern, and this ADR is deliberately not adding to it. Persisted via `NexusDB` (`knowledge_graph_nodes`/`knowledge_graph_edges` collections). Added real breadth-first multi-hop traversal, depth-bounded (default 3, matching the audit's own example chain length) and cycle-guarded — the previous version's `inferContext` only returned direct edges, so the audit's own worked example (a 3-hop chain) was never actually retrievable from it.

This is a breaking API change (`addNode`/`linkNodes`/`inferContext` are now async; `addNode`'s type parameter widened from `'Customer'|'Memory'|'Decision'` to a broader business-entity union) — safe specifically because zero real callers existed to break, confirmed in Part 5.

## Consequences

**Easier:** the primitive the audit asked for now actually works as described — persists, and supports the multi-hop queries the audit's own example needs.

**Harder / cost — stated prominently:** still not wired into any real event handler. Nothing currently calls `addNode`/`linkNodes` as orders, customers, or products are created — the graph will stay empty until something populates it. The natural integration point is `AutomationEngine`'s existing `order.created`/`order.paid` handlers (`docs/architecture/MARKETPLACE_BUSINESS_LOGIC.md`), not built this round.

## Follow-up

Wire node/edge creation into `AutomationEngine`'s order lifecycle handlers as the first real population source, then extend to products/suppliers once the order-side integration is proven.

## Verification

Type-checks cleanly against the real compiler.
