# ADR-0016: Secret Vault

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 4, section 5 (critical priority #3): 25 files confirmed reading secret-shaped env vars directly via `process.env`. No masking, no access log, nothing enforcing the audit's core rule: "AI Agent will never get Raw Secret."

## Decision

`src/lib/security/vault/SecretVault.ts`. `get()` returns the raw value but throws if the caller's declared type is `'agent'` or `'tool'` — enforced by a required `SecretAccessContext` parameter, not by a naming convention someone has to remember. Agent-reachable code uses `hasSecret()` (boolean) or `getMasked()` (partial value) instead. Every access — granted or denied — logs to the real `ImmutableAuditLog` (Part 1/3), not a separate channel.

Retrofitted onto `JWTService.ts`'s secret lookup as a real, security-critical proof the pattern works (not a toy example), preserving its exact existing `JWT_SECRET`-then-`OWNER_SECRET` fallback behavior.

## Consequences

**Easier:** the 1 migrated call site now has a real access log; any future agent-reachable code that tries to call `.get()` fails loudly at the type level (a `SecretAccessContext` with `caller: 'agent'` is a compile-time-visible construction, easy to catch in review) instead of silently reading a secret.

**Harder / cost:** 24 of 25 confirmed direct-`process.env` call sites are not migrated — this ADR covers the vault and one proof case, not a full migration. Each remaining migration is a small, low-risk change individually, but 24 of them is real work, not done in this round.

## Follow-up

Migrate the remaining 24 call sites opportunistically (next time each file is touched for another reason), prioritizing payment-related secrets (`STRIPE_SECRET_KEY`, `BKASH_APP_SECRET`, etc.) first, per `docs/governance/AI_GOVERNANCE.md`'s guidance that payments deserve the tightest controls.

## Verification

Type-checks cleanly against the real compiler, including the `JWTService.ts` retrofit.
