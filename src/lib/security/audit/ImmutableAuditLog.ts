/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           NEXUS IMMUTABLE AUDIT LOG — Phase 5                ║
 * ║  Cryptographic append-only audit trail for all system ops.   ║
 * ║  Every sensitive action is permanently recorded.             ║
 * ║  Tamper detection via hash chain (blockchain-like).          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * WHAT IS LOGGED:
 *  - All auth events (login, logout, failed attempts)
 *  - All ABAC denials
 *  - All agent executions with results
 *  - All tool executions requiring approval
 *  - All memory writes (owner/restricted types)
 *  - All admin API calls
 *  - All fraud detections
 *  - All config changes
 *
 * USAGE:
 *   await AuditLog.record('auth.login.success', subject, { ip, userAgent });
 *   await AuditLog.record('fraud.detected', subject, { riskScore, decision });
 *   const chain = await AuditLog.verifyChain(100); // verify last 100 records
 */

import crypto from 'crypto';
import { logger } from '../../core/logging/NexusLogger';
import { EventBus } from '../../core/events/NexusEventBus';
import { NexusConfig } from '../../core/config/NexusConfig';

const log = logger.child('AuditLog');
const IS_SERVER = typeof window === 'undefined';

// ── Audit entry ───────────────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  sequence: number;           // Monotonically increasing sequence number
  timestamp: number;
  eventType: AuditEventType;
  severity: 'info' | 'warn' | 'critical';
  subject: {
    id: string;               // userId or agentId
    type: 'user' | 'agent' | 'system';
    ip?: string;
    tenantId?: string;
  };
  action: string;
  resource?: string;
  outcome: 'success' | 'failure' | 'denied' | 'flagged';
  detail: Record<string, any>;
  hash: string;               // SHA-256 of this entry's content
  prevHash: string;           // Previous entry's hash (chain integrity)
  signature?: string;         // HMAC signature with OWNER_SECRET
}

export type AuditEventType =
  | 'auth.login.success' | 'auth.login.failed' | 'auth.logout'
  | 'auth.token.issued' | 'auth.token.revoked'
  | 'abac.denied' | 'abac.allowed'
  | 'agent.executed' | 'agent.failed' | 'agent.approval.requested'
  | 'tool.executed' | 'tool.denied' | 'tool.approval.required'
  | 'memory.written' | 'memory.read' | 'memory.deleted' | 'memory.denied'
  | 'fraud.detected' | 'fraud.blocked'
  | 'security.breach_attempt' | 'security.rate_limit_exceeded'
  | 'prompt.injection_detected'
  | 'config.changed' | 'system.boot' | 'system.shutdown'
  | 'payment.confirmed' | 'payment.failed' | 'payment.refunded'
  | 'admin.action' | 'owner.override'
  | string;

// ── Chain integrity ───────────────────────────────────────────────────────
function hashEntry(entry: Omit<AuditEntry, 'hash' | 'signature'>): string {
  const content = JSON.stringify({
    id: entry.id, sequence: entry.sequence, timestamp: entry.timestamp,
    eventType: entry.eventType, subject: entry.subject,
    action: entry.action, outcome: entry.outcome, detail: entry.detail,
    prevHash: entry.prevHash,
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

function signEntry(hash: string): string {
  const secret = IS_SERVER ? (process.env.OWNER_SECRET || 'dev-secret') : 'client-na';
  return crypto.createHmac('sha256', secret).update(hash).digest('hex').slice(0, 16);
}

// ── In-memory ring buffer (persisted async to Firestore/PostgreSQL) ────────
class AuditLogImpl {
  private buffer: AuditEntry[] = [];
  private maxBuffer = 2000;
  private sequence = 0;
  private lastHash = '0'.repeat(64);  // Genesis hash
  private flushQueue: AuditEntry[] = [];
  private flushing = false;

  // ── Record an audit event ──────────────────────────────────────────────
  async record(
    eventType: AuditEventType,
    subject: AuditEntry['subject'],
    detail: Record<string, any> = {},
    options: {
      action?: string;
      resource?: string;
      outcome?: AuditEntry['outcome'];
      severity?: AuditEntry['severity'];
    } = {},
  ): Promise<string> {
    if (!NexusConfig.security.enableAuditLog) return '';

    this.sequence++;
    const partial: Omit<AuditEntry, 'hash' | 'signature'> = {
      id: `audit_${Date.now()}_${this.sequence}`,
      sequence: this.sequence,
      timestamp: Date.now(),
      eventType,
      severity: options.severity ?? this._defaultSeverity(eventType),
      subject,
      action: options.action || eventType,
      resource: options.resource,
      outcome: options.outcome ?? 'success',
      detail: this._sanitizeDetail(detail),
      prevHash: this.lastHash,
    };

    const hash = hashEntry(partial);
    const signature = signEntry(hash);
    const entry: AuditEntry = { ...partial, hash, signature };

    this.lastHash = hash;
    this.buffer.unshift(entry);
    if (this.buffer.length > this.maxBuffer) this.buffer.pop();

    // Async persist
    this.flushQueue.push(entry);
    this._flushAsync();

    // Emit event for real-time monitoring
    if (entry.severity === 'critical') {
      EventBus.emitAsync('security.breach_attempt', {
        auditId: entry.id, eventType, subject, detail,
      }, 'AuditLog');
      log.error(`CRITICAL AUDIT: ${eventType}`, undefined, { auditId: entry.id, subject: subject.id });
    }

    return entry.id;
  }

  // ── Query audit log ────────────────────────────────────────────────────
  query(options: {
    limit?: number;
    eventType?: AuditEventType;
    subjectId?: string;
    severity?: AuditEntry['severity'];
    since?: number;
    outcome?: AuditEntry['outcome'];
  } = {}): AuditEntry[] {
    return this.buffer
      .filter(e => {
        if (options.eventType && e.eventType !== options.eventType) return false;
        if (options.subjectId && e.subject.id !== options.subjectId) return false;
        if (options.severity && e.severity !== options.severity) return false;
        if (options.since && e.timestamp < options.since) return false;
        if (options.outcome && e.outcome !== options.outcome) return false;
        return true;
      })
      .slice(0, options.limit || 100);
  }

  // ── Verify chain integrity ────────────────────────────────────────────
  verifyChain(limit = 100): { valid: boolean; verified: number; firstBrokenAt?: string } {
    const entries = [...this.buffer].slice(0, limit).reverse(); // oldest first
    let prevHash = '0'.repeat(64);
    let verified = 0;

    for (const entry of entries) {
      if (entry.prevHash !== prevHash) {
        log.error('AUDIT CHAIN INTEGRITY VIOLATION', undefined, {
          entryId: entry.id, sequence: entry.sequence,
          expectedPrevHash: prevHash, actualPrevHash: entry.prevHash,
        });
        return { valid: false, verified, firstBrokenAt: entry.id };
      }
      const expectedHash = hashEntry({ ...entry, hash: '', signature: '' } as any);
      if (entry.hash !== expectedHash) {
        log.error('AUDIT ENTRY TAMPERED', undefined, { entryId: entry.id });
        return { valid: false, verified, firstBrokenAt: entry.id };
      }
      prevHash = entry.hash;
      verified++;
    }
    return { valid: true, verified };
  }

  // ── Get stats ─────────────────────────────────────────────────────────
  getStats() {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const e of this.buffer) {
      byType[e.eventType] = (byType[e.eventType] || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    }
    return {
      totalRecords: this.sequence,
      buffered: this.buffer.length,
      lastEntry: this.buffer[0]?.timestamp,
      byType,
      bySeverity,
      chainLastHash: this.lastHash.slice(0, 16) + '...',
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────
  private _defaultSeverity(eventType: AuditEventType): AuditEntry['severity'] {
    if (['fraud.detected', 'fraud.blocked', 'security.breach_attempt',
         'prompt.injection_detected', 'memory.denied', 'abac.denied',
         'owner.override'].includes(eventType)) return 'critical';
    if (['auth.login.failed', 'tool.denied', 'agent.failed',
         'security.rate_limit_exceeded'].includes(eventType)) return 'warn';
    return 'info';
  }

  private _sanitizeDetail(detail: Record<string, any>): Record<string, any> {
    const sanitized = { ...detail };
    // Never log sensitive fields
    const sensitive = ['password', 'token', 'secret', 'apiKey', 'api_key', 'credit_card', 'cvv'];
    for (const key of sensitive) {
      if (key in sanitized) sanitized[key] = '[REDACTED]';
    }
    return sanitized;
  }

  private async _flushAsync(): Promise<void> {
    if (this.flushing || this.flushQueue.length === 0) return;
    this.flushing = true;
    const batch = this.flushQueue.splice(0, 50);

    try {
      // Try PostgreSQL first (append-only, best for audit)
      const { db } = await import('../../../firebase');
      const { collection, writeBatch, doc } = await import('firebase/firestore');
      const wb = writeBatch(db);
      for (const entry of batch) {
        wb.set(doc(collection(db, 'audit_log'), entry.id), entry);
      }
      await wb.commit();
    } catch (_) {
      // Silently fail — audit log write failure should not crash the app
      // Put back in queue for retry
      this.flushQueue.unshift(...batch);
    } finally {
      this.flushing = false;
      if (this.flushQueue.length > 0) {
        setTimeout(() => this._flushAsync(), 1000);
      }
    }
  }
}

export const AuditLog = new AuditLogImpl();

/**
 * Added during CTO Audit Part 3 response (2026-07-19): at least 2 files
 * (PasswordResetService.ts, OwnerControlEngine.ts) import `{ ImmutableAuditLog }`
 * from this file — matching the file's own name — but the real export was always
 * named `AuditLog`. Confirmed by tsc. Adding this alias fixes every caller using
 * either name at once, rather than editing each call site individually (the same
 * class of fix as the notify()/saveInApp() additions to NotificationEngine.ts —
 * see docs/governance/TECHNICAL_DEBT_REGISTER.md).
 */
export const ImmutableAuditLog = AuditLog;

// ── Express audit middleware ───────────────────────────────────────────────
export function auditMiddleware() {
  return (req: any, res: any, next: any) => {
    if (!req.path.startsWith('/api/admin')) { next(); return; }

    const subject: AuditEntry['subject'] = {
      id: req.user?.uid || 'anonymous',
      type: req.user ? 'user' : 'system',
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress,
      tenantId: req.headers['x-tenant-id'],
    };

    res.on('finish', () => {
      const outcome: AuditEntry['outcome'] =
        res.statusCode === 403 ? 'denied' :
        res.statusCode >= 400 ? 'failure' : 'success';

      AuditLog.record('admin.action', subject, {
        method: req.method, path: req.path,
        status: res.statusCode, traceId: req.traceId,
      }, { action: `${req.method} ${req.path}`, outcome });
    });

    next();
  };
}
