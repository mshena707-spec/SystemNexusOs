# Event-Driven Architecture

**Status of this document:** ✅ Describes real, verified code (`src/lib/core/events/NexusEventBus.ts`, 334 lines). Status of the underlying system: 🟡 Beta — real and reasonably broad, not yet universal.

## Correcting the audit on this point

CTO Audit Part 1, section 6, says: *"Currently, most of the places are Direct Call. Future should be Event."* and recommends adding Event-Driven as a stated architecture philosophy.

Both things are true, but the situation is better than "should be" implies: **the event bus already exists, is well-designed, and is adopted in 26 files** across core, security, commerce, memory, orchestration, support, and business-intelligence. What's missing isn't the pattern — it's (a) making it the *documented, default* convention, and (b) extending it to the modules that still bypass it. This doc does the first; the recommendation below scopes the second.

## What exists

`EventBus.emit('order.created', { orderId, userId, amount })` / `EventBus.on('order.created', async (event) => {...})` — a typed pub/sub bus with:

- **37+ typed event names** (`NexusEventType`), grouped by domain: order lifecycle, rider, customer, inventory, security, AI/agent, memory, system, omnichannel, payments — plus a `| string` wildcard escape hatch for extensibility.
- **Source tracking** — every subscription records which module (`source`) subscribed, which makes debugging "who's listening to this event" tractable instead of a grep exercise.
- **Retry logic** — failed event handling can re-emit as `${source}:retry`.
- **Structured logging** on emit/subscribe/unsubscribe, including a warning when an event is emitted with zero subscribers (useful for catching dead code and typos in event names alike).

Sample of the taxonomy (see the file itself for the full list):

```
order.created / order.paid / order.dispatched / order.delivered / order.cancelled / order.refunded
fraud.detected / fraud.blocked / security.breach_attempt
ai.request.started / ai.request.completed / ai.provider.unhealthy
agent.task.started / agent.task.completed / agent.approval.required
memory.written / memory.evicted / memory.corrupted
system.health.degraded / system.health.recovered
```

This taxonomy alone is a good sign: `agent.approval.required` and `memory.corrupted` in particular suggest someone thought about failure and human-in-the-loop cases up front, not just the happy path.

## Adoption map (as of this audit)

Currently wired into:
`orchestration/agents/{SpecialistAgents,SupervisorAgent}.ts`, `orchestration/tools/ToolRegistry.ts`, `queue/TaskQueue.ts`, `integrations/ChannelRegistry.ts`, `commerce/{ProductReviewEngine,OrderTimelineService,CSATEngine,InventoryReservationService}.ts`, `support/SLAMonitor.ts`, `personal_ai/LearningEngine.ts`, `business-intelligence/{autonomy/AutonomousEvolutionEngine,analytics/BIEngine}.ts`, `core/{index,config/NexusConfig,SystemBoot}.ts`, `core/registry/AgentRegistry.ts`, `core/health/HealthMonitor.ts`, `security/audit/{TenantIsolation,ImmutableAuditLog}.ts`, `security/fraud/CODFraudDetector.ts`, `security/abac/ABACEngine.ts`, `memory/NexusMemoryEngine.ts`, `pages/RepDashboard.tsx`, `server.ts`.

**Not yet confirmed wired in:** payments (Stripe integration — 22 files, none cross-checked against event names like `payment.confirmed`/`payment.failed` this round), the 6 database backend adapters inside `NexusDB.ts` (writes may not be broadcasting `memory.written`-style events consistently), and most of the 196 REST routes in `server.ts` beyond whatever server.ts itself emits directly.

## Recommendation

1. **Document this as the standing architectural convention**, not an aspiration: *"New cross-module side effects go through `EventBus.emit`, not a direct function call into another domain's module. Exception: synchronous request/response within a single domain."* Put this sentence in `CONTRIBUTING.md` (done — see that file) so it's enforced at PR review time, including for AI coding agents contributing to this repo.
2. **Close the payments gap first** — Stripe is the most heavily used integration (22 files) and currently the least verified against the event bus. `payment.confirmed`/`payment.failed`/`payment.refunded` event types already exist in the taxonomy; confirm they're actually emitted from the Stripe webhook handler, not just declared as types.
3. **Add one dashboard or log view** that subscribes to `system.health.degraded`, `fraud.detected`, and `agent.approval.required` as a unified "things a human should look at" feed. The event types for this already exist; someone just needs to consume them in one place instead of three.
