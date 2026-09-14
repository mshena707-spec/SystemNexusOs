/**
 * WebhookGuard — Replay Attack Protection for Webhooks
 *
 * WHY: Without timestamp validation, an attacker can:
 *   1. Capture a valid webhook request (e.g., "payment success")
 *   2. Replay it later to trigger duplicate order confirmations
 *   3. Replay it repeatedly to credit loyalty points multiple times
 *
 * vs World-class:
 *   Stripe: requires Stripe-Signature header with timestamp,
 *           rejects requests older than 300 seconds (5 minutes)
 *   BKash:  no built-in replay protection — we add application-level nonce tracking
 *   Twilio: X-Twilio-Signature with URL in HMAC
 *
 * Our implementation:
 *   - Stripe: validates Stripe-Signature + timestamp (300s window)
 *   - BKash: tracks paymentID nonces in Redis/DB (idempotency)
 *   - All: rejects duplicates within 24h window
 */

import crypto from 'crypto';
import { NexusDB } from '../../database/NexusDB';

const NONCE_COLLECTION = 'webhook_nonces';
const NONCE_TTL_SECONDS = 86400; // 24 hours
const STRIPE_TOLERANCE_SECONDS = 300; // 5 minutes (Stripe standard)

export class WebhookGuard {

  // ── Stripe webhook verification ──────────────────────────────────────────

  static verifyStripeSignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
    toleranceSeconds = STRIPE_TOLERANCE_SECONDS
  ): { valid: boolean; error?: string; timestamp?: number } {
    if (!signature) return { valid: false, error: 'Missing Stripe-Signature header' };

    // Parse signature header: t=timestamp,v1=hash[,v0=hash]
    const elements = signature.split(',');
    const timestampEl = elements.find(e => e.startsWith('t='));
    const sigEl = elements.find(e => e.startsWith('v1='));

    if (!timestampEl || !sigEl) return { valid: false, error: 'Invalid signature format' };

    const timestamp = parseInt(timestampEl.slice(2), 10);
    const sig = sigEl.slice(3);

    // Timestamp check — reject if too old
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      return {
        valid: false,
        error: `Webhook timestamp too old (${now - timestamp}s). Possible replay attack.`,
        timestamp,
      };
    }

    // HMAC verification
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    const valid = crypto.timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );

    return { valid, timestamp, error: valid ? undefined : 'Signature mismatch' };
  }

  // ── Nonce-based replay prevention (for BKash, Nagad, etc.) ──────────────

  static async checkAndRecordNonce(
    provider: string,
    nonce: string,  // e.g., BKash paymentID, Nagad merchantOrderId
  ): Promise<{ allowed: boolean; reason?: string }> {
    const nonceKey = `${provider}:${nonce}`;

    try {
      // Check if nonce already seen
      const existing = await NexusDB.get(NONCE_COLLECTION, nonceKey);
      if (existing) {
        return {
          allowed: false,
          reason: `Duplicate webhook nonce [${provider}:${nonce.slice(0, 12)}...] — possible replay attack`,
        };
      }

      // Record nonce with TTL
      await NexusDB.set(NONCE_COLLECTION, nonceKey, {
        provider,
        nonce,
        receivedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + NONCE_TTL_SECONDS * 1000).toISOString(),
      });

      return { allowed: true };
    } catch {
      // DB unavailable — fail open (allow) but log warning
      console.warn(`[WebhookGuard] Could not check nonce for ${provider}:${nonce}`);
      return { allowed: true };
    }
  }

  // ── Nagad webhook HMAC verification ─────────────────────────────────────

  static verifyNagadSignature(
    payload: Record<string, unknown>,
    receivedSignature: string,
    merchantPrivateKey: string
  ): boolean {
    try {
      const message = JSON.stringify(payload);
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(message);
      return verify.verify(merchantPrivateKey, receivedSignature, 'base64');
    } catch {
      return false;
    }
  }

  // ── Facebook/Meta webhook verification ───────────────────────────────────

  static verifyFacebookSignature(
    payload: string,
    signature: string,  // X-Hub-Signature-256: sha256=xxxx
    appSecret: string
  ): boolean {
    if (!signature?.startsWith('sha256=')) return false;
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(payload).digest('hex')}`;
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  // ── Cleanup old nonces ───────────────────────────────────────────────────

  static async cleanupExpiredNonces(): Promise<number> {
    const now = new Date().toISOString();
    const expired = await NexusDB.find(NONCE_COLLECTION, {
      where: [{ field: 'expiresAt', op: '<=', value: now }],
      limit: 500,
    });
    await Promise.all(expired.map(n => NexusDB.delete(NONCE_COLLECTION, (n as Record<string, unknown>).id as string)));
    return expired.length;
  }
}
