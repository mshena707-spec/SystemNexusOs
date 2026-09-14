/**
 * SecurityMiddleware — CSP Headers + Bot Detection + Redis Rate Limiting
 * Wire: app.use(securityHeaders); app.use(botDetection()); app.use(apiRateLimit);
 */

import type { Request, Response, NextFunction } from 'express';
import { DeviceFingerprintService } from '../auth/DeviceFingerprint';

// ── CSP + Security Headers ────────────────────────────────────────────────────

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const isProd = process.env.NODE_ENV === 'production';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://challenges.cloudflare.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `img-src 'self' data: blob: https: http:`,
    `connect-src 'self' wss: ws: https: http:`,
    `frame-src 'self' https://js.stripe.com https://hooks.stripe.com`,
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    isProd ? `upgrade-insecure-requests` : '',
  ].filter(Boolean).join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(self)');
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.removeHeader('X-Powered-By');
  next();
}

// ── Bot Detection ─────────────────────────────────────────────────────────────

export function botDetection(blockBots = false) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/api/health' || req.headers.upgrade === 'websocket') { next(); return; }
    const fp = DeviceFingerprintService.extract(req);
    const goodBots = [/googlebot/i, /bingbot/i, /slackbot/i, /uptimerobot/i, /pingdom/i, /facebookexternalhit/i];
    if (goodBots.some(p => p.test(fp.userAgent))) { next(); return; }
    if (fp.isLikelyBot) {
      console.warn('[BotDetection]', { ip: fp.ipAddress, ua: fp.userAgent.slice(0, 80), reasons: fp.botReasons });
      (req as Record<string, unknown>).isBot = true;
      if (blockBots) { res.status(403).json({ error: 'Automated access detected', code: 'BOT_BLOCKED' }); return; }
    }
    (req as Record<string, unknown>).deviceFingerprint = fp.fingerprint;
    (req as Record<string, unknown>).ipAddress = fp.ipAddress;
    next();
  };
}

// ── Distributed Rate Limiting (Redis → in-memory fallback) ───────────────────

let _redis: Record<string, (...args: unknown[]) => unknown> | null = null;
const _memStore = new Map<string, { count: number; resetAt: number }>();

async function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = await import('redis');
    const c = createClient({ url });
    await c.connect();
    c.on('error', () => { _redis = null; });
    _redis = c as unknown as typeof _redis;
    console.log('[RateLimit] ✅ Redis distributed rate limiting active');
  } catch { /* fallback to memory */ }
  return _redis;
}
getRedis().catch(() => {});

function makeRateLimit(windowMs: number, max: number, keyFn?: (r: Request) => string, skipFn?: (r: Request) => boolean, msg?: string) {
  const _keyFn = keyFn ?? ((req: Request) => (req as Record<string, unknown>).ipAddress as string || req.ip || 'unknown');
  const _skipFn = skipFn ?? (() => false);
  const _msg = msg ?? 'Too many requests. Please slow down.';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (_skipFn(req)) { next(); return; }
    const key = `nexus:rl:${_keyFn(req)}`;
    const now = Date.now();
    try {
      const redis = await getRedis();
      if (redis) {
        const count = await redis.incr(key) as number;
        if (count === 1) await redis.pExpire(key, windowMs);
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
        if (count > max) { res.status(429).json({ error: _msg, retryAfter: Math.ceil(windowMs / 1000) }); return; }
      } else {
        const entry = _memStore.get(key);
        if (!entry || now > entry.resetAt) { _memStore.set(key, { count: 1, resetAt: now + windowMs }); }
        else {
          entry.count++;
          if (entry.count > max) { res.status(429).json({ error: _msg }); return; }
        }
      }
    } catch { /* fail open */ }
    next();
  };
}

export const authRateLimit    = makeRateLimit(60_000, 20,  (r) => `auth:${(r as Record<string, unknown>).ipAddress || r.ip}`,   undefined, 'Too many auth attempts.');
export const apiRateLimit     = makeRateLimit(60_000, 200, undefined, (r) => r.path === '/api/health');
export const aiRateLimit      = makeRateLimit(60_000, 30,  undefined, undefined, 'AI request limit reached.');
export const paymentRateLimit = makeRateLimit(60_000, 10,  (r) => `pay:${(r as Record<string, unknown>).ipAddress || r.ip}`, undefined, 'Too many payment attempts.');
