# ADR-0009: Dependency-cruiser for layer/domain boundary enforcement

Status: Accepted (config written; not yet executed against the real graph — see verification note)
Date: 2026-07-18

## Context

CTO Audit Part 2, section 1: "Enforce these layer boundaries with code," specifically that Business/AI code should never import UI, and layers shouldn't be skipped. Prior to this ADR, the layering described in `docs/architecture/CORE_ARCHITECTURE.md` and the domain separation in `docs/architecture/DOMAIN_MAP.md` (Part 1) were documentation only — nothing would fail a build if either was violated.

## Decision

Add `dependency-cruiser` (`.dependency-cruiser.cjs`, repo root) as a devDependency and `npm run depcruise` script. Encodes: no `src/lib` → UI imports (error); AI-domain folders specifically may not import UI (error, restated beyond the general rule per the audit's specific callout); no circular dependencies (error); no direct DB-driver imports outside `NexusDB.ts` (error, enforcing ADR-0001); business-domain → AI-domain internal imports (warning, since zero violations exist today per `DOMAIN_MAP.md` — the rule exists to keep it that way); orphan-module detection (warning, cross-checks `docs/governance/TECHNICAL_DEBT_REGISTER.md`'s grep-based dead-code scan against the real import graph).

Chosen over alternatives (a custom ESLint rule set, a hand-rolled import-graph script) because it's a standard, actively-maintained tool purpose-built for exactly this, with a JS/TS-native config format that can encode path-based rules precisely rather than approximating them.

## Consequences

**Easier:** a layer violation becomes a CI failure instead of something only caught in code review, if review catches it at all; the orphan-detection rule gives a second, more reliable method to validate the dead-code candidates in `TECHNICAL_DEBT_REGISTER.md`.

**Harder / cost:** first run will likely surface real violations that need triage (fix vs. add a scoped exception to the rule) — budget time for a calibration pass, not a clean first run.

## Verification note (important)

This config could not be executed in the sandbox this was written in — no network access to `npm install dependency-cruiser` or run it against the actual dependency graph. The rule syntax follows the standard dependency-cruiser schema from general knowledge of the tool, but **has not been confirmed to run without syntax or config errors**. Run `npm run depcruise` after `npm install` as the first real test of this file, before relying on its results.
