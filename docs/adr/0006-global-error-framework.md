# ADR-0006: Global error framework (NexusError)

Status: Accepted
Date: 2026-07-18

## Context

CTO Audit Part 2, section 10, found "simple try/catch in some places... not enough for a production system," and confirmed by direct search: zero custom error classes, zero error codes, zero severity levels existed anywhere in the codebase before this ADR. `server.ts` alone has dozens of `catch (error: any)` blocks, each handled ad hoc.

## Decision

Introduce `NexusError` (`src/lib/core/errors/NexusError.ts`) as the standard for anything domain-meaningful: a typed error with a code, severity, domain, recovery strategy, and notification policy, that automatically logs via the existing `NexusLogger` and — for high/critical severity — emits on the existing `NexusEventBus` (reusing `system.health.degraded` rather than inventing a parallel channel). Paired with an Express middleware (`nexusErrorHandler`) wired as the last middleware in `server.ts`, converting `NexusError`s into consistent HTTP responses.

This is additive, not a rewrite: plain `throw new Error(...)` remains fine for truly unexpected failures, and `nexusErrorHandler` falls back to a generic 500 for any un-migrated route, so existing behavior doesn't regress.

## Consequences

**Easier:** consistent error responses across all 196 routes going forward; a real place to hang retry/notification policy instead of deciding it ad hoc at each catch site; errors are queryable/traceable via the same logger and event bus everything else already uses.

**Harder / cost:** the ~40+ existing `catch (error: any)` blocks in `server.ts` aren't migrated by this ADR — that's a gradual process, tracked as the top item in `CONTRIBUTING.md`'s testing/review rules ("new code touching security/payments ships with a NexusError, not a bare catch").

## Verification

Confirmed to type-check cleanly against the real TypeScript compiler (`tsc --noEmit`, see `docs/AUDIT_RESPONSE_PART2.md`), including its Express middleware signature and interaction with `NexusLogger`/`NexusEventBus`'s real APIs — not just written to look plausible.
