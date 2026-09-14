import { SecretVault } from '../security/vault/SecretVault';
/**
 * PasswordResetService + EmailVerificationService
 *
 * WHY: Without password reset, users who forget passwords are lost customers.
 *      Without email verification, fake accounts flood the system.
 *
 * vs World-class:
 *   Auth0:  magic link + OTP + social login
 *   Clerk:  email OTP, SMS OTP, TOTP, passkey
 *   Firebase Auth: built-in reset email
 *
 * Our implementation:
 *   - Secure HMAC-signed token (64 bytes → 128 hex chars)
 *   - 1-hour expiry (industry standard)
 *   - Single-use (token burned after use)
 *   - Rate limited (3 attempts per email per hour)
 *   - Sends via OmniConnector (email + WhatsApp OTP option)
 */

import crypto from 'crypto';
import { NexusDB } from '../database/NexusDB';
import { ImmutableAuditLog } from '../security/audit/ImmutableAuditLog';

const RESET_COLLECTION    = 'password_reset_tokens';
const VERIFY_COLLECTION   = 'email_verify_tokens';
const RESET_TTL_MS        = 60 * 60 * 1000;        // 1 hour
const VERIFY_TTL_MS       = 24 * 60 * 60 * 1000;   // 24 hours
const OTP_TTL_MS          = 10 * 60 * 1000;         // 10 minutes for OTP
const RATE_LIMIT_WINDOW   = 60 * 60 * 1000;         // 1 hour
const RATE_LIMIT_MAX      = 3;                       // max 3 resets per hour per email

// ── Password Reset ────────────────────────────────────────────────────────────

export class PasswordResetService {

  static async initiateReset(email: string, ipAddress?: string): Promise<{
    success: boolean;
    message: string;  // Always vague to prevent email enumeration
  }> {
    // Rate limit check
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString();
    const recent = await NexusDB.find(RESET_COLLECTION, {
      where: [{ field: 'email', op: '==', value: email.toLowerCase() }],
      orderBy: 'createdAt', orderDir: 'desc', limit: 10,
    }) as Array<{ createdAt: string }>;

    const recentCount = recent.filter(r => r.createdAt >= since).length;
    if (recentCount >= RATE_LIMIT_MAX) {
      // Return success to prevent timing oracle attacks
      return { success: true, message: 'If this email exists, a reset link has been sent.' };
    }

    // Find user
    const users = await NexusDB.find('users', {
      where: [{ field: 'email', op: '==', value: email.toLowerCase() }],
      limit: 1,
    });

    if (users.length === 0) {
      // Same response — don't reveal whether email exists
      return { success: true, message: 'If this email exists, a reset link has been sent.' };
    }

    const user = users[0] as Record<string, unknown>;
    const userId = user.id as string;

    // Generate secure token
    const rawToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHmac('sha256', SecretVault.get('JWT_SECRET', { caller: 'system', module: 'PasswordResetService' }) ?? 'nexus-secret')
      .update(rawToken)
      .digest('hex');

    const tokenId = `rst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

    await NexusDB.set(RESET_COLLECTION, tokenId, {
      id: tokenId, userId, email: email.toLowerCase(),
      tokenHash, used: false, createdAt: new Date().toISOString(),
      expiresAt, ipAddress: ipAddress ?? 'unknown',
    });

    // Send reset email
    const resetUrl = `${process.env.APP_URL}/reset-password?token=${rawToken}&id=${tokenId}`;
    await this.sendResetEmail(email, user.name as string || 'User', resetUrl);

    await ImmutableAuditLog.record(
      'password_reset_initiated',
      { id: userId, type: 'user', ip: ipAddress },
      { email: email.slice(0, 4) + '***', ipAddress },
      { action: 'password_reset_initiated', resource: 'auth', severity: 'warn' },
    );

    return { success: true, message: 'If this email exists, a reset link has been sent.' };
  }

  static async confirmReset(tokenId: string, rawToken: string, newPassword: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const record = await NexusDB.get(RESET_COLLECTION, tokenId) as Record<string, unknown> | null;
    if (!record) return { success: false, error: 'Invalid or expired reset link' };
    if (record.used) return { success: false, error: 'Reset link already used' };
    if ((record.expiresAt as string) < new Date().toISOString()) {
      return { success: false, error: 'Reset link has expired. Please request a new one.' };
    }

    // Verify token
    const expectedHash = crypto.createHmac('sha256', SecretVault.get('JWT_SECRET', { caller: 'system', module: 'PasswordResetService' }) ?? 'nexus-secret')
      .update(rawToken).digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(record.tokenHash as string, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
    if (!isValid) return { success: false, error: 'Invalid reset token' };

    // Hash new password (bcrypt-style via crypto)
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(newPassword, salt, 64).toString('hex');
    const passwordHash = `${salt}:${hash}`;

    // Update password + mark token used
    await Promise.all([
      NexusDB.update('users', record.userId as string, {
        passwordHash, passwordChangedAt: new Date().toISOString(),
      }),
      NexusDB.update(RESET_COLLECTION, tokenId, {
        used: true, usedAt: new Date().toISOString(),
      }),
    ]);

    await ImmutableAuditLog.record(
      'password_reset_confirmed',
      { id: record.userId as string, type: 'user' },
      {},
      { action: 'password_reset_confirmed', resource: 'auth', severity: 'critical' },
    );

    return { success: true };
  }

  private static async sendResetEmail(email: string, name: string, url: string): Promise<void> {
    const subject = 'Reset your Nexus OS password';
    const body = `Hi ${name},\n\nYou requested a password reset. Click the link below (valid 1 hour):\n\n${url}\n\nIf you didn't request this, please ignore this email.\n\nNexus OS Team`;
    try {
      const { OmniConnector } = await import('../integrations/OmniConnector');
      await OmniConnector.sendManual('email', email, body, { subject });
    } catch {
      console.warn('[PasswordReset] Could not send email — check email provider config');
    }
  }
}

// ── Email Verification ────────────────────────────────────────────────────────

export class EmailVerificationService {

  static async sendVerificationOTP(userId: string, email: string): Promise<void> {
    const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit OTP
    const otpHash = crypto.createHmac('sha256', SecretVault.get('JWT_SECRET', { caller: 'system', module: 'PasswordResetService' }) ?? 'nexus-secret')
      .update(otp).digest('hex');

    const id = `ev_${userId}_${Date.now()}`;
    await NexusDB.set(VERIFY_COLLECTION, id, {
      id, userId, email, otpHash, verified: false,
      attempts: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    });

    // Send OTP
    try {
      const { OmniConnector } = await import('../integrations/OmniConnector');
      await OmniConnector.sendManual('email', email,
        `Your Nexus OS verification code is: ${otp}\n\nThis code expires in 10 minutes.`,
        { subject: 'Verify your email address' });
    } catch {
      console.warn('[EmailVerify] Could not send OTP email');
    }
  }

  static async verifyOTP(userId: string, otp: string): Promise<{ success: boolean; error?: string }> {
    const tokens = await NexusDB.find(VERIFY_COLLECTION, {
      where: [{ field: 'userId', op: '==', value: userId }, { field: 'verified', op: '==', value: false }],
      orderBy: 'createdAt', orderDir: 'desc', limit: 5,
    }) as Array<Record<string, unknown>>;

    const valid = tokens.find(t =>
      (t.expiresAt as string) > new Date().toISOString() &&
      (t.attempts as number) < 5
    );
    if (!valid) return { success: false, error: 'No active OTP found. Please request a new one.' };

    // Rate limit attempts
    await NexusDB.incrementField(VERIFY_COLLECTION, valid.id as string, 'attempts', 1);

    const expectedHash = crypto.createHmac('sha256', SecretVault.get('JWT_SECRET', { caller: 'system', module: 'PasswordResetService' }) ?? 'nexus-secret')
      .update(otp).digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(valid.otpHash as string, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );

    if (!isValid) return { success: false, error: 'Invalid OTP. Please check and try again.' };

    // Mark verified
    await Promise.all([
      NexusDB.update(VERIFY_COLLECTION, valid.id as string, { verified: true, verifiedAt: new Date().toISOString() }),
      NexusDB.update('users', userId, { emailVerified: true, emailVerifiedAt: new Date().toISOString() }),
    ]);

    return { success: true };
  }

  static async isVerified(userId: string): Promise<boolean> {
    const user = await NexusDB.get('users', userId);
    return (user?.emailVerified as boolean) === true;
  }
}
