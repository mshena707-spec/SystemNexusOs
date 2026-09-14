import { SecretVault } from '../security/vault/SecretVault';
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PAYMENT AUDIT LOG — Phase F                                         ║
 * ║                                                                      ║
 * ║  Immutable, append-only log of every payment-related action.        ║
 * ║  Hash-chained for tamper detection (same pattern as                  ║
 * ║  ImmutableAuditLog from the original security module).               ║
 * ║                                                                      ║
 * ║  Every create/verify/refund/settlement/reconciliation event is       ║
 * ║  recorded here. Never updated or deleted.                            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import crypto from 'crypto';
import type { PaymentProvider, Currency } from './IPaymentAdapter';

export type AuditAction = 'create' | 'verify' | 'refund' | 'settlement' | 'reconciliation' | 'webhook';
export type AuditStatus = 'success' | 'failed' | 'pending';

export interface PaymentAuditEntry {
  id?: string;
  orderId: string;
  provider: PaymentProvider;
  action: AuditAction;
  status: AuditStatus;
  detail?: string;
  amount?: number;
  currency?: Currency;
  timestamp: string;
  hash: string;
  prevHash: string;
}

const HMAC_SECRET = SecretVault.get('AUDIT_HMAC_SECRET', { caller: 'system', module: 'PaymentAuditLog' }) ?? SecretVault.get('OWNER_SECRET', { caller: 'system', module: 'PaymentAuditLog' }) ?? 'nexus-payment-audit';

// In-process cache of the last hash (per server instance).
// On restart, _getLastHash() re-derives from the DB.
let _lastHash: string | null = null;

function computeHash(entry: Omit<PaymentAuditEntry, 'hash'>): string {
  const payload = JSON.stringify({
    orderId: entry.orderId, provider: entry.provider, action: entry.action,
    status: entry.status, detail: entry.detail, amount: entry.amount,
    currency: entry.currency, timestamp: entry.timestamp, prevHash: entry.prevHash,
  });
  return crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
}

export class PaymentAuditLog {

  /**
   * Append a new audit entry. Hash-chained to the previous entry.
   */
  static async record(input: {
    orderId: string; provider: PaymentProvider; action: AuditAction; status: AuditStatus;
    detail?: string; amount?: number; currency?: Currency;
  }): Promise<string> {
    const prevHash = await this._getLastHash();
    const timestamp = new Date().toISOString();

    const entryWithoutHash: Omit<PaymentAuditEntry, 'hash'> = {
      ...input, timestamp, prevHash,
    };
    const hash = computeHash(entryWithoutHash);

    const entry: PaymentAuditEntry = { ...entryWithoutHash, hash };

    try {
      const { NexusDB } = await import('../database/NexusDB');
      const id = await NexusDB.add('payment_audit_log', entry);
      _lastHash = hash;
      return id;
    } catch (err) {
      console.error('[PaymentAuditLog] write failed:', err);
      return '';
    }
  }

  /**
   * Get the chain's most recent hash. Falls back to genesis hash if no entries exist.
   */
  private static async _getLastHash(): Promise<string> {
    if (_lastHash) return _lastHash;
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const recent = await NexusDB.find('payment_audit_log', {
        orderBy: 'timestamp', orderDir: 'desc', limit: 1,
      });
      if (recent.length > 0) {
        _lastHash = recent[0].hash;
        return _lastHash!;
      }
    } catch { /* fall through to genesis */ }
    _lastHash = crypto.createHmac('sha256', HMAC_SECRET).update('GENESIS').digest('hex');
    return _lastHash!;
  }

  /**
   * Verify the integrity of the audit chain.
   * Returns the first broken link, or null if the entire chain is valid.
   */
  static async verifyChain(limit = 1000): Promise<{ valid: boolean; brokenAt?: string; checkedCount: number }> {
    const { NexusDB } = await import('../database/NexusDB');
    const entries = await NexusDB.find('payment_audit_log', {
      orderBy: 'timestamp', orderDir: 'asc', limit,
    }) as PaymentAuditEntry[];

    let expectedPrev = crypto.createHmac('sha256', HMAC_SECRET).update('GENESIS').digest('hex');

    for (const entry of entries) {
      if (entry.prevHash !== expectedPrev) {
        return { valid: false, brokenAt: entry.id, checkedCount: entries.length };
      }
      const recomputed = computeHash({
        orderId: entry.orderId, provider: entry.provider, action: entry.action,
        status: entry.status, detail: entry.detail, amount: entry.amount,
        currency: entry.currency, timestamp: entry.timestamp, prevHash: entry.prevHash,
      });
      if (recomputed !== entry.hash) {
        return { valid: false, brokenAt: entry.id, checkedCount: entries.length };
      }
      expectedPrev = entry.hash;
    }

    return { valid: true, checkedCount: entries.length };
  }

  /**
   * Get audit history for a specific order.
   */
  static async getOrderHistory(orderId: string): Promise<PaymentAuditEntry[]> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.find('payment_audit_log', {
      where: [{ field: 'orderId', op: '==', value: orderId }],
      orderBy: 'timestamp', orderDir: 'asc',
    }) as Promise<PaymentAuditEntry[]>;
  }

  /**
   * Get recent audit entries (for admin dashboard).
   */
  static async getRecent(limit = 100): Promise<PaymentAuditEntry[]> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.find('payment_audit_log', {
      orderBy: 'timestamp', orderDir: 'desc', limit,
    }) as Promise<PaymentAuditEntry[]>;
  }
}
