/**
 * audit.ts — Legacy audit log helper (thin wrapper around NexusDB).
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 * For new code prefer ImmutableAuditLog from security/audit/.
 */
import { NexusDB } from './database/NexusDB';

export type AuditActionType =
  | 'PRODUCT_ADDED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_DELETED'
  | 'ORDER_STATUS_CHANGED'
  | 'API_KEY_UPDATED'
  | 'SYSTEM_SETTINGS_CHANGED'
  | 'TASK_SCHEDULED'
  | 'TASK_DELETED'
  | 'TASK_RUN_MANUAL'
  | 'USER_ROLE_UPDATED';

export interface AuditLog {
  action:    AuditActionType;
  details:   string;
  userId:    string;
  userRole?: string;
  timestamp: unknown;
}

export const logAuditAction = async (
  action: AuditActionType,
  details: string,
  userId = 'system',
): Promise<void> => {
  try {
    let userRole = 'system';
    if (userId !== 'system') {
      const userDoc = await NexusDB.get('users', userId);
      userRole = (userDoc?.role as string) ?? 'user';
    }

    await NexusDB.add('audit_logs', {
      action,
      details,
      userId,
      userRole,
      timestamp: NexusDB.serverTimestamp(),
    });

    console.log(`[AuditLog] ${action}: ${details} (User: ${userId}, Role: ${userRole})`);
  } catch (err) {
    console.error('[AuditLog] Failed to write audit log:', err);
  }
};
