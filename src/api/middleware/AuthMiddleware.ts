/**
 * NexusOS — Shared API Auth Middleware
 *
 * Extracted from server.ts (Part 12 decomposition).
 * Import from route files to avoid duplicating auth logic.
 */

import { Request, Response, NextFunction } from 'express';

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['authorization']?.replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const adminSecret = process.env.OWNER_SECRET;
  if (adminSecret && token === adminSecret) {
    (req as any).authUser = { uid: 'owner', role: 'ceo', sessionId: 'legacy-secret', authMethod: 'legacy_secret' };
    next(); return;
  }

  try {
    const { JWTService } = require('../../lib/security/auth/JWTService');
    const claims = JWTService.verify(token);
    if (!claims || claims.type !== 'access' || (claims.role !== 'admin' && claims.role !== 'ceo')) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    (req as any).authUser = { uid: claims.uid, role: claims.role, sessionId: claims.sessionId, authMethod: 'jwt' };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['authorization']?.replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const { JWTService } = require('../../lib/security/auth/JWTService');
    const claims = JWTService.verify(token);
    if (!claims || claims.type !== 'access') { res.status(401).json({ error: 'Unauthorized' }); return; }
    (req as any).authUser = { uid: claims.uid, role: claims.role, sessionId: claims.sessionId, authMethod: 'jwt' };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export async function shutdownGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { OwnerControlEngine } = await import('../../lib/control/OwnerControlEngine');
    if (await OwnerControlEngine.isShutdown()) {
      res.status(503).json({ error: 'System is temporarily suspended. Please try again later.' });
      return;
    }
  } catch { /* fail open */ }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).authUser;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: `Requires one of roles: ${roles.join(', ')}` });
      return;
    }
    next();
  };
}
