# ADR-0011: PromptShield — pattern-based AI security layer

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 3, section 16: zero prompt-injection, jailbreak-detection, or sensitive-data-filtering code existed anywhere in this codebase — confirmed by direct search before this ADR. Notably, this is the exact folder Part 1 found as a malformed, empty, unexpanded-brace directory (`src/lib/security/{abac,audit,prompt}`) — `prompt` never got created.

## Decision

`src/lib/security/prompt/PromptShield.ts`: pattern/heuristic-based detection for instruction-override, system-prompt-leak, role-confusion, delimiter-injection, and encoding-evasion attempts, plus a separate sensitive-data output filter and a memory-poisoning check (reused by `LearningApprovalGate`, ADR-0013). Wired directly into `NexusUnifiedCore.process` — the single entry point for all AI execution — on both the input (`inspect()`) and output (`filterSensitiveData()`) sides.

Deliberately NOT an ML classifier. Pattern-based detection is a real, standard first layer (most production systems start here) but has known limits: it misses novel phrasings and can false-positive on legitimate text. `blocked: true` is documented in the code as "route to review," not "definitely malicious."

## Consequences

**Easier:** the most common, well-known injection patterns are now caught before reaching an LLM, for every caller of the central AI entry point at once — no per-call-site integration needed.

**Harder / cost:** false positives are possible on legitimate text matching a pattern (e.g., a customer asking "what were you told to charge me" could trip the system-prompt-leak pattern). No mechanism yet to review/appeal a block — a blocked request currently just fails with a generic message via `NexusError`.

## Verification

Type-checks cleanly against the real compiler. Not tested against real adversarial prompts or real LLM calls (no network in this sandbox) — pattern logic is verified correct as written, not verified effective against live attack attempts.
