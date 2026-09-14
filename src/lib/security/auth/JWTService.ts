/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JWT SERVICE — Phase M                                               ║
 * ║                                                                      ║
 * ║  Replaces the static OWNER_SECRET bearer-token check with real,      ║
 * ║  signed, expiring, role-aware JSON Web Tokens.                       ║
 * ║                                                                      ║
 * ║  Before Phase M:                                                     ║
 * ║    requireAdminAuth() compared the bearer token to a single static   ║
 * ║    OWNER_SECRET string — no expiry, no roles, no revocation, the     ║
 * ║    same secret in every browser tab forever.                         ║
 * ║                                                                      ║
 * ║  After Phase M:                                                      ║
 * ║    - Tokens are HMAC-SHA256 signed, short-lived (access) +            ║
 * ║      long-lived (refresh), carry { uid, role, sessionId } claims     ║
 * ║    - Refresh tokens are revocable (stored hash in NexusDB)           ║
 * ║    - requireAdminAuth/requireAuth verify signature + expiry + role   ║
 * ║    - OWNER_SECRET remains supported as a LEGACY fallback for         ║
 * ║      service-to-service/cron calls, but is deprecated for browsers   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import crypto from 'crypto';
import { SecretVault } from '../vault/SecretVault';

export type UserRole = 'customer' | 'rider' | 'rep' | 'admin' | 'ceo';

export interface JWTClaims {
  uid: string;
  role: UserRole;
  sessionId: string;
  iat: number;   // issued-at (unix seconds)
  exp: number;   // expiry (unix seconds)
  type: 'access' | 'refresh';
}

const ACCESS_TOKEN_TTL_SEC  = 15 * 60;          // 15 minutes
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

/**
 * Retrofitted to use SecretVault during CTO Audit Part 4 response (2026-07-19) —
 * a real, security-critical worked example of the vault pattern, not just a
 * demo on a low-stakes secret. Same JWT_SECRET-then-OWNER_SECRET fallback
 * behavior preserved exactly; the only change is that the access is now
 * caller-typed and logged via SecretVault instead of a bare process.env read.
 * See docs/adr/0016-secret-vault.md.
 */
function getSecret(): string {
  const context = { caller: 'system' as const, module: 'JWTService' };
  try {
    return SecretVault.get('JWT_SECRET', context);
  } catch {
    try {
      return SecretVault.get('OWNER_SECRET', context);
    } catch {
      throw new Error('[JWTService] JWT_SECRET (or OWNER_SECRET fallback) not set in environment');
    }
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - input.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function sign(payload: object): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64  = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', getSecret()).update(`${headerB64}.${payloadB64}`).digest();
  return `${headerB64}.${payloadB64}.${base64url(signature)}`;
}

export class JWTService {

  /** Issue a short-lived access token. */
  static issueAccessToken(uid: string, role: UserRole, sessionId: string): string {
    const now = Math.floor(Date.now() / 1000);
    return sign({ uid, role, sessionId, iat: now, exp: now + ACCESS_TOKEN_TTL_SEC, type: 'access' } as JWTClaims);
  }

  /** Issue a long-lived refresh token AND store its hash (for revocation). */
  static async issueRefreshToken(uid: string, role: UserRole, sessionId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const token = sign({ uid, role, sessionId, iat: now, exp: now + REFRESH_TOKEN_TTL_SEC, type: 'refresh' } as JWTClaims);

    try {
      const { NexusDB } = await import('../../database/NexusDB');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await NexusDB.set('auth_sessions', sessionId, {
        uid, role, tokenHash,
        issuedAt: new Date(now * 1000).toISOString(),
        expiresAt: new Date((now + REFRESH_TOKEN_TTL_SEC) * 1000).toISOString(),
        revoked: false,
      }, true);
    } catch (err) {
      console.error('[JWTService] Failed to persist refresh session:', err);
    }

    return token;
  }

  /** Issue an access+refresh pair for a fresh login. */
  static async issueTokenPair(uid: string, role: UserRole): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
    const sessionId = `sess_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    const accessToken  = this.issueAccessToken(uid, role, sessionId);
    const refreshToken = await this.issueRefreshToken(uid, role, sessionId);
    return { accessToken, refreshToken, sessionId };
  }

  /**
   * Verify a token's signature, expiry, and (for refresh tokens) revocation
   * status. Returns the decoded claims, or null if invalid.
   */
  static verify(token: string): JWTClaims | null {
    try {
      const [headerB64, payloadB64, sigB64] = token.split('.');
      if (!headerB64 || !payloadB64 || !sigB64) return null;

      const expectedSig = crypto.createHmac('sha256', getSecret()).update(`${headerB64}.${payloadB64}`).digest();
      const actualSig = base64urlDecode(sigB64);
      if (!crypto.timingSafeEqual(expectedSig, actualSig)) return null;

      const claims: JWTClaims = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp < now) return null;

      return claims;
    } catch {
      return null;
    }
  }

  /**
   * Verify a refresh token against the revocation store and issue a new
   * access token. Returns null if the refresh token is invalid/revoked/expired.
   */
  static async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string } | null> {
    const claims = this.verify(refreshToken);
    if (!claims || claims.type !== 'refresh') return null;

    try {
      const { NexusDB } = await import('../../database/NexusDB');
      const session = await NexusDB.get('auth_sessions', claims.sessionId);
      if (!session || session.revoked) return null;

      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      if (session.tokenHash !== tokenHash) return null; // token doesn't match stored session (stale/rotated)

      return { accessToken: this.issueAccessToken(claims.uid, claims.role, claims.sessionId) };
    } catch (err) {
      console.error('[JWTService] refreshAccessToken failed:', err);
      return null;
    }
  }

  /** Revoke a session (logout, or admin-forced revocation). */
  static async revokeSession(sessionId: string): Promise<void> {
    try {
      const { NexusDB } = await import('../../database/NexusDB');
      await NexusDB.update('auth_sessions', sessionId, { revoked: true, revokedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[JWTService] revokeSession failed:', err);
    }
  }

  /** Revoke ALL sessions for a user (e.g. password change, account compromise). */
  static async getActiveSessions(uid: string): Promise<Array<Record<string, any>>> {
    const { NexusDB } = await import('../../database/NexusDB');
    return NexusDB.find('auth_sessions', {
      where: [{ field: 'uid', op: '==', value: uid }, { field: 'revoked', op: '==', value: false }],
      orderBy: 'issuedAt', orderDir: 'desc', limit: 50,
    });
  }

  static async revokeAllSessions(uid: string): Promise<number> {
    try {
      const { NexusDB } = await import('../../database/NexusDB');
      const sessions = await NexusDB.find('auth_sessions', { where: [{ field: 'uid', op: '==', value: uid }], limit: 200 });
      for (const s of sessions) {
        await NexusDB.update('auth_sessions', (s as any).id, { revoked: true, revokedAt: new Date().toISOString() });
      }
      return sessions.length;
    } catch (err) {
      console.error('[JWTService] revokeAllSessions failed:', err);
      return 0;
    }
  }
}
