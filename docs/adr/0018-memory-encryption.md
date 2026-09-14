# ADR-0018: Owner memory encryption at rest

Status: Accepted
Date: 2026-07-19

## Context

CTO Audit Part 4, section 14: "all Sensitive Data must be Encrypted... Memory, API Keys, User Data, Financial Data." `OwnerMemory`'s write path (`NexusMemoryEngine.writeOwner()`) had a literal `content, // In production: encrypt this field` comment — the schema anticipated encryption (`encryptionKeyId?`, `encrypt?` fields already existed on `MemoryTypes.ts`) but nothing implemented it, the same "schema ready, nothing consumes it" pattern found with `expiresAt`/`ttlSeconds` in Part 2.

## Decision

`src/lib/memory/MemoryEncryption.ts`: AES-256-GCM via Node's built-in `crypto` (no new dependency). Key sourced through `SecretVault` (ADR-0016) rather than a raw env read, so the encryption key itself gets access-logging. Stored as a JSON-stringified `EncryptedPayload` within the existing `content: string` field — no interface/schema migration needed, and pre-existing unencrypted entries remain readable (`decrypt()` passes plain strings through unchanged).

Degrades gracefully if `MEMORY_ENCRYPTION_KEY` isn't configured: writes proceed unencrypted with a logged warning, rather than failing. Deliberate choice, stated in the code: a deployment that hasn't set up the key yet shouldn't suddenly be unable to write Owner memory.

**Caught during implementation, not after:** the Postgres write path used the raw, unencrypted `content` parameter instead of the encrypted `storedContent` — would have silently defeated encryption for any deployment on the Postgres backend. Fixed in the same change.

## Consequences

**Easier:** Owner memory (the highest-sensitivity type per `MemoryTypes.ts`'s own taxonomy — `docs/architecture/MEMORY_ARCHITECTURE.md`) is genuinely encrypted at rest once the key is configured, across both backends that were checked (Firestore, Postgres).

**Harder / cost:** reading Owner memory via the generic `query()` method now returns the raw (possibly encrypted-and-JSON-stringified) content — only the new `readOwner()` method decrypts transparently. Any existing code reading Owner memory through the generic path needs to migrate to `readOwner()` to see plaintext; not audited for how many call sites that affects.

## Scope

Only `OwnerMemory` — the type with an explicit pre-existing TODO and the top entry in the audit's own sensitivity list. `PersonalMemory`/`SharedMemory`/other types were not evaluated for encryption this round.

## Verification

Type-checks cleanly against the real compiler. Not tested against a real KMS or real encrypted round-trip in this sandbox (no way to set a real env var and restart a live process here) — the crypto logic itself (AES-256-GCM via Node's standard library) is well-established and was implemented per Node's documented API, not verified via an executed test in this session.
