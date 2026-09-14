/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NEXUS GLOBAL ERROR FRAMEWORK                                             ║
 * ║  Answers CTO Audit Part 2, section 10.                                   ║
 * ║                                                                           ║
 * ║  Before this file: `catch (error: any)` in ~40+ places in server.ts      ║
 * ║  alone, each handled ad hoc. No error code, no severity, no consistent   ║
 * ║  retry/notification policy. This file is the replacement pattern —      ║
 * ║  not a rewrite of every catch block (that's a large, gradual migration), ║
 * ║  but the standard every *new* catch block should use, and the string    ║
 * ║  every existing one should be migrated to opportunistically.            ║
 * ║                                                                           ║
 * ║  USAGE:                                                                  ║
 * ║    throw new NexusError('PAYMENT_DECLINED', {                           ║
 * ║      severity: 'high',                                                  ║
 * ║      domain: 'payments',                                                ║
 * ║      userMessage: 'Your card was declined. Try another payment method.',║
 * ║      retryable: false,                                                  ║
 * ║      context: { orderId, provider: 'stripe' },                          ║
 * ║      cause: originalStripeError,                                       ║
 * ║    });                                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { logger } from '../logging/NexusLogger';
import { EventBus } from '../events/NexusEventBus';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Recovery strategy — paired with RetryManager (src/lib/core/resilience/RetryManager.ts)
 * for the 'retry' case. NexusError doesn't perform the retry itself (that's the caller's
 * job, using RetryManager.withRetry around the operation) — it *declares* what the right
 * strategy is, so calling code and monitoring dashboards agree on what should happen next.
 */
export type RecoveryStrategy =
  | 'retry'              // transient — safe to retry with backoff (pair with RetryManager)
  | 'fallback'           // switch to a degraded/alternate path (e.g. Ollama if Gemini is down)
  | 'escalate'           // needs a human/agent decision — pairs with agent.approval.required
  | 'fail'               // not recoverable — surface to the caller/user immediately
  | 'ignore';            // safe to log and continue (rare — use deliberately, not by default)

/** Notification policy: who/what needs to know this happened, beyond the log line. */
export type NotificationPolicy =
  | 'none'               // log only
  | 'log-only-aggregate' // log + counted in error-rate dashboards, no individual alert
  | 'alert-oncall'       // should page/alert whoever owns this domain
  | 'alert-owner';       // business-owner-visible (financial/security/data-loss class errors)

export interface NexusErrorOptions {
  /** Which of the 54 domains (see docs/architecture/DOMAIN_MAP.md) this error belongs to. */
  domain: string;
  severity: ErrorSeverity;
  /** Safe to show a customer/end-user. Never put stack traces or internal IDs here. */
  userMessage?: string;
  retryable?: boolean;
  recovery?: RecoveryStrategy;
  notify?: NotificationPolicy;
  /** Structured debug context — orderId, userId, provider, etc. Never put secrets here. */
  context?: Record<string, unknown>;
  /** The original error/exception this wraps, if any. */
  cause?: unknown;
  traceId?: string;
}

const DEFAULT_RECOVERY_BY_SEVERITY: Record<ErrorSeverity, RecoveryStrategy> = {
  low: 'ignore',
  medium: 'retry',
  high: 'escalate',
  critical: 'fail',
};

const DEFAULT_NOTIFY_BY_SEVERITY: Record<ErrorSeverity, NotificationPolicy> = {
  low: 'none',
  medium: 'log-only-aggregate',
  high: 'alert-oncall',
  critical: 'alert-owner',
};

/**
 * The one error class the rest of the codebase should throw for anything
 * domain-meaningful. Plain `throw new Error(...)` remains fine for truly
 * unexpected, un-categorized failures — NexusError is for the failures you
 * can already name (payment declined, memory ACL denied, provider unhealthy).
 */
export class NexusError extends Error {
  readonly code: string;
  readonly domain: string;
  readonly severity: ErrorSeverity;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly recovery: RecoveryStrategy;
  readonly notify: NotificationPolicy;
  readonly context: Record<string, unknown>;
  readonly cause?: unknown;
  readonly traceId?: string;
  readonly timestamp: string;

  constructor(code: string, options: NexusErrorOptions) {
    const message = `[${options.domain}:${code}] ${options.userMessage ?? code}`;
    super(message);
    this.name = 'NexusError';
    this.code = code;
    this.domain = options.domain;
    this.severity = options.severity;
    this.userMessage = options.userMessage ?? 'Something went wrong. Please try again.';
    this.retryable = options.retryable ?? (options.severity === 'low' || options.severity === 'medium');
    this.recovery = options.recovery ?? DEFAULT_RECOVERY_BY_SEVERITY[options.severity];
    this.notify = options.notify ?? DEFAULT_NOTIFY_BY_SEVERITY[options.severity];
    this.context = options.context ?? {};
    this.cause = options.cause;
    this.traceId = options.traceId;
    this.timestamp = new Date().toISOString();

    // Real stack trace pointing at the throw site, not this constructor. Cast to
    // `any` because captureStackTrace is a real V8 extension but isn't always
    // present on the ErrorConstructor type depending on tsconfig lib/target.
    const ErrCtor = Error as unknown as { captureStackTrace?: (target: object, ctor: unknown) => void };
    if (ErrCtor.captureStackTrace) ErrCtor.captureStackTrace(this, NexusError);

    this.report();
  }

  /** Logs via NexusLogger and, for high/critical severity, emits on NexusEventBus
   *  so the rest of the system (dashboards, agent escalation) can react. This runs
   *  automatically on construction — callers don't need to remember to call it. */
  private report(): void {
    const log = logger.child(this.domain);
    const logPayload = {
      code: this.code,
      severity: this.severity,
      recovery: this.recovery,
      retryable: this.retryable,
      context: this.context,
      traceId: this.traceId,
    };

    if (this.severity === 'critical' || this.severity === 'high') {
      log.error(this.message, this, logPayload);
    } else {
      log.warn(this.message, logPayload);
    }

    if (this.notify === 'alert-oncall' || this.notify === 'alert-owner') {
      // Reuses the existing event taxonomy (docs/architecture/EVENT_BUS.md) rather than
      // inventing a parallel notification channel. Anything already subscribed to
      // system.health.degraded picks this up for free.
      EventBus.emit(
        'system.health.degraded',
        {
          reason: `${this.domain}:${this.code}`,
          severity: this.severity,
          notify: this.notify,
          recovery: this.recovery,
          context: this.context,
        },
        `NexusError:${this.domain}`
      );
    }
  }

  /** Safe to send to a client — omits stack, cause, and internal context. */
  toClientResponse() {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
        retryable: this.retryable,
        traceId: this.traceId,
      },
    };
  }

  toLogObject() {
    return {
      code: this.code,
      domain: this.domain,
      severity: this.severity,
      recovery: this.recovery,
      notify: this.notify,
      retryable: this.retryable,
      context: this.context,
      traceId: this.traceId,
      timestamp: this.timestamp,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

/**
 * Express error-handling middleware. Wire this LAST, after all routes, in server.ts:
 *   app.use(nexusErrorHandler);
 * Converts a NexusError into a consistent HTTP response; falls back to a generic
 * 500 for un-migrated plain `Error` throws so behavior doesn't regress during migration.
 */
export function nexusErrorHandler(err: unknown, req: any, res: any, _next: any) {
  if (err instanceof NexusError) {
    const status = err.severity === 'critical' ? 500 : err.retryable ? 503 : 400;
    res.status(status).json(err.toClientResponse());
    return;
  }
  logger.child('unhandled').error('Unhandled error (not a NexusError — migrate this route)', err as Error, {
    path: req?.path,
  });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}

/**
 * Common, named error codes so different modules don't invent inconsistent strings
 * for the same failure. Extend this per-domain as real usage grows — this is a
 * starting set, not a closed list.
 */
export const NexusErrorCodes = {
  payments: {
    DECLINED: 'PAYMENT_DECLINED',
    PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',
    WEBHOOK_SIGNATURE_INVALID: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
  },
  ai: {
    PROVIDER_UNHEALTHY: 'AI_PROVIDER_UNHEALTHY',
    CONFIDENCE_TOO_LOW: 'AI_CONFIDENCE_TOO_LOW',
    RATE_LIMITED: 'AI_RATE_LIMITED',
  },
  memory: {
    ACL_DENIED: 'MEMORY_ACL_DENIED',
    CORRUPTED: 'MEMORY_CORRUPTED',
  },
  security: {
    TENANT_ISOLATION_VIOLATION: 'SECURITY_TENANT_ISOLATION_VIOLATION',
    AUTH_INVALID: 'SECURITY_AUTH_INVALID',
    RATE_LIMITED: 'SECURITY_RATE_LIMITED',
    PROMPT_INJECTION_BLOCKED: 'SECURITY_PROMPT_INJECTION_BLOCKED',
  },
  database: {
    PROVIDER_UNAVAILABLE: 'DB_PROVIDER_UNAVAILABLE',
    QUERY_FAILED: 'DB_QUERY_FAILED',
  },
} as const;
