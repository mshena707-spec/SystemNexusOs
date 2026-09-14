# Naming Conventions

**Status of this document:** ✅ New standard, grounded in a real audit of `src/` (345 files). This directly answers CTO Audit Part 1, section 5.

## Current state (measured, not guessed)

| Suffix | File count |
|---|---|
| `*Engine.ts(x)` | 95 |
| `*Service.ts(x)` | 10 |
| `*Manager.ts(x)` | 9 |
| `*Dashboard.ts(x)` | 8 |
| `*Agent.ts(x)` | 6 |

**The real finding:** `Engine` is used almost 3x more than the other four suffixes *combined*. That's not a naming-consistency problem in the sense of "random, chaotic names" — it's the opposite problem: `Engine` has become the default catch-all for "does something non-trivial," which erodes its own meaning. If everything is an Engine, the word stops telling you anything about what a file does.

The audit also specifically named three outlier files. Confirmed to exist, all in `src/components/admin/`:
- `CEOCommandCenter.tsx`
- `OwnerAIControlApp.tsx`
- `NexusIntelligenceHubApp.tsx`

Only one generic/vague name was found in the entire `src/` tree: `security/SecurityUtils.ts`. So the "Utils/Helper/Common" concern from the audit is a minor, contained issue in practice, not a widespread pattern — worth fixing, not worth a large cleanup effort.

## The standard, going forward

Use the suffix that matches what the file *actually does*, not the most available-sounding word:

| Suffix | Use when the file... | Example |
|---|---|---|
| **Agent** | Makes autonomous decisions, can take multi-step action | `SupervisorAgent.ts` |
| **Engine** | Runs a defined computation/process on input → output, no autonomy | `ConfidenceScorer` (inside `ConfidenceAndDecomposer.ts`) — *reserve this for genuinely process-like logic, not everything* |
| **Service** | Wraps an external integration or a cross-cutting capability other modules call into | `TOTPService.ts`, `JWTService.ts` |
| **Manager** | Owns the lifecycle of a specific resource/entity (create/read/update/delete + state) | `AgentRegistry.ts` (arguably should be `AgentManager.ts` under this rule — see below) |
| **Dashboard** | A UI surface, admin or customer-facing | `RepDashboard.tsx` |
| **Registry** | A lookup/registration table other code queries by key | `ToolRegistry.ts`, `AgentRegistry.ts` |

**On `Engine`:** don't ban it — 95 existing files isn't worth a mass rename, and some of those really are engines (`ConfidenceScorer`'s home file, `FraudDetectionEngine.ts`). Going forward, before naming a new file `*Engine`, ask "would `Service`, `Manager`, or `Registry` describe this more precisely?" — reach for `Engine` last, not first.

## Outlier file naming (recommendation, not yet applied)

| Current | Suggested | Reasoning |
|---|---|---|
| `CEOCommandCenter.tsx` | keep as-is | This is a real, specific product concept (a CEO's admin view) — the name is descriptive, not generic. Flagged by the audit but doesn't actually need changing. |
| `OwnerAIControlApp.tsx` | keep as-is, same reasoning | Redundant `App` suffix is a minor style question (see below), not a naming-standard violation. |
| `NexusIntelligenceHubApp.tsx` | keep as-is, same reasoning | — |

**Revised recommendation after inspection:** these three names are actually fine — they describe real, specific admin surfaces, not generic placeholders. The `App` suffix on `OwnerAIControlApp.tsx`/`NexusIntelligenceHubApp.tsx` is inconsistent with `CEOCommandCenter.tsx` (no `App` suffix) — that's a smaller, cosmetic inconsistency worth a one-line style rule rather than a rewrite: **admin surface components live in `src/components/admin/` and don't need an `App` suffix, since the folder already says what they are.**

## The one real fix

Rename `security/SecurityUtils.ts` to something that says what it actually contains (e.g., if it's mostly crypto/hashing helpers, `SecurityCrypto.ts`; if it's mixed, split it). This is a 5-minute fix — do it next time that file is touched for any other reason, no need for a dedicated PR.

## Rule for new files (put this in `CONTRIBUTING.md` — done)

Before naming a new file, name it after what it *does*, then check this table for the closest match. If nothing fits, that's a signal the responsibility itself might be unclear — worth a second look before writing code, not just before naming it.
