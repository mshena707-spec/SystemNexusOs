/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  TOOL SANDBOX                                                            ║
 * ║  Answers CTO Audit Part 4, section 13 — scoped honestly, see below.     ║
 * ║                                                                           ║
 * ║  WHAT THIS CAN AND CANNOT DO — read before using or citing this file:   ║
 * ║                                                                           ║
 * ║  The 20+ existing tools in ToolRegistry.ts (registerBuiltInTools()) are  ║
 * ║  pre-written, developer-authored TypeScript functions, compiled into the ║
 * ║  app at build time. There is no technical way to retroactively "sandbox" ║
 * ║  an already-compiled function reference in Node.js — vm.Script/vm.       ║
 * ║  createContext sandbox STRING code evaluated at runtime, not existing    ║
 * ║  function closures. Any file (including this one) that claims to sandbox ║
 * ║  those 20+ tools after the fact would be wrong.                          ║
 * ║                                                                           ║
 * ║  What THIS file actually provides: a real, restricted execution context  ║
 * ║  for DYNAMIC code/expressions — the case that's technically sandboxable  ║
 * ║  and the one "AI tool call" most plausibly means going forward (e.g. a   ║
 * ║  future "evaluate this formula" or "run this calculation" tool taking a  ║
 * ║  string from a user or agent). No existing tool does this today          ║
 * ║  (confirmed by search — no eval/new Function/dynamic code execution      ║
 * ║  found in current tool implementations) — this is ready infrastructure   ║
 * ║  for when one does, not a retrofit of something that needed it.          ║
 * ║                                                                           ║
 * ║  ALSO STATED HONESTLY: Node's built-in `vm` module is NOT a true         ║
 * ║  security boundary — it's documented by Node.js itself as unsafe for     ║
 * ║  running genuinely untrusted code (VM context escapes are a known Node   ║
 * ║  vm limitation). For real untrusted-code isolation, the correct tool is  ║
 * ║  `isolated-vm` (V8 isolates) or moving execution to a separate process   ║
 * ║  with OS-level restrictions — neither could be added in this sandbox     ║
 * ║  (no network to install `isolated-vm`). This file is a real, meaningful  ║
 * ║  improvement over no restriction at all (blocks require/process/fs/      ║
 * ║  network access from evaluated code, enforces a timeout), appropriate    ║
 * ║  for reducing accidental damage from a buggy formula — not sufficient    ║
 * ║  on its own for genuinely adversarial input. See the ADR for the         ║
 * ║  recommended target state (worker_threads with restricted permissions).  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import vm from 'vm';
import { logger } from '../../core/logging/NexusLogger';

const log = logger.child('ToolSandbox');

export interface SandboxResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  timedOutMs?: number;
}

class ToolSandboxImpl {
  /**
   * Evaluates a string expression with no access to require/process/fs/network/
   * globalThis of the host process — only the variables explicitly passed in
   * `context`. Suitable for formula/calculation-style evaluation, not for
   * running arbitrary imported code.
   */
  runRestricted<T = unknown>(code: string, context: Record<string, unknown> = {}, timeoutMs = 1000): SandboxResult<T> {
    const sandbox = vm.createContext({ ...context, console: undefined, require: undefined, process: undefined });
    try {
      const result = vm.runInContext(code, sandbox, { timeout: timeoutMs, displayErrors: false });
      return { success: true, result: result as T };
    } catch (err) {
      const isTimeout = err instanceof Error && /Script execution timed out/.test(err.message);
      log.warn('Sandboxed execution failed', { isTimeout, error: err instanceof Error ? err.message : String(err) });
      return { success: false, error: err instanceof Error ? err.message : String(err), timedOutMs: isTimeout ? timeoutMs : undefined };
    }
  }
}

export const ToolSandbox = new ToolSandboxImpl();
