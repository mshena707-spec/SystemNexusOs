/**
 * Auth Routes — /api/auth/*
 *
 * Extracted from server.ts (Part 12 — server.ts decomposition).
 * All authentication, session management, 2FA, and password-reset endpoints.
 *
 * COVERAGE: Every route here requires either:
 * - Firebase idToken verification (login)
 * - Valid JWT (requireAuth / requireAdminAuth)
 * - Rate limiting (authRateLimit — 10 req/min per IP)
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireAdminAuth } from '../middleware/AuthMiddleware';

export function createAuthRouter(deps: {
  authRateLimit: any;
}): Router {
  const router = Router();
  const { authRateLimit } = deps;

  // ── Login ──────────────────────────────────────────────────────────────────
  router.post('/login', async (req: Request, res: Response) => {
    const { idToken } = req.body;
    if (!idToken) { res.status(400).json({ error: 'idToken required' }); return; }
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress || 'unknown';
    try {
      const admin = await import('firebase-admin');
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      let role: any = decoded.role || (decoded as any).claims?.role;
      if (!role) {
        const { NexusDB } = await import('../../lib/database/NexusDB');
        const userDoc = await NexusDB.get('users', uid);
        role = (userDoc as any)?.role ?? 'customer';
      }

      const { JWTService } = await import('../../lib/security/auth/JWTService');
      const { accessToken, refreshToken, sessionId } = await JWTService.issueTokenPair(uid, role);

      const { DeviceFingerprintService } = await import('../../lib/security/auth/DeviceFingerprint');
      const { AnomalyDetectionEngine } = await import('../../lib/security/auth/AnomalyDetectionEngine');
      const fp = DeviceFingerprintService.extract(req);
      await AnomalyDetectionEngine.checkLogin(uid, fp);
      await AnomalyDetectionEngine.clearFailedLogins(uid);

      const { NexusDB } = await import('../../lib/database/NexusDB');
      await NexusDB.update('auth_sessions', sessionId, { deviceFingerprint: fp.fingerprint, ipAddress: fp.ipAddress });

      res.json({ accessToken, refreshToken, role, uid });
    } catch (err: any) {
      const identifier = req.body?.idToken ? 'unknown-uid' : 'unknown';
      try {
        const { AnomalyDetectionEngine } = await import('../../lib/security/auth/AnomalyDetectionEngine');
        await AnomalyDetectionEngine.recordFailedLogin(identifier, ip);
      } catch { /* non-blocking */ }
      console.error('[Auth][Login]', err.message);
      res.status(401).json({ error: 'Invalid or expired ID token' });
    }
  });

  // ── Refresh token ──────────────────────────────────────────────────────────
  router.post('/refresh', async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) { res.status(400).json({ error: 'refreshToken required' }); return; }
    try {
      const { JWTService } = await import('../../lib/security/auth/JWTService');
      const result = await JWTService.refreshAccessToken(refreshToken);
      if (!result) { res.status(401).json({ error: 'Invalid, expired, or revoked refresh token' }); return; }
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Logout ──────────────────────────────────────────────────────────────────
  router.post('/logout', requireAuth, async (req: Request, res: Response) => {
    try {
      const { JWTService } = await import('../../lib/security/auth/JWTService');
      await JWTService.revokeSession((req as any).authUser.sessionId);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── 2FA setup / confirm / verify / disable ─────────────────────────────────
  router.post('/2fa/setup', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { TOTPService } = await import('../../lib/security/2fa/TOTPService');
      res.json(await TOTPService.generateSecret(req.body.uid, req.body.email));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/2fa/confirm', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { TOTPService } = await import('../../lib/security/2fa/TOTPService');
      res.json(await TOTPService.confirmSetup(req.body.uid, req.body.token));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/2fa/verify', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { TOTPService } = await import('../../lib/security/2fa/TOTPService');
      res.json(await TOTPService.verifyToken(req.body.uid, req.body.token));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/2fa/disable', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { TOTPService } = await import('../../lib/security/2fa/TOTPService');
      res.json(await TOTPService.disable(req.body.uid, req.body.token));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Password reset ─────────────────────────────────────────────────────────
  router.post('/forgot-password', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { PasswordResetService } = await import('../../lib/auth/PasswordResetService');
      const result = await PasswordResetService.initiateReset(req.body.email, req.ip);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/reset-password', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { PasswordResetService } = await import('../../lib/auth/PasswordResetService');
      const result = await PasswordResetService.confirmReset(req.body.id, req.body.token, req.body.newPassword);
      if (!result.success) { res.status(400).json({ error: result.error || 'Invalid or expired reset token' }); return; }
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Email verification ─────────────────────────────────────────────────────
  router.post('/send-verification', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { EmailVerificationService } = await import('../../lib/auth/PasswordResetService');
      await EmailVerificationService.sendVerificationOTP(req.body.uid, req.body.email);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/verify-email', authRateLimit, async (req: Request, res: Response) => {
    try {
      const { EmailVerificationService } = await import('../../lib/auth/PasswordResetService');
      const result = await EmailVerificationService.verifyOTP(req.body.uid, req.body.otp);
      if (!result.success) { res.status(400).json({ error: result.error || 'Invalid or expired verification code' }); return; }
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin auth management ─────────────────────────────────────────────────
  router.post('/admin/revoke-all/:uid', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { JWTService } = await import('../../lib/security/auth/JWTService');
      const count = await JWTService.revokeAllSessions(req.params.uid);
      res.json({ success: true, revokedCount: count });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}
