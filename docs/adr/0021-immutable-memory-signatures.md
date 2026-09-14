# ADR-0021: Digital signatures for Immutable Memory

Status: Accepted
Date: 2026-07-20

## Context

CTO Audit Part 5, section 19 asks for "Checksum, Hash, Digital Signature, Immutable History." Checked directly: `hashContent()` (SHA-256) and `verifyImmutable()` already existed and are real, plus a `chainPrev` field (blockchain-style hash chaining) and `witnessIds` — more sophisticated than "not implemented." `signedBy` existed but was a plain string recording claimed authorship, not a verifiable signature: a hash proves content wasn't altered after being hashed, but doesn't prove who created it — anyone can compute a correct hash for altered content.

## Decision

Real HMAC-SHA256 signing, added as `ImmutableMemory.signature` (optional — pre-existing entries remain valid). Keyed via `SecretVault` (Part 4, `IMMUTABLE_MEMORY_SIGNING_KEY`), not a raw env read. Verification (`verifyImmutableSignature()`) uses `crypto.timingSafeEqual` for constant-time comparison rather than `===`, avoiding a timing-attack surface.

HMAC (symmetric) rather than asymmetric (RSA/ECDSA) signing, deliberately: this system has one signing authority (the server, via a shared secret) rather than multiple independent parties needing separately verifiable keys — the scenario asymmetric signing solves. Documented in the code as the reason to revisit if external parties ever need to verify a record without trusting this server.

## Consequences

**Easier:** an immutable record's claimed authorship (`signedBy`) is now verifiable, not just asserted — closing a real gap between what the field name implied and what was actually enforced.

**Harder / cost:** requires `IMMUTABLE_MEMORY_SIGNING_KEY` to be configured to take effect; degrades to hash-only (unsigned, logged warning) otherwise, matching the same graceful-degradation pattern as `MemoryEncryption` (ADR-0018) rather than hard-failing writes.

## Verification

Type-checks cleanly against the real compiler. Not tested against a real configured signing key or a real verify round-trip in this sandbox (no way to set env vars and restart a live process here) — the HMAC logic follows Node's documented `crypto` API but wasn't exercised end-to-end.
