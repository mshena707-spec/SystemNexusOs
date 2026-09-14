# Observability

**Status of this document:** ✅ New, answers CTO Audit Part 2 section 11. Corrects the audit's framing in one respect: more existed already than "I have seen the basis of Observability" suggested.

## What already exists

`src/lib/observability/Telemetry.ts` (223 lines) — not a bare `requestId` stapled onto logs, but a real `TraceTracker` class with `Span`/`SpanEvent`/`TraceData` types and a dedicated `AIErrorType` enum for classifying AI-specific failures. `traceId` propagation is real and reasonably broad: referenced across 9 files spanning `SpecialistAgents.ts`, `SupervisorAgent.ts`, `ToolRegistry.ts`, `Telemetry.ts` itself, `NexusLogger.ts`, `NexusEventBus.ts`, `AgentRegistry.ts`, `ImmutableAuditLog.ts`, and `server.ts`. `AgentInput` (`AgentRegistry.ts`) carries `traceId` as a first-class field, meaning a trace ID can flow from an incoming request through an agent's entire execution.

`NexusError` (built this round, `docs/adr/0006-global-error-framework.md`) accepts and logs a `traceId` too, so an error raised deep in a call chain can be tied back to the request that caused it.

## What the audit asked for, mapped against what's confirmed

| Audit's ask | Status |
|---|---|
| Request Trace ID | ✅ Confirmed — `traceId` on `AgentInput`, propagated across 9 files |
| Agent Trace | 🟡 Partial — `Span`/`TraceData` in `Telemetry.ts` cover this generically; not confirmed as a *labeled*, agent-specific view (e.g. "show me every span for agent X's last decision") |
| Memory Trace | ⚪ Not confirmed as a distinct concept — `NexusMemoryEngine` operations aren't confirmed to consistently carry/emit trace context |
| API Trace | 🟡 Partial — `server.ts` references trace patterns, but with 196 routes (`docs/architecture/API_SPECIFICATION.md`), consistent per-route trace coverage wasn't verified route-by-route this round |
| Performance Metrics | ✅ — Prometheus + Grafana are real, running services (`docker-compose.yml`), not just aspirational |
| User Journey Logs | ⚪ Not confirmed — no dedicated user-journey/session-replay concept found distinct from general request logging |

## Recommendation

Don't build a second, parallel tracing system — extend `Telemetry.ts`. Concretely: (1) add a `memory` span type alongside whatever span types already exist, and have `NexusMemoryEngine.query`/`.write`/`.delete` (`docs/architecture/MEMORY_ARCHITECTURE.md`) open one, closing the "Memory Trace" gap with the infrastructure that already exists rather than new infrastructure; (2) confirm (not assume) that every one of the 196 routes in `server.ts` either receives or generates a `traceId` at the top of its handler — this is a grep-and-spot-check task, not a rebuild; (3) "User Journey Logs" is the one item here that's a genuinely new capability, not an extension of something existing — scope it as its own small project once (1) and (2) are closed, since it's the lowest-leverage of the three remaining gaps (Prometheus/Grafana dashboards already give you the operational picture; user journey is a product-analytics need, not an incident-response one).
