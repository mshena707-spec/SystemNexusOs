/**
 * SecurityMiddleware — browser security headers, bot hints and request rate limits.
 *
 *   app.use(securityHeaders);               // safe browser headers + Content-Security-Policy
 *   app.use('/api/', apiRateLimit);         // protects the server from floods
 *
 * ── How the rate limits are built (and why) ─────────────────────────────────────────
 * • Who is counted?  A signed-in person is counted by their login token (hashed), anyone
 *   else by their IP address. In Bangladesh a mobile network often puts hundreds of
 *   customers behind ONE public IP address, so counting everybody by IP alone would block
 *   real buyers during a busy hour. On top of that there is a much higher per-IP ceiling
 *   that only a single machine hammering the shop would ever reach.
 * • Where is the count kept?  In Redis when available, so the limit is shared by every
 *   server copy; otherwise in memory. Redis trouble never blocks customers — the limiter
 *   falls back to memory and, if even that fails, lets the request through.
 * • Every number can be changed by the owner in Railway → Variables, no code change:
 *     RATE_LIMIT_API_PER_MIN         per signed-in person          (default 600)
 *     RATE_LIMIT_ANON_PER_MIN        per anonymous IP address      (default 3000)
 *     RATE_LIMIT_IP_CEILING_PER_MIN  absolute ceiling for one IP   (default 6000)
 *     RATE_LIMIT_AUTH_PER_MIN        login / password endpoints    (default 60)
 *     RATE_LIMIT_AI_PER_MIN          AI endpoints (cost control)   (default 30)
 *     RATE_LIMIT_PAY_PER_MIN         payment endpoints             (default 20)
 *     RATE_LIMIT_DISABLED=true       switch all of this off (emergency only)
 *     CSP_MODE=enforce|report-only|off   Content-Security-Policy behaviour (default enforce)
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { DeviceFingerprintService } from '../auth/DeviceFingerprint';
import { createSafeRedisClient, redisUrlFromEnv, closeRedisClient } from '../../infrastructure/RedisClient';

const envInt = (name: string, fallback: number): number => {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** The request path without the query string, regardless of where the middleware is mounted. */
const fullPath = (req: Request): string => (req.originalUrl || req.url || '').split('?')[0];
const isHealthPath = (req: Request): boolean => fullPath(req).startsWith('/api/health');

/** The visitor's IP as resolved by Express' `trust proxy` setting (see server.ts). */
function clientIp(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

// ── CSP + Security Headers ────────────────────────────────────────────────────

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const isProd = process.env.NODE_ENV === 'production';
  const cspMode = (process.env.CSP_MODE || 'enforce').toLowerCase();

  if (cspMode !== 'off') {
    const csp = [
      `default-src 'self'`,
      // Stripe (card payments), Google/Firebase sign-in popup, Cloudflare Turnstile
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://challenges.cloudflare.com https://apis.google.com https://www.gstatic.com https://www.google.com https://www.googletagmanager.com`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' data: https://fonts.gstatic.com`,
      `img-src 'self' data: blob: https: http:`,
      `media-src 'self' data: blob: https:`,
      `connect-src 'self' wss: ws: https: http:`,
      // Firebase sign-in runs inside an iframe on <project>.firebaseapp.com
      `frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.firebaseapp.com https://accounts.google.com https://www.google.com https://challenges.cloudflare.com`,
      `worker-src 'self' blob:`,
      `manifest-src 'self'`,
      `object-src 'none'`,
      `frame-ancestors 'self'`,
      `base-uri 'self'`,
      isProd ? `upgrade-insecure-requests` : '',
    ].filter(Boolean).join('; ');
    res.setHeader(cspMode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', csp);
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0'); // the old "1; mode=block" filter is itself a risk in old browsers
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // camera: QR scanning (riders/vendors); geolocation: rider tracking & delivery address; payment: Payment Request
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=(self)');
  // NOTE: no Cross-Origin-Opener-Policy — "same-origin" would break the Google sign-in popup.
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.removeHeader('X-Powered-By');
  next();
}

// ── Bot Detection ─────────────────────────────────────────────────────────────

export function botDetection(blockBots = false) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isHealthPath(req) || req.headers.upgrade === 'websocket') { next(); return; }
    const fp = DeviceFingerprintService.extract(req);
    const goodBots = [/googlebot/i, /bingbot/i, /slackbot/i, /uptimerobot/i, /pingdom/i, /facebookexternalhit/i];
    if (goodBots.some(p => p.test(fp.userAgent))) { next(); return; }
    if (fp.isLikelyBot) {
      console.warn('[BotDetection]', { ip: fp.ipAddress, ua: fp.userAgent.slice(0, 80), reasons: fp.botReasons });
      (req as unknown as Record<string, unknown>).isBot = true;
      if (blockBots) { res.status(403).json({ error: 'Automated access detected', code: 'BOT_BLOCKED' }); return; }
    }
    (req as unknown as Record<string, unknown>).deviceFingerprint = fp.fingerprint;
    (req as unknown as Record<string, unknown>).ipAddress = fp.ipAddress;
    next();
  };
}

// ── Distributed Rate Limiting (Redis → in-memory fallback) ───────────────────

let _redis: any = null;
let _redisInit: Promise<void> | null = null;

async function getRedis(): Promise<any | null> {
  const url = redisUrlFromEnv();
  if (!url) return null;
  if (!_redisInit) {
    _redisInit = createSafeRedisClient(url, 'rate-limit', { failFast: true }).then((c) => {
      _redis = c;
      if (c) console.log('[RateLimit] Redis connection started — limits are shared between server copies while it is up');
    });
  }
  await _redisInit;
  return _redis && _redis.isReady ? _redis : null;
}
// Begin connecting at start-up so the first customer request does not pay for it.
getRedis().catch(() => {});

/** Close the limiter's Redis connection (called during graceful shutdown). */
export async function closeRateLimitRedis(): Promise<void> {
  if (_redis) await closeRedisClient(_redis);
  _redis = null;
}

const _memStore = new Map<string, { count: number; resetAt: number }>();
const MEM_STORE_MAX = 200_000;
const _sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _memStore) if (v.resetAt <= now) _memStore.delete(k);
  // A flood of unique keys must not be able to exhaust memory.
  if (_memStore.size > MEM_STORE_MAX) _memStore.clear();
}, 60_000);
_sweeper.unref?.();

// Atomic "count this request, and start the window on the first one" — a crash between the
// two steps can no longer leave a counter that never expires (which would lock a customer
// out forever).
const INCR_WITH_TTL = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c`;

async function countHit(key: string, windowMs: number): Promise<number> {
  const redis = await getRedis();
  if (redis) {
    try {
      return Number(await redis.eval(INCR_WITH_TTL, { keys: [key], arguments: [String(windowMs)] }));
    } catch { /* Redis hiccup → count in memory for this request */ }
  }
  const now = Date.now();
  const entry = _memStore.get(key);
  if (!entry || now >= entry.resetAt) {
    _memStore.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);

/** Signed-in people are counted by their login token; everyone else by IP address. */
export function identityOf(req: Request): { key: string; signedIn: boolean } {
  const auth = req.headers.authorization;
  if (auth && auth.length > 20) return { key: `tok:${sha(auth)}`, signedIn: true };
  return { key: `ip:${clientIp(req)}`, signedIn: false };
}

interface LimitOptions {
  scope: string;
  windowMs?: number;
  /** requests allowed per window for a signed-in person */
  max: () => number;
  /** requests allowed per window for an anonymous IP (defaults to `max`) */
  maxAnon?: () => number;
  /** count by IP only, even when a token is present (login/password endpoints) */
  ipOnly?: boolean;
  message?: string;
  messageBn?: string;
  skip?: (req: Request) => boolean;
}

function makeRateLimit(o: LimitOptions) {
  const windowMs = o.windowMs ?? 60_000;
  const message = o.message ?? 'Too many requests. Please slow down.';
  const messageBn = o.messageBn ?? 'অনেক বেশি অনুরোধ হয়ে গেছে। একটু পরে আবার চেষ্টা করুন।';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') { next(); return; }
    if (req.method === 'OPTIONS' || isHealthPath(req) || (o.skip && o.skip(req))) { next(); return; }

    try {
      const ip = clientIp(req);
      const who = o.ipOnly ? { key: `ip:${ip}`, signedIn: false } : identityOf(req);
      const limit = who.signedIn ? o.max() : (o.maxAnon ? o.maxAnon() : o.max());

      const count = await countHit(`nexus:rl:${o.scope}:${who.key}`, windowMs);
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));

      let blocked = count > limit;

      // A person with a token is counted separately, so also keep an eye on the raw IP: this
      // catches one machine rotating through made-up tokens to dodge the per-person limit.
      if (!blocked && who.signedIn) {
        const ipCount = await countHit(`nexus:rl:${o.scope}:ceil:${ip}`, windowMs);
        blocked = ipCount > envInt('RATE_LIMIT_IP_CEILING_PER_MIN', 6000);
      }

      if (blocked) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ error: message, message_bn: messageBn, code: 'RATE_LIMITED', retryAfter });
        return;
      }
    } catch { /* never let the limiter itself take the shop down */ }
    next();
  };
}

export const apiRateLimit = makeRateLimit({
  scope: 'api',
  max: () => envInt('RATE_LIMIT_API_PER_MIN', 600),
  maxAnon: () => envInt('RATE_LIMIT_ANON_PER_MIN', 3000),
});

export const authRateLimit = makeRateLimit({
  scope: 'auth',
  ipOnly: true,
  max: () => envInt('RATE_LIMIT_AUTH_PER_MIN', 60),
  message: 'Too many sign-in attempts. Please wait a minute.',
  messageBn: 'অনেকবার লগইনের চেষ্টা হয়েছে। এক মিনিট অপেক্ষা করে আবার চেষ্টা করুন।',
});

export const aiRateLimit = makeRateLimit({
  scope: 'ai',
  max: () => envInt('RATE_LIMIT_AI_PER_MIN', 30),
  maxAnon: () => envInt('RATE_LIMIT_AI_PER_MIN', 30) * 4, // shared-IP allowance
  message: 'AI request limit reached. Please try again shortly.',
  messageBn: 'এআই-এর অনুরোধের সীমা পূর্ণ হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।',
});

export const paymentRateLimit = makeRateLimit({
  scope: 'pay',
  max: () => envInt('RATE_LIMIT_PAY_PER_MIN', 20),
  maxAnon: () => envInt('RATE_LIMIT_PAY_PER_MIN', 20) * 5, // shared-IP allowance
  message: 'Too many payment attempts. Please wait a moment.',
  messageBn: 'অনেকবার পেমেন্টের চেষ্টা হয়েছে। একটু অপেক্ষা করুন।',
});

/** Small status object for the health / setup screens. */
export function getRateLimitStatus() {
  return {
    store: _redis && _redis.isReady ? 'redis' : 'memory',
    memoryKeys: _memStore.size,
    disabled: process.env.RATE_LIMIT_DISABLED === 'true',
  };
}
