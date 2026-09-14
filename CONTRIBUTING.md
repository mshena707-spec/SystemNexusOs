# Contributing to Nexus OS

This file exists because CTO Audit Part 1 (section 10) asked for one. It's written for two audiences equally: **human engineers** and **AI coding agents** (Claude Code, Cursor, Copilot, etc.) working on this repo — this codebase already has extensive AI-assisted history (20 `PHASE_*_CHANGELOG.md` files), so the rules that keep an AI agent from introducing drift matter as much as the rules for a human.

## Naming Rules

Full detail: `docs/architecture/NAMING_CONVENTIONS.md`. Short version:
- Name a file after what it *does*. Reach for `Service`, `Manager`, or `Registry` before defaulting to `Engine` — `Engine` is already used in 95 files and has become a catch-all; keep it for genuine process/computation logic.
- Admin surface components live in `src/components/admin/` and don't need a redundant `App` suffix — the folder already says what they are.
- Before creating a new file, check `NAMING_CONVENTIONS.md`'s table for the closest existing pattern.

## Folder Rules

Full detail: `docs/architecture/DOMAIN_MAP.md`. Short version:
- Know which of the three domains (Business / AI / Infrastructure) your change belongs to before deciding where it lives.
- `src/lib/core` and `src/components/admin` are the two folders already over a healthy size (51 and 42 files). Don't add more loose top-level files to `src/lib/core` — use or extend one of its existing subfolders (`events/`, `config/`, `registry/`, `health/`, etc.).
- **When creating multiple directories at once, verify shell brace expansion actually happened.** This audit found and fixed four real directories literally named `{agents,tools,pipeline}`, `{analytics,forecasting,recommendations,autonomy}`, `{abac,audit,prompt}`, and `{types,adapters,interfaces,acl}` — the literal unexpanded string, not four separate folders. This happens when `mkdir -p path/{a,b,c}` runs in a context where the shell doesn't expand braces (some sandboxed tool-call environments, `sh` instead of `bash`, etc.). After running any multi-directory `mkdir`, run `ls` and confirm you got separate folders, not one folder with a comma in its name.

## Security Rules

Full detail: `docs/architecture/SYSTEM_SECURITY.md`.
- All data access goes through `NexusDB` (`docs/architecture/DATABASE_SCHEMA.md`) — never import a database SDK directly in business logic.
- Any new route touching personal or financial data must be behind `requireAuth` or `requireAdmin` — don't assume a route is "obviously" internal-only.
- Never commit `.env` (already gitignored — keep it that way). New secrets go in `.env.example` as a documented, empty placeholder, never with a real value.
- New fraud/pricing/payment logic should emit through `NexusEventBus` (`fraud.detected`, `payment.*`, etc.) so it's visible to audit logging and agent escalation — don't build a side channel that bypasses the audit trail.

## Commit Rules

This repo's zip export has no git history to infer a convention from, so this is a fresh standard, not a documented existing one:
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`. Example: `fix(queue): resolve duplicate TaskQueue/RedisTaskQueue implementations`.
- Reference the relevant doc in the commit body when a change touches something covered by an ADR or architecture doc (e.g., "See ADR-0003").
- One logical change per commit — a 3,724-line `server.ts` (the current state of this repo) already makes changes hard to review; don't compound that with commits that mix unrelated changes.

## Testing Rules

**Current state, stated plainly:** there is no test framework in `package.json` (no vitest/jest/mocha), no `*.test.ts` files anywhere in the repo, and CI (`.github/workflows/deploy.yml`) runs a TypeScript check and a build, not tests. The `src/lib/testing/*Engine.ts` files (ProductionReadinessEngine, SecurityPenTestEngine, etc.) appear to be AI-driven runtime self-checks, not a substitute for this.
- **New code that touches security (`TenantIsolation`, `ABACEngine`), payments, or the agent authority hierarchy (`AgentHierarchy.assertAuthority`) should ship with at least one test**, even if this means introducing `vitest` as the first test dependency in this repo. These are the modules where a silent regression is a breach or a financial loss, not just a bug ticket.
- Until a framework is chosen, the highest-priority single test to write (per `AGENT_PROTOCOL.md`) is one integration test tracing `AgentRegistry → SupervisorAgent → ConfidenceScorer → NexusEventBus`.

## Review Rules

- A PR that touches `src/lib/core/*` (top-level, not a subfolder) should include a note on why the new file didn't fit an existing subfolder — see the Folder Rules above.
- A PR that adds a new database client, queue library, or Redis client should link to the relevant ADR or explain why a new one is justified instead of extending `NexusDB`/the existing queue/the existing Redis client (see ADR-0001, ADR-0003).
- A PR that adds a new cross-domain side effect should use `EventBus.emit`, per ADR-0004, unless there's a specific reason a direct call is correct — reviewers should ask "why not an event?" by default.

## AI Agent Rules

Written specifically because this repo will likely continue to be built with significant AI-agent assistance:
1. **Before writing a new module, check whether one already exists.** This audit found a duplicate task queue (`TaskQueue.ts` and `RedisTaskQueue.ts`, `docs/architecture/SCALING_GUIDE.md`) and two Redis client libraries in parallel use (ADR-0003) — both are exactly the failure mode of an agent (human or AI) building a new solution instead of finding and extending the existing one. Search `src/lib/` for related names before creating a new file.
2. **Don't create a new top-level `PHASE_X_CHANGELOG.md` or similar narrative doc.** Update `docs/governance/FEATURE_STATUS.md` instead — that's now the live status source (see that file's own instructions on keeping itself honest).
3. **Match the status legend honestly.** If asked to document a feature, use ✅/🟡/🔵/⚪ based on what the code actually does, not what it's intended to eventually do. Overstating status in documentation is the exact problem this whole audit response exists to fix — don't reintroduce it.
4. **Verify claims about the codebase by reading the code**, the way this document's own claims were derived — grep for real usage counts, don't assume a `package.json` dependency means a feature is live (see ADR-0001's finding: six DB libraries listed, one confirmed production default).
