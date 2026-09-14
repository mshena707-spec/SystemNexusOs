# ADR-0004: Event bus as the standard for cross-domain communication

Status: Accepted (retroactive) for existing usage; enforcement as a written rule is Proposed
Date: 2026-07-18

## Context

CTO Audit Part 1, section 6, recommended Event-Driven as an explicit architecture philosophy, on the observation that most communication looked like direct calls. Code inspection this round found `NexusEventBus.ts` (334 lines, 37+ typed event types) already adopted in 26 files spanning core, security, commerce, memory, orchestration, support, and business-intelligence — a real pattern, just not a written-down convention anyone could point to.

## Decision

Going forward: **any side effect that crosses domain boundaries** (as mapped in `docs/architecture/DOMAIN_MAP.md`) goes through `EventBus.emit(...)`, not a direct import/function call into another domain's module. Direct calls remain fine *within* a single domain (e.g., one commerce module calling another commerce module synchronously for a request/response it needs immediately).

This is now written into `CONTRIBUTING.md` as an enforceable PR-review rule, including for AI coding agents contributing to this repo — a coding agent asked to "wire up X to Y" should reach for `EventBus.emit`/`EventBus.on` by default when X and Y are in different domains.

## Consequences

**Easier:** new features can subscribe to existing events (`fraud.detected`, `agent.approval.required`, etc.) instead of needing a code change in the module that produces them. Debugging "who reacts to this" becomes a search for the event name instead of a call-graph trace.

**Harder / cost:** event-driven flows are harder to step through in a debugger than a direct call stack — worth pairing with good structured logging (already present — `NexusEventBus` logs on emit/subscribe/unsubscribe) so "what happened" is reconstructable from logs even when it isn't obvious from stack traces.

## Follow-up

Payments (Stripe, 22 files — the most heavily used integration) is the highest-priority gap to confirm against this convention; see `docs/architecture/EVENT_BUS.md` for the full adoption map and the specific event types (`payment.confirmed`, `payment.failed`, `payment.refunded`) that already exist and should be verified as actually firing from the Stripe webhook handler.
