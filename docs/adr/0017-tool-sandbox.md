# ADR-0017: Tool Sandbox (scoped to dynamic code evaluation)

Status: Accepted, scope deliberately limited — see Consequences

Date: 2026-07-19

## Context

CTO Audit Part 4, section 13: "AI will never Direct File System, Database, OS Access. All tools will run inside the Sandbox." The 20+ existing tools (`ToolRegistry.ts`'s `registerBuiltInTools()`) are pre-written, developer-authored TypeScript functions compiled into the app at build time — not dynamically generated or untrusted code supplied at runtime.

## Decision

**Do not claim to retroactively sandbox the 20+ existing tools** — there is no technical mechanism in Node.js to sandbox an already-compiled function reference; `vm.Script`/`vm.createContext` sandbox *string* code evaluated at runtime, not existing closures. A file claiming otherwise would be documentation theater, not a real control.

Instead: `src/lib/orchestration/tools/ToolSandbox.ts` provides `runRestricted(code, context, timeoutMs)` — a real, `vm`-based restricted execution context (no `require`/`process`/filesystem/network access from evaluated code, enforced timeout) for the case that's actually sandboxable: a future tool that evaluates a dynamic expression or formula. No existing tool does this (confirmed by search) — this is ready infrastructure for when one does.

## Consequences

**Easier:** if/when a "calculate" or "evaluate formula" style tool is added, real restriction is one function call away instead of a new project.

**Harder / cost — stated as prominently as the decision itself:** Node's built-in `vm` module is explicitly documented by Node.js as not a full security boundary (known context-escape risks). This is a real, meaningful improvement over no restriction (reduces accidental damage from a buggy formula) — it is **not sufficient on its own against genuinely adversarial input**. The correct tool for that is `isolated-vm` (V8 isolates) or execution in a separate, OS-restricted process — neither could be added in the sandbox this was built in (no network access to install `isolated-vm`).

**On the 20+ existing tools specifically:** the real control for "AI never directly accesses File System/Database/OS" is that tool implementations should go through governed interfaces (`NexusDB` for data, no direct `fs`/`child_process` in tool code — confirmed true today by search) rather than literal per-call sandboxing. `resourceAccess` (added to `ToolDefinition` in this same round) makes this auditable going forward: a reviewer can check a tool's declared `resourceAccess` against what its code actually touches.

## Follow-up

If genuinely adversarial dynamic code execution becomes a real requirement (not just formula evaluation), revisit with `isolated-vm` or a `worker_threads`-based approach with restricted permissions, in an environment with network access to properly evaluate and install the right dependency.

## Verification

Type-checks cleanly against the real compiler.
