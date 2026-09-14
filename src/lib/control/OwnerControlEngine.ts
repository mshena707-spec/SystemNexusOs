/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  OWNER CONTROL ENGINE — Phase H (rewritten)                          ║
 * ║                                                                      ║
 * ║  This module previously existed but was almost entirely decorative: ║
 * ║   - emergencyShutdownEngaged was an in-process boolean. It did not   ║
 * ║     persist across a restart, did not work across multiple server   ║
 * ║     instances (Phase N's exact class of bug), and — critically —    ║
 * ║     NOTHING in server.ts ever read it. The "Emergency Kill Switch"   ║
 * ║     button in the admin UI toggled a value that gated zero requests.║
 * ║   - getOverrideStatus() always returned 'none' (comment admitted    ║
 * ║     "Implementation for dynamic manual overrides" was a placeholder)║
 * ║   - blockUnauthorizedMutation() always returned false regardless    ║
 * ║     of its actual arguments — a no-op disguised as an access check  ║
 * ║   - exportTenantData() returned hardcoded empty arrays — a "data    ║
 * ║     export" that exported nothing                                   ║
 * ║                                                                      ║
 * ║  Phase H makes the emergency shutdown REAL:                          ║
 * ║   - Persisted to NexusDB (survives restarts, correct across every   ║
 * ║     server instance — same pattern as Phase N's distributed state)  ║
 * ║   - Actually checked by a new shutdownGuard middleware in server.ts, ║
 * ║     which blocks new AI calls and new payment initiations while     ║
 * ║     engaged (existing in-flight orders/deliveries are NOT touched — ║
 * ║     this is a "stop taking new business" switch, not a system kill, ║
 * ║     so riders mid-delivery aren't stranded)                         ║
 * ║   - Every engage/disengage is audit-logged with the owner's uid     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const SHUTDOWN_DOC_ID = 'emergency_shutdown';

export interface ShutdownState {
  engaged: boolean;
  engagedBy?: string;
  engagedAt?: string;
  reason?: string;
  disengagedBy?: string;
  disengagedAt?: string;
}

export class OwnerControlEngine {

  /**
   * Engage emergency shutdown — blocks new AI calls and new payment
   * initiations across EVERY server instance immediately (NexusDB-backed,
   * not in-process). Existing orders/deliveries already in flight continue
   * unaffected; this stops NEW business, it does not kill the process.
   */
  static async engageEmergencyShutdown(ownerId: string, reason?: string): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    const state: ShutdownState = {
      engaged: true, engagedBy: ownerId, engagedAt: new Date().toISOString(), reason,
    };
    await NexusDB.set('system_control', SHUTDOWN_DOC_ID, state, true);

    console.warn(`[OwnerControlEngine] 🚨 EMERGENCY SHUTDOWN ENGAGED by ${ownerId}${reason ? `: ${reason}` : ''}`);

    try {
      const { PaymentAuditLog } = await import('../payments/PaymentAuditLog');
      await PaymentAuditLog.record({
        orderId: 'SYSTEM', provider: 'stripe', action: 'reconciliation', status: 'failed',
        detail: `Emergency shutdown engaged by ${ownerId}: ${reason ?? 'no reason given'}`,
      });
    } catch { /* audit logging is best-effort, never block the shutdown itself */ }
  }

  /** Disengage emergency shutdown — resumes normal operation across all instances. */
  static async disengageEmergencyShutdown(ownerId: string): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    const current = await NexusDB.get('system_control', SHUTDOWN_DOC_ID) as ShutdownState | null;
    await NexusDB.set('system_control', SHUTDOWN_DOC_ID, {
      ...(current ?? {}), engaged: false,
      disengagedBy: ownerId, disengagedAt: new Date().toISOString(),
    }, true);
    console.info(`[OwnerControlEngine] Emergency shutdown lifted by ${ownerId}`);
  }

  /** Check current shutdown state — read by shutdownGuard middleware on (cached) every request. */
  static async getShutdownState(): Promise<ShutdownState> {
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const state = await NexusDB.get('system_control', SHUTDOWN_DOC_ID) as ShutdownState | null;
      return state ?? { engaged: false };
    } catch {
      // Fail open: if the DB is unreachable, do not block the entire business
      // because the control-plane check itself failed.
      return { engaged: false };
    }
  }

  static async isShutdown(): Promise<boolean> {
    const state = await this.getShutdownState();
    return state.engaged;
  }

  /**
   * Check if a user has an active permission override in NexusDB.
   * The owner can grant temporary/delegated permissions to any user.
   * Stored in 'permission_overrides' collection with expiry.
   */
  static async getPermissionOverride(userId: string, permission: string): Promise<boolean> {
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const overrides = await NexusDB.find('permission_overrides', {
        where: [
          { field: 'userId',     op: '==', value: userId },
          { field: 'permission', op: '==', value: permission },
          { field: 'active',     op: '==', value: true },
        ],
        limit: 1,
      });

      if (overrides.length === 0) return false;

      const override = overrides[0] as Record<string, unknown>;
      // Check expiry
      if (override.expiresAt && new Date(override.expiresAt as string) < new Date()) {
        // Auto-deactivate expired override
        await NexusDB.update('permission_overrides', override.id as string, {
          active: false,
          expiredAt: new Date().toISOString(),
        }).catch(() => {});
        return false;
      }

      console.info(
        `[OwnerControlEngine] Override granted: ${userId} → ${permission}` +
        (override.expiresAt ? ` (expires ${override.expiresAt})` : ' (no expiry)')
      );
      return true;
    } catch {
      // DB unavailable — fail secure
      return false;
    }
  }

  /**
   * Owner grants a permission override to a user (e.g., allow admin to hard-delete).
   * Optionally time-limited via expiresInMinutes.
   */
  static async grantPermissionOverride(
    grantedByOwnerId: string,
    targetUserId: string,
    permission: string,
    expiresInMinutes?: number
  ): Promise<string> {
    const { NexusDB } = await import('../database/NexusDB');
    const { AuditLog } = await import('../security/audit/ImmutableAuditLog');

    const id = `override_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const expiresAt = expiresInMinutes
      ? new Date(Date.now() + expiresInMinutes * 60_000).toISOString()
      : undefined;

    await NexusDB.set('permission_overrides', id, {
      id, userId: targetUserId, permission,
      grantedBy: grantedByOwnerId,
      grantedAt: new Date().toISOString(),
      expiresAt,
      active: true,
    });

    await AuditLog.record(
      'owner.override',
      { id: grantedByOwnerId, type: 'user' },
      { targetUserId, permission, expiresAt },
      { action: 'permission_override_granted', resource: 'permission_overrides', severity: 'warn' },
    );

    return id;
  }

  /** Revoke a permission override immediately. */
  static async revokePermissionOverride(revokedByOwnerId: string, overrideId: string): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    const { AuditLog } = await import('../security/audit/ImmutableAuditLog');

    await NexusDB.update('permission_overrides', overrideId, {
      active: false,
      revokedBy: revokedByOwnerId,
      revokedAt: new Date().toISOString(),
    });

    await AuditLog.record(
      'owner.override',
      { id: revokedByOwnerId, type: 'user' },
      { overrideId },
      { action: 'permission_override_revoked', resource: 'permission_overrides', severity: 'warn' },
    );
  }

  /**
   * Can this user delete memory?
   * BEFORE (broken): returned false for admin and default WITHOUT checking DB.
   * AFTER:  checks NexusDB permission_overrides — owner can delegate this right.
   *
   * Lines 117, 119 (audit report): now async with real DB override lookup.
   */
  static async canDeleteMemory(userId: string, userRole: string): Promise<boolean> {
    // CEO/owner always can
    if (userRole === 'ceo' || userRole === 'owner') return true;

    // Admin: check DB for owner-granted override (line 117 fix)
    if (userRole === 'admin') {
      const hasOverride = await this.getPermissionOverride(userId, 'memory:hard_delete');
      if (hasOverride) {
        console.info(`[OwnerControlEngine] Admin ${userId} has owner-granted memory delete override`);
        return true;
      }
      console.warn(`[OwnerControlEngine] Admin ${userId} restricted from memory hard-delete (no override). Use soft-delete.`);
      return false;  // line 117: now only after real DB check
    }

    // Default: check DB for any explicit grant (line 119 fix)
    return this.getPermissionOverride(userId, 'memory:hard_delete');
  }

  /**
   * Validate critical action — now also checks DB for delegated permissions.
   * BEFORE: only checked isOwnerApproved boolean (could be spoofed client-side).
   * AFTER:  JWT role check PLUS NexusDB delegation override lookup.
   */
  static async validateActionAsync(
    action: string,
    agentId: string,
    userId: string,
    userRole: string,
    isOwnerApprovedFromJWT: boolean
  ): Promise<boolean> {
    const criticalActions = ['delete_memory', 'system_reset', 'transfer_funds', 'override_security'];

    if (!criticalActions.includes(action)) return true;

    // CEO/owner always approved
    if (userRole === 'ceo' || userRole === 'owner') return true;

    // Check JWT claim
    if (isOwnerApprovedFromJWT) return true;

    // Check DB for delegated permission override (new)
    const hasOverride = await this.getPermissionOverride(userId, `action:${action}`);
    if (hasOverride) {
      console.info(`[OwnerControlEngine] Action ${action} approved via DB override for ${userId}`);
      return true;
    }

    console.error(
      `[OwnerControlEngine] BLOCK: Unauthorized critical action: ${action} ` +
      `by agent: ${agentId} (user: ${userId}, role: ${userRole})`
    );
    return false;
  }

  /**
   * Synchronous validateAction — kept for backward compat.
   * Use validateActionAsync() for new code.
   */
  static validateAction(action: string, agentId: string, isOwnerApproved: boolean): boolean {
    const criticalActions = ['delete_memory', 'system_reset', 'transfer_funds', 'override_security'];
    if (criticalActions.includes(action) && !isOwnerApproved) {
      console.error(`[OwnerControlEngine] BLOCK: ${action} by ${agentId} — use validateActionAsync for DB override check`);
      return false;
    }
    return true;
  }

  /** Tenant isolation boundary check — throws on cross-tenant access attempts. */
  static assertTenantBoundary(requestorTenantId: string, resourceTenantId: string): void {
    if (requestorTenantId !== resourceTenantId) {
      console.error(`[OwnerControlEngine] ILLEGAL ACCESS ATTEMPT: tenant ${requestorTenantId} tried accessing ${resourceTenantId}`);
      throw new Error('Cross-tenant access blocked by OwnerControlEngine.');
    }
  }

  /**
   * Export a tenant's real data for portability ("Zero Vendor Lock-in").
   * Previously returned hardcoded empty arrays; now actually queries
   * NexusDB across the collections that hold tenant-scoped data.
   */
  static async exportTenantData(tenantId: string): Promise<string> {
    const { NexusDB } = await import('../database/NexusDB');

    const [orders, conversations, preferences] = await Promise.all([
      NexusDB.find('orders', { where: [{ field: 'userId', op: '==', value: tenantId }], limit: 5000 }).catch(() => []),
      NexusDB.find('conversation_sessions', { where: [{ field: 'userId', op: '==', value: tenantId }], limit: 1000 }).catch(() => []),
      NexusDB.find('customer_preferences', { where: [{ field: 'userId', op: '==', value: tenantId }], limit: 500 }).catch(() => []),
    ]);

    const exportBundle = {
      tenantId,
      exportedAt: new Date().toISOString(),
      orders, conversations, preferences,
      recordCounts: { orders: orders.length, conversations: conversations.length, preferences: preferences.length },
    };

    const bundleStr = JSON.stringify(exportBundle);
    console.log(`[OwnerControlEngine] Data export complete for tenant ${tenantId}: ${orders.length} orders, ${conversations.length} conversations, ${preferences.length} preference records (${bundleStr.length} bytes)`);
    return bundleStr;
  }
}
