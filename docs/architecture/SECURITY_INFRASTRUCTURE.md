# Security & Infrastructure

**Status of this document:** ✅ Answers CTO Audit Part 4 in full. Same standard as Parts 1-3: every claim checked against real code, corrections made where the audit's framing didn't match, new capabilities built for confirmed real gaps.

## The headline finding

**Much of this audit's "critical priority" list was already built — in Parts 1 and 3 of this same series**, before Part 4 was received:
- §6 Prompt Injection Protection ("the biggest risk") → `PromptShield` (Part 3), wired into the AI hot path
- §7 Memory Poisoning / Learning Approval Queue → `LearningApprovalGate` (Part 3)
- §9 Immutable Audit Log → `ImmutableAuditLog` (Part 1, bug-fixed in Part 3)

This isn't a coincidence — Part 3 (AI & Multi-Agent) and Part 4 (Security & Infrastructure) genuinely overlap where AI security is concerned, and this series processes them in order. What's below focuses on what's **actually new or corrected** in Part 4, not re-describing work already documented in `docs/AUDIT_RESPONSE_PART3.md`.

## §1 Security Philosophy — confirmed accurate

The audit's own distinction ("Design and Implementation are not the same thing... many security components exist as Rules, but system-wide enforcement is not complete") is fair and matches this entire series' pattern: real security primitives exist (`ABACEngine`, `TenantIsolation`, `AnomalyDetectionEngine` — see below), inconsistently wired to every path that should use them. No correction needed to this section.

## §2 Authentication — partially correct

The audit recommends a unified Identity Service for User/Admin/Owner/AI Agent/API. Confirmed: `JWTService.ts`, `TOTPService.ts` (2FA), `DeviceFingerprint.ts`, `AnomalyDetectionEngine.ts` exist as **separate**, not unified, modules — the audit's concern is real. Not built this round (a real Identity Service consolidation is a significant refactor of live auth code, higher-risk than this round's other changes — flagged for a dedicated round rather than rushed).

**Built this round, adjacent:** `SecretVault` (§5) now mediates the JWT signing secret specifically — a step toward "AI Agent will never get Raw Secret," proven on real, security-critical code rather than a toy example.

## §3 Authorization (RBAC + ABAC) — ABAC confirmed real, RBAC confirmed absent as a named layer

`ABACEngine` (378 lines, documented in Part 1's `SYSTEM_SECURITY.md`) is real and substantial. A **separate, named RBAC class does not exist** — confirmed by search. Whether this is a real gap depends on what ABAC already covers: attribute-based access control can express role-based rules as a special case (an attribute like `role: 'owner'` checked in a policy), so "RBAC is missing" may overstate the gap if `ABACEngine`'s policies already encode role checks. Not independently verified this round which is true — recommend reading `ABACEngine.ts`'s actual policy definitions directly before deciding whether a distinct RBAC layer is worth building or whether it's already subsumed.

## §4 Agent Permission Matrix — extended

Part 3 already added `allowedAPIs`, `allowedAgents`, `confidenceThreshold`, `escalationRules` to `AgentCapabilities`, alongside the pre-existing `memoryAccess`/`canUseTools`. This round adds the three still missing per the audit's exact list: `fileAccess`, `networkAccess`, `deletePermission` — all optional, defaulting to the restrictive/safe reading when unset. Also added `learningPermission`, and — unlike the other new fields, which are declared metadata — **this one is actually enforced**: `LearningApprovalGate.submit()` now checks it via `AgentRegistry.resolve()` and blocks submission outright if a registered agent has explicitly set `learningPermission: false`.

## §5 Secret Management — built

Confirmed critical gap: 25 files read secret-shaped env vars (`*_KEY`, `*_SECRET`, `*_PASSWORD`, `*_TOKEN`) directly via `process.env`, no vault, no masking, no access log.

**Built:** `src/lib/security/vault/SecretVault.ts`. The audit's core rule — "AI Agent will never get Raw Secret" — is enforced by caller type, not convention: `get()` throws if the caller declares itself as `'agent'` or `'tool'`. Agent-reachable code gets `hasSecret()` (boolean) or `getMasked()` (first-3/last-4 chars) instead. Every raw access is logged to the real `ImmutableAuditLog`, not a separate channel.

**Scope, stated honestly:** this does not migrate all 25 existing call sites — that's a real, higher-risk change than this round should make unilaterally on live secrets handling. Retrofitted onto one real, security-critical example (`JWTService.ts`'s `getSecret()`) to prove the pattern works, with the same JWT_SECRET-then-OWNER_SECRET fallback behavior preserved exactly. The other 24 files are a documented migration, not yet done — see the Technical Debt Register.

## §6 Prompt Injection — already built (Part 3)

See `docs/adr/0011-prompt-shield.md` and `AI_MULTI_AGENT_ARCHITECTURE.md` §16. The audit's proposed flow (Prompt Shield → Instruction Filter → Risk Analyzer → Policy Check → Sanitized Prompt → LLM) matches `PromptShield.inspect()`'s real implementation reasonably closely, though as one function with categorized pattern-matching rather than five separate named stages.

## §7 Memory Poisoning — already built (Part 3)

See `docs/adr/0013-learning-approval-gate.md`. The audit's proposed flow (Conversation → Candidate Knowledge → Validation → Confidence → Approval → Memory) matches `LearningApprovalGate.submit()` closely: confidence-checked, then either committed or queued for explicit approval — not the full "Validation" as a separate named stage, but the substance is there.

## §8 Output Firewall — extended

Confirmed real (Part 3): `PromptShield.filterSensitiveData()` covered credit cards, emails, API-key-shaped strings, Bangladesh phone numbers. **Built this round:** bank account / routing-number patterns (Financial Leak Detection), a marker check for the actual names of this system's own secret env vars appearing in output (Owner Data Detection — the var *name* leaking is a signal even without a value), and a genuinely new, output-side prompt-leak check (distinct from §6's input-side check — this catches the AI's *response* containing system-prompt-shaped content, which can happen without a successful injection attempt).

## §9 Immutable Audit Log — already built (Part 1), fields partially extended

`ImmutableAuditLog`/`AuditLog` (Part 1, export-name bug fixed in Part 3) already covers Timestamp, Actor (`subject.id`/`type`), Action (`eventType`), IP (`subject.ip`). **Not currently first-class fields:** Risk Score and a direct Memory-entry reference — both currently have to go into the generic `detail` object rather than a typed field. Not extended this round (adding typed fields to a write-once audit schema that may already have real production entries is a higher-risk migration than this round's other additive changes) — flagged as a real, precise gap rather than guessed at.

## §10 Threat Detection — mostly already real

`AnomalyDetectionEngine.ts` already covers: login anomaly checks, request-rate analysis (Rate Analysis), failed-login lockout (Repeated Failure, Credential Abuse), AI-misuse detection (adjacent to Suspicious Agent), token/device-mismatch detection. **Confirmed genuinely not covered:** a named "Attack Pattern" concept broader than the individual checks, and "API Abuse" as distinct from general rate limiting. Not built this round — both would benefit from real traffic data to design against rather than being guessed at from first principles.

## §11 API Security / API Gateway — confirmed scattered, not consolidated

The audit's proposed pipeline (Auth → Rate Limit → Validation → Threat Scan → Routing → Logging → Response) exists as real, individual pieces (`SecurityMiddleware.ts`'s rate limiters, `requireAdmin`/`requireAuth`, `InputValidator.ts`) but applied ad hoc across 196 routes in a 3,724-line `server.ts`, not as one named, enforced pipeline. Not consolidated this round — restructuring how 196 routes register their middleware is a large, high-blast-radius refactor appropriate for a dedicated round, not a documentation-audit response. Recommend: this is the natural next large infrastructure project once the no-test-suite gap (`docs/governance/FEATURE_STATUS.md`) is closed, so the refactor can be verified against real request tests.

## §12 & §13 Tool Security / Sandboxed Execution — extended, and scoped honestly

Part 3 already added `owner`/`riskLevel`/`retryPolicy` to `ToolDefinition`. This round adds `resourceAccess` (declares what a tool touches — database/network/filesystem/payment/none).

**On sandboxing, stated precisely:** the 20+ existing tools are pre-compiled TypeScript functions: there is no technical way in Node.js to retroactively sandbox an already-compiled function reference (`vm.Script` sandboxes *string* code evaluated at runtime, not existing closures). `src/lib/orchestration/tools/ToolSandbox.ts` (new) provides a real, restricted `vm`-based execution context for the case that's actually sandboxable — a future tool that evaluates a dynamic expression/formula. No existing tool does this today (confirmed by search) — this is ready infrastructure, not a retrofit of something that needed it. Also stated in the file's own header: Node's built-in `vm` is not a true security boundary (Node's own docs note context-escape risks) — real untrusted-code isolation needs `isolated-vm` or a separate process, neither addable without network access in this sandbox.

## §14 Encryption — built

Confirmed gap: `OwnerMemory`'s write path had a literal `// In production: encrypt this field` comment. **Built:** `src/lib/memory/MemoryEncryption.ts`, AES-256-GCM via Node's built-in `crypto`, keyed through `SecretVault` (§5) rather than a raw env read. Wired into `writeOwner()` for both the Firestore and Postgres write paths (a real bug was caught and fixed in the process — see Technical Debt Register) and a new `readOwner()` method for symmetric decryption. Degrades gracefully (unencrypted + logged warning) if `MEMORY_ENCRYPTION_KEY` isn't configured, rather than hard-failing writes — stated as a deliberate choice in the code, not silently assumed safe.

**Scope:** only `OwnerMemory` — the type the audit's own §14 example lists first and the one with an explicit TODO comment already pointing at it. `PersonalMemory`/`SharedMemory`/other types were not evaluated for encryption this round.

## §15 & §20 Zero Trust — correctly deferred, not built

Both sections are explicitly framed by the audit as "for the future" / "step by step." Agreed: Zero Trust ("never trust, always verify" for every internal request) is an architectural stance affecting how every service-to-service call works, not a bolt-on. Building it well needs the API Gateway consolidation (§11) as a prerequisite. Correctly out of scope for this round; not attempted.

## §16 & §17 Infrastructure / Monitoring — confirmed stronger than credited

`docker-compose.yml`: all 7 services already use `restart: unless-stopped` — the audit's "Missing: Auto Restart" doesn't hold up against the actual compose file. A real `/api/metrics` endpoint already exposes EventBus, AI provider health, TaskQueue, and audit-log stats in genuine Prometheus text format. **Confirmed still missing:** Redis-specific and Vector-DB-specific metrics in that endpoint, and Docker health checks beyond the 4 found in Part 1 (`docs/architecture/DISASTER_RECOVERY.md`). Not built this round.

## §18 & §19 Backup Strategy / Disaster Recovery — already documented (Part 1)

`docs/architecture/DISASTER_RECOVERY.md` already covers the real backup/restore routes (including a dry-run restore path) and already flags the exact gap the audit names here: no defined RPO/RTO, no confirmed off-host backup storage. Nothing new found this round beyond what Part 1 already documented — re-read that file rather than treating this as a fresh gap.

## Summary: what's genuinely new after this round

Built: `SecretVault`, `MemoryEncryption`, `ToolSandbox`, 3 new `AgentCapabilities` permission fields (+1 enforced), `resourceAccess` on tools, 3 new Output Firewall pattern categories. Confirmed-but-deferred: Identity Service unification (§2), typed audit-log risk-score/memory fields (§9), API Gateway consolidation (§11), Zero Trust (§15/§20) — all flagged as real, appropriately larger, higher-risk changes for a dedicated round rather than rushed into this one.
