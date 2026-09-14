# Audit Response — Part 2 (Core Architecture)

Logs what was done in response to `CTO Deep Audit — Part 2`. Unlike Part 1 (documentation-only), this round included real code changes — additions, fixes, and one boot-blocking bug — because Part 2 explicitly asked for code-level enforcement, not just documentation. Everything below was checked against the actual code; where the real TypeScript compiler was used to verify something, that's stated explicitly rather than implied.

## The two most important findings this round

**1. `RedisTaskQueue.ts` — which `server.ts` imports directly — had an import pointing to a module that doesn't exist anywhere in this repository** (`../monitoring/health/NexusLogger`, a path with no corresponding folder), using a constructor pattern (`new NexusLogger(name)`) that doesn't match the real logger's actual API either. This would throw a module-not-found error the moment the server starts. **Fixed.**

**2. The entire order-lifecycle notification pipeline was broken.** `AutomationEngine.ts` — the class handling `order.created`, `order.paid`, `order.dispatched`, `order.delivered`, `delivery.failed`, `low_stock`, `fraud.detected`, and more — had 11 calls to `NotificationEngine` methods that never existed on the real class (plus 2 more in `TaskQueue.ts`, 13 total). A customer placing an order would not reliably have received a placed/paid/dispatched/delivered notification; admin would not reliably have received low-stock or fraud alerts. **Fixed** — all 6 missing methods added to `NotificationEngine.ts`, built on its existing real primitives, with signatures read directly from the real call sites rather than guessed.

Both found by actually running `tsc --noEmit` against the codebase (TypeScript happened to be available in this sandbox — see the verification note at the end of this document), not by reading files individually. Full detail on both: `docs/governance/TECHNICAL_DEBT_REGISTER.md`. Placed first because they matter more than any architecture discussion below: everything else in this audit response assumes the system runs and that customers receive their order updates.

## Fixed (real bugs, verified against the compiler)

- `RedisTaskQueue.ts` — broken import + logger API mismatch (boot-blocking; above).
- `NotificationEngine.ts` — 6 missing methods (`notify`, `saveInApp`, and 4 order-lifecycle convenience methods) that `AutomationEngine.ts` (11 sites) and `TaskQueue.ts` (2 sites) were already calling. This was the entire order-notification pipeline (above).
- `AgentRegistry.ts`'s `AgentCapabilities.memoryAccess` type was missing `'restricted'`/`'learning'`, which `FraudDetectorAgent`/`MarketingAgent` were already using — a pre-existing type error `npm run lint` (`tsc --noEmit`) would already catch. Widened the type to match the agents' (correct) intent.
- Three bugs introduced and then caught in this round's own new code, before being shipped: a `captureStackTrace` type issue in `NexusError.ts`, a non-generic-method-called-as-generic bug in `FeatureFlags.ts` (`NexusDB.find()` isn't generic), and a wrong field name (`LoyaltyBalance.points` vs. the real `currentPoints`) in the example plugin. All caught by the compiler, not left for someone else to find.
- `@socket.io/redis-adapter` was listed under `devDependencies` in `package.json` despite being used in production code (`NexusWebSocket.ts`) — moved to `dependencies`.

## Found, not individually fixed (documented precisely instead)

- A full `tsc --noEmit` sweep across the entire project (beyond the files this audit round touched) surfaced ~18 more `error TS2339` instances across 13 files — the same *class* of bug as the two fixes above (drifted API, caller not updated), but each needs the same call-site-by-call-site verification that made the two fixes above safe, which is a larger commitment than this round's scope. Documented as an exact, ready-to-work punch list in `docs/governance/TECHNICAL_DEBT_REGISTER.md` rather than guessed at.
- Two live, overlapping background job systems (`TaskQueue.ts` and `RedisTaskQueue.ts`) — see the correction below. Needs a deliberate ownership decision, not a unilateral pick.

## Built (new code, addressing confirmed real gaps)

| What | Answers audit section | Verified how |
|---|---|---|
| `.dependency-cruiser.cjs` — layer/domain boundary enforcement | §1, §3 | Written against the real tool's schema; **not executed** (no network to install it) |
| `src/lib/core/errors/NexusError.ts` — global error framework | §10 | ✅ Compiler-verified, tests written (`tests/lib/core/errors/`) |
| `src/lib/core/flags/FeatureFlags.ts` — persistent feature flags | §8 | ✅ Compiler-verified |
| `src/plugins/PluginRegistry.ts` + `src/plugins/loyalty-advisor/` | §9 | ✅ Compiler-verified |
| `IAgent` extended with `initialize`/`reason`/`learn` (optional) | §4 (LSP) | ✅ Compiler-verified against all 7 existing implementers |
| `memory_cleanup` background worker + daily cron | §13, ties to Part 1's memory-retention gap | ✅ Compiler-verified against real `MemoryQuery`/`BaseMemoryEntry` types |
| `NotificationEngine.ts` — 6 missing methods added | Not audit-requested; found via compiler sweep while verifying §13's background workers | ✅ Compiler-verified; zero remaining `NotificationEngine` errors anywhere in the codebase |
| `vitest.config.ts` + first 2 test files | Supports §4, §15 | Written correctly; **not executed** (no network to install vitest) |
| 5 new ADRs (0006–0010) | §9 | — |

## Corrected — the audit's claims, checked against real code

1. **§8, "I did not find the Feature Flag System"** — directionally right (the existing file was dead code in substance) but a file did technically exist. Documented precisely rather than either accepting or flatly rejecting the claim.
2. **§7, implied "configuration isn't centralized"** — wrong. `NexusConfig.ts` is a real, 20-file-adopted centralized config service, with a stated principle (no raw `process.env` access elsewhere) that a *second*, unused file (`AutoConfig.ts`) was quietly violating. Deprecated the unused one.
3. **§12, "many flows are synchronous... biggest architectural gap"** — checked directly against the `order.created` flow specifically: it's genuinely event-driven, wired through `NexusEventBus` → `AutomationEngine` → `SystemBoot.ts`, not synchronous.
4. **§11, "I have seen the basis of Observability... more should be added"** — more existed than implied. `Telemetry.ts` has a real `TraceTracker`/`Span` system, used across 9 files. See `docs/architecture/OBSERVABILITY.md` for the precise gap that remains (Memory Trace, User Journey Logs).
5. **§4, "Agent interface should be more standard"** — a real, correctly-used `IAgent` interface already existed, implemented by 7 of 8 agent classes via a clean abstract-base-class pattern. The real gap was one specific class (`CEOAgent`), not a systemic absence of standardization.
6. **§2, God Module risk** — checked directly (import-breadth scan across every file): no file besides `server.ts` itself (an expected entry point) imports from 5+ distinct domains. The specific failure mode described wasn't found to exist yet.

## Corrected — this audit's own Part 1 response

Part 1's `docs/architecture/SCALING_GUIDE.md` claimed `RedisTaskQueue.ts` had 0 importers and read it as likely-abandoned. That was wrong — a renamed import binding (`taskQueue as redisTaskQueue`) in `server.ts` wasn't caught by the grep pattern used at the time. Corrected in place in that document, with a note explaining what was missed and why, rather than silently editing it.

## Scope note

Section 14 (service-boundary extraction into separately deployable services) was documented as a target state, not attempted — that's a large infrastructure project appropriately triggered by real scale pressure, not a documentation-audit side effect. Section 15's "before adding a new feature: refactor, stabilize, test, document" cycle is now `docs/governance/TECHNICAL_DEBT_REGISTER.md`'s explicit purpose going forward — it's a live backlog, not a one-time snapshot.

## Verification note

TypeScript (`tsc` 6.0.3) was unexpectedly available in this sandbox despite no `npm install` having been run (no `node_modules`, no network access). This allowed real compiler verification of every new/modified `.ts` file in this round — a level of confidence Part 1's documentation-only pass didn't have access to. `dependency-cruiser` and `vitest` are not globally available the same way `tsc` is, so the config/test files that depend on them are written correctly against their known schemas but **have not been executed**. Run `npm install && npm run depcruise && npm test` as the first real test of everything in this category.
