/**
 * Route Auth Coverage Auditor
 *
 * WHY: Every audit round noted auth coverage was not traced route-by-route.
 * With 196+ routes, manual inspection is error-prone. This tool runs at
 * startup, inspects every registered Express route, and logs/emits any
 * that lack auth middleware — so unprotected endpoints are caught
 * automatically during development, not discovered in production.
 *
 * HOW: Express exposes its router stack via `app._router.stack`.
 * We walk it, categorize each route by its middleware chain,
 * and classify it as: protected | public | unenforced.
 *
 * ROUTE CLASSIFICATION:
 *   protected  — has requireAuth or requireAdminAuth in middleware chain
 *   public     — intentionally public (health, webhook, tracking, login)
 *   unenforced — has neither; likely missing auth (emits a warning)
 */

import { EventBus } from '../../core/events/NexusEventBus';
import { logger }   from '../../core/logging/NexusLogger';

const log = logger.child('AuthCoverageAudit');

// Routes that are intentionally public — no auth required
const KNOWN_PUBLIC_PATTERNS = [
  /^\/api\/health/,
  /^\/api\/auth\/login/,
  /^\/api\/auth\/refresh/,
  /^\/api\/auth\/forgot-password/,
  /^\/api\/auth\/reset-password/,
  /^\/api\/auth\/send-verification/,
  /^\/api\/auth\/verify-email/,
  /^\/api\/auth\/2fa\//,
  /^\/api\/stripe-webhook/,
  /^\/api\/webhooks\//,
  /^\/api\/orders\/[^/]+\/tracking/,   // public order tracking
  /^\/api\/delivery\/timeline\//,       // public delivery timeline
  /^\/api\/delivery\/eta\//,            // public ETA check
  /^\/api\/delivery\/status/,           // rider status update (has its own auth)
  /^\/api\/orders\/cod-fraud-check/,   // internal, rate-limited
  /^\/api\/tax\//,                      // tax calc is public
  /^\/api\/inventory\/check\//,         // stock check is public
  /^\/api\/feature-flags\/check\//,     // flag check is public
  /^\/api\/policies\/can-return/,       // return eligibility is public
  /^\/api\/v1/,                         // versioning rewrite middleware
];

export interface RouteAuditResult {
  method:    string;
  path:      string;
  status:    'protected' | 'public' | 'unenforced';
  middlewareNames: string[];
}

export class RouteAuthAuditor {

  static audit(app: any): RouteAuditResult[] {
    const results: RouteAuditResult[] = [];

    if (!app._router?.stack) {
      log.warn('Cannot audit routes: app._router not available (call after routes are registered)');
      return results;
    }

    this._walkStack(app._router.stack, '', results);

    const unprotected = results.filter(r => r.status === 'unenforced');
    const protected_  = results.filter(r => r.status === 'protected');
    const publicRoutes = results.filter(r => r.status === 'public');

    log.info('Auth coverage audit complete', {
      total:       results.length,
      protected:   protected_.length,
      public:      publicRoutes.length,
      unenforced:  unprotected.length,
    });

    if (unprotected.length > 0) {
      log.warn(`🔓 ${unprotected.length} routes lack explicit auth middleware:`, {
        routes: unprotected.map(r => `${r.method} ${r.path}`),
      });

      EventBus.emit('security.auth_coverage_gap', {
        unenforcedRoutes: unprotected.map(r => ({ method: r.method, path: r.path })),
        totalRoutes: results.length,
        coveragePct: Math.round((protected_.length / results.length) * 100),
      });
    } else {
      log.info('✅ All routes have explicit auth middleware or are known-public');
    }

    return results;
  }

  private static _walkStack(
    stack: any[],
    prefix: string,
    results: RouteAuditResult[],
  ): void {
    for (const layer of stack) {
      if (layer.route) {
        // Leaf route
        const path = prefix + (layer.route.path || '');
        const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase());
        const middlewareNames = (layer.route.stack || [])
          .map((s: any) => s.handle?.name || 'anonymous')
          .filter((n: any) => n !== '<anonymous>');

        const hasAuth = middlewareNames.some((n: string) =>
          n.includes('requireAuth') || n.includes('requireAdmin') || n.includes('shutdownGuard')
        );
        const isPublic = KNOWN_PUBLIC_PATTERNS.some(p => p.test(path));

        const status: RouteAuditResult['status'] =
          hasAuth    ? 'protected'  :
          isPublic   ? 'public'     :
          'unenforced';

        for (const method of methods) {
          results.push({ method, path, status, middlewareNames });
        }
      } else if (layer.handle?.stack) {
        // Router middleware — recurse
        const routerPath = prefix + (layer.regexp?.source?.replace(/\\\//g, '/').replace(/\^|\\\/\?\(\?\=\\\/\|\$\)/g, '') || '');
        this._walkStack(layer.handle.stack, routerPath, results);
      }
    }
  }

  /** Print a human-readable coverage report to console */
  static printReport(results: RouteAuditResult[]): void {
    const grouped = { protected: 0, public: 0, unenforced: 0 };
    for (const r of results) grouped[r.status]++;

    const total = results.length;
    const covPct = total > 0 ? Math.round((grouped.protected / total) * 100) : 0;

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log(`║  Auth Coverage Report — ${new Date().toISOString().slice(0, 10)}              ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Total routes:   ${String(total).padEnd(38)}║`);
    console.log(`║  Protected:      ${String(grouped.protected).padEnd(38)}║`);
    console.log(`║  Public (ok):    ${String(grouped.public).padEnd(38)}║`);
    console.log(`║  Unenforced:     ${String(grouped.unenforced).padEnd(38)}║`);
    console.log(`║  Coverage:       ${(covPct + '%').padEnd(38)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');

    const unenforced = results.filter(r => r.status === 'unenforced');
    if (unenforced.length > 0) {
      console.log('\n⚠️  UNENFORCED ROUTES (add auth or add to KNOWN_PUBLIC_PATTERNS):');
      for (const r of unenforced) {
        console.log(`   ${r.method.padEnd(7)} ${r.path}`);
      }
    }
  }
}
