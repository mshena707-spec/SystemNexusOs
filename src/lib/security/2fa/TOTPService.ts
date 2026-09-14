/**
 * TOTPService — Real 2FA via TOTP (RFC 6238)
 *
 * Time-based One-Time Password — same standard as Google Authenticator,
 * Authy, Microsoft Authenticator. No SMS required.
 *
 * Uses: speakeasy (well-audited TOTP library) + qrcode (QR generation)
 * Free forever. Works offline. No phone number required.
 *
 * Flow:
 *   1. User enables 2FA → generateSecret() → show QR code
 *   2. User scans with Google Authenticator
 *   3. User enters 6-digit code → verifyToken() → enable confirmed
 *   4. On every login → verifyToken() with current code
 */

import { NexusDB } from '../../database/NexusDB';
import { ImmutableAuditLog } from '../audit/ImmutableAuditLog';

interface TOTPSecret {
  userId: string;
  secret: string;           // base32 encoded secret (server stores this)
  enabled: boolean;
  confirmedAt?: string;
  backupCodes: string[];    // 8 single-use backup codes
  createdAt: string;
}

export class TOTPService {
  private static readonly TOTP_COLLECTION = 'user_2fa';
  private static readonly ISSUER = process.env.APP_NAME || 'Nexus OS';
  private static readonly WINDOW = 1; // allow 1 step before/after for clock drift

  /** Generate a new TOTP secret for a user. Returns secret + QR code URL. */
  static async generateSecret(userId: string, userEmail: string): Promise<{
    secret: string;
    qrCodeUrl: string;
    manualEntryKey: string;
    backupCodes: string[];
  }> {
    let speakeasy: typeof import('speakeasy');
    let qrcode: typeof import('qrcode');

    try {
      speakeasy = await import('speakeasy');
      qrcode = await import('qrcode');
    } catch {
      throw new Error('2FA dependencies not installed. Run: npm install speakeasy qrcode @types/speakeasy');
    }

    // Generate cryptographically secure secret
    const generated = speakeasy.generateSecret({
      name: `${this.ISSUER} (${userEmail})`,
      issuer: this.ISSUER,
      length: 32,
    });

    // Generate backup codes (8 codes, each 10 chars)
    const backupCodes = Array.from({ length: 8 }, () =>
      Array.from(crypto.getRandomValues(new Uint8Array(5)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );

    // Generate QR code as data URL for display
    const qrCodeUrl = await qrcode.toDataURL(generated.otpauth_url!);

    // Store secret (not yet confirmed/enabled)
    const record: TOTPSecret = {
      userId,
      secret: generated.base32,
      enabled: false,
      backupCodes: backupCodes.map(c => this.hashBackupCode(c)), // store hashed
      createdAt: new Date().toISOString(),
    };

    await NexusDB.set(this.TOTP_COLLECTION, userId, record as unknown as Record<string, unknown>);

    return {
      secret: generated.base32,
      qrCodeUrl,
      manualEntryKey: generated.base32,
      backupCodes, // return plaintext once — user must save these
    };
  }

  /** Verify a TOTP token. Returns true if valid. */
  static async verifyToken(userId: string, token: string): Promise<{
    valid: boolean;
    method: 'totp' | 'backup_code' | 'none';
  }> {
    const record = await NexusDB.get(this.TOTP_COLLECTION, userId) as TOTPSecret | null;
    if (!record || !record.enabled) {
      return { valid: false, method: 'none' };
    }

    // Clean token input
    const cleanToken = token.replace(/\s/g, '');

    // Try TOTP first
    try {
      const speakeasy = await import('speakeasy');
      const valid = speakeasy.totp.verify({
        secret: record.secret,
        encoding: 'base32',
        token: cleanToken,
        window: this.WINDOW,
      });

      if (valid) {
        await ImmutableAuditLog.record(
          '2fa_verify_success',
          { id: userId, type: 'user' },
          { method: 'totp' },
          { resource: 'auth', severity: 'info' },
        );
        return { valid: true, method: 'totp' };
      }
    } catch { /* speakeasy not available */ }

    // Try backup codes (each code is single-use)
    const hashedInput = this.hashBackupCode(cleanToken.toUpperCase());
    const codeIndex = record.backupCodes.indexOf(hashedInput);

    if (codeIndex !== -1) {
      // Remove used backup code
      const newCodes = [...record.backupCodes];
      newCodes.splice(codeIndex, 1);
      await NexusDB.update(this.TOTP_COLLECTION, userId, {
        backupCodes: newCodes,
        lastBackupCodeUsedAt: new Date().toISOString(),
      });

      await ImmutableAuditLog.record(
        '2fa_backup_code_used',
        { id: userId, type: 'user' },
        { remainingCodes: newCodes.length },
        { resource: 'auth', severity: 'warn' },
      );

      return { valid: true, method: 'backup_code' };
    }

    await ImmutableAuditLog.record(
      '2fa_verify_failed',
      { id: userId, type: 'user' },
      { tokenLength: cleanToken.length },
      { resource: 'auth', outcome: 'failure', severity: 'warn' },
    );

    return { valid: false, method: 'none' };
  }

  /** Confirm 2FA setup (user scanned QR and entered first code). */
  static async confirmSetup(userId: string, token: string): Promise<boolean> {
    const record = await NexusDB.get(this.TOTP_COLLECTION, userId) as TOTPSecret | null;
    if (!record || record.enabled) return false;

    try {
      const speakeasy = await import('speakeasy');
      const valid = speakeasy.totp.verify({
        secret: record.secret,
        encoding: 'base32',
        token: token.replace(/\s/g, ''),
        window: this.WINDOW,
      });

      if (valid) {
        await NexusDB.update(this.TOTP_COLLECTION, userId, {
          enabled: true,
          confirmedAt: new Date().toISOString(),
        });
        await ImmutableAuditLog.record(
          '2fa_enabled',
          { id: userId, type: 'user' },
          {},
          { resource: 'auth', severity: 'info' },
        );
        return true;
      }
    } catch { /* speakeasy unavailable */ }

    return false;
  }

  /** Disable 2FA for a user (requires current token to confirm). */
  static async disable(userId: string, token: string): Promise<boolean> {
    const { valid } = await this.verifyToken(userId, token);
    if (!valid) return false;

    await NexusDB.update(this.TOTP_COLLECTION, userId, {
      enabled: false,
      disabledAt: new Date().toISOString(),
    });

    await ImmutableAuditLog.record(
      '2fa_disabled',
      { id: userId, type: 'user' },
      {},
      { resource: 'auth', severity: 'critical' },
    );

    return true;
  }

  /** Check if 2FA is enabled for a user. */
  static async isEnabled(userId: string): Promise<boolean> {
    const record = await NexusDB.get(this.TOTP_COLLECTION, userId) as TOTPSecret | null;
    return record?.enabled === true;
  }

  /** Get 2FA status + remaining backup codes count. */
  static async getStatus(userId: string): Promise<{
    enabled: boolean;
    confirmedAt?: string;
    backupCodesRemaining: number;
  }> {
    const record = await NexusDB.get(this.TOTP_COLLECTION, userId) as TOTPSecret | null;
    return {
      enabled: record?.enabled === true,
      confirmedAt: record?.confirmedAt,
      backupCodesRemaining: record?.backupCodes?.length ?? 0,
    };
  }

  private static hashBackupCode(code: string): string {
    const { createHash } = require('crypto');
    return createHash('sha256')
      .update(code + (process.env.OWNER_SECRET || 'nexus-2fa-salt'))
      .digest('hex');
  }
}

// ── 2FA API Route Handlers (mount in server.ts) ───────────────────────────────

export async function handle2FASetup(userId: string, email: string) {
  return TOTPService.generateSecret(userId, email);
}

export async function handle2FAConfirm(userId: string, token: string) {
  return { success: await TOTPService.confirmSetup(userId, token) };
}

export async function handle2FAVerify(userId: string, token: string) {
  return TOTPService.verifyToken(userId, token);
}

export async function handle2FADisable(userId: string, token: string) {
  return { success: await TOTPService.disable(userId, token) };
}

export async function handle2FAStatus(userId: string) {
  return TOTPService.getStatus(userId);
}
