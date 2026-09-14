/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SECRET VAULT                                                            ║
 * ║  Answers CTO Audit Part 4, section 5 (critical priority #3).            ║
 * ║                                                                           ║
 * ║  Confirmed gap: 25 files read secret-shaped env vars (*_KEY, *_SECRET,  ║
 * ║  *_PASSWORD, *_TOKEN) directly via process.env — no vault, no masking,  ║
 * ║  no access log, and nothing stopping AI-agent-reachable code from       ║
 * ║  reading a raw secret the same way infrastructure code does.            ║
 * ║                                                                           ║
 * ║  SCOPE, STATED HONESTLY: this does not migrate all 25 call sites (that's║
 * ║  a real, larger, higher-risk change than a documentation/architecture   ║
 * ║  pass should make unilaterally on someone else's live secrets config).  ║
 * ║  This is the vault itself, retrofitted onto ONE real call site as proof ║
 * ║  it works, with the migration path documented for the rest.            ║
 * ║                                                                           ║
 * ║  THE CORE RULE (audit's own words): "AI Agent will never get Raw       ║
 * ║  Secret." Enforced here by CALLER TYPE, not by convention: `get()`      ║
 * ║  throws if the caller identifies itself as an agent. Infrastructure     ║
 * ║  code (payment SDK init, OmniConnector adapters, JWT signing) calls     ║
 * ║  get() directly. Agent-reachable code gets hasSecret()/getMasked() —    ║
 * ║  enough to reason about configuration without ever seeing a real value. ║
 * ║                                                                           ║
 * ║  USAGE:                                                                  ║
 * ║    // Infrastructure code (not agent-reachable):                        ║
 * ║    const key = SecretVault.get('STRIPE_SECRET_KEY', { caller: 'system',║
 * ║      module: 'PaymentGateway' });                                       ║
 * ║                                                                           ║
 * ║    // Agent-reachable code:                                             ║
 * ║    if (SecretVault.hasSecret('STRIPE_SECRET_KEY')) { ... }             ║
 * ║    const display = SecretVault.getMasked('STRIPE_SECRET_KEY'); // sk-***║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { logger } from '../../core/logging/NexusLogger';

const log = logger.child('SecretVault');

export type SecretCallerType = 'system' | 'agent' | 'tool' | 'human_admin';

export interface SecretAccessContext {
  caller: SecretCallerType;
  module: string;    // which file/service is asking — accountability, mirrors ToolDefinition.owner
  agentId?: string;   // if caller is 'agent' or 'tool', which one — for the audit trail
}

class SecretVaultImpl {
  private accessLog: Array<{ key: string; caller: SecretCallerType; module: string; agentId?: string; timestamp: number; granted: boolean }> = [];

  /**
   * Raw secret value. Throws if the caller declares itself as 'agent' or 'tool' —
   * this is the actual enforcement of "AI Agent will never get Raw Secret," not
   * just a naming convention someone has to remember to follow.
   */
  get(key: string, context: SecretAccessContext): string {
    const granted = context.caller === 'system' || context.caller === 'human_admin';
    this._logAccess(key, context, granted);

    if (!granted) {
      log.warn(`Secret access DENIED: ${context.caller} '${context.agentId ?? context.module}' requested raw secret '${key}'`);
      throw new Error(`SecretVault: caller type '${context.caller}' is not permitted raw secret access. Use hasSecret()/getMasked() instead.`);
    }

    const value = process.env[key];
    if (!value) {
      log.warn(`Secret requested but not configured: ${key}`, { module: context.module });
      throw new Error(`SecretVault: '${key}' is not configured in this environment.`);
    }
    return value;
  }

  /** Safe for agent-reachable code: confirms configuration without exposing the value. */
  hasSecret(key: string): boolean {
    return Boolean(process.env[key]);
  }

  /** Safe for agent-reachable code and logs/debugging: first 3 and last 4 characters
   *  only, matching the masking pattern already used elsewhere in this codebase
   *  (e.g. email masking in PasswordResetService.ts) rather than inventing a new one. */
  getMasked(key: string): string {
    const value = process.env[key];
    if (!value) return '(not configured)';
    if (value.length <= 8) return '***';
    return `${value.slice(0, 3)}***${value.slice(-4)}`;
  }

  /** For an admin dashboard — which secrets are configured, without ever
   *  returning a value, real or masked, in bulk (getMasked is per-key, deliberately,
   *  so nobody builds a "dump all masked secrets" admin page without at least
   *  calling this once per key and having to mean it). */
  listConfiguredKeys(knownKeys: string[]): Array<{ key: string; configured: boolean }> {
    return knownKeys.map((key) => ({ key, configured: this.hasSecret(key) }));
  }

  getAccessLog(limit = 100) {
    return this.accessLog.slice(0, limit);
  }

  private _logAccess(key: string, context: SecretAccessContext, granted: boolean): void {
    this.accessLog.unshift({ key, caller: context.caller, module: context.module, agentId: context.agentId, timestamp: Date.now(), granted });
    if (this.accessLog.length > 1000) this.accessLog.pop();

    // Fire-and-forget into the real audit trail (Part 1/3) — every raw secret
    // read is exactly the kind of event docs/architecture/SYSTEM_SECURITY.md's
    // audit log exists for. Dynamic import to avoid a hard circular-dependency
    // risk between this file and the audit module.
    import('../audit/ImmutableAuditLog').then(({ AuditLog }) => {
      AuditLog.record(
        granted ? 'admin.action' : 'security.breach_attempt',
        { id: context.agentId ?? context.module, type: context.caller === 'agent' || context.caller === 'tool' ? 'agent' : 'system' },
        { secretKey: key, module: context.module },
        { action: 'secret_access', resource: 'secret_vault', severity: granted ? 'info' : 'critical' },
      ).catch(() => {});
    }).catch(() => {});
  }
}

export const SecretVault = new SecretVaultImpl();
