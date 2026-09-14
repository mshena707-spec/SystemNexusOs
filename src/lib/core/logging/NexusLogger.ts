/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                  NEXUS STRUCTURED LOGGER                     ║
 * ║  Production-grade logging. Structured JSON in prod.          ║
 * ║  Human-readable in dev. Supports Loki/Grafana shipping.      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   import { logger } from '@/lib/core/logging/NexusLogger';
 *   const log = logger.child('OrderEngine');
 *   log.info('Order created', { orderId, userId, amount });
 *   log.error('Payment failed', error, { orderId });
 */

import { NexusConfig } from '../config/NexusConfig';

const IS_SERVER = typeof window === 'undefined';
const IS_PROD = NexusConfig.system.env === 'production';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  data?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  traceId?: string;
  userId?: string;
  sessionId?: string;
  duration?: number;
}

// ── Level ordering ────────────────────────────────────────────────────────
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, fatal: 4
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',   // cyan
  info:  '\x1b[32m',   // green
  warn:  '\x1b[33m',   // yellow
  error: '\x1b[31m',   // red
  fatal: '\x1b[35m',   // magenta
};
const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';
const BOLD  = '\x1b[1m';

// ── Log transports ────────────────────────────────────────────────────────
interface LogTransport {
  name: string;
  write(entry: LogEntry): void;
}

class ConsoleTransport implements LogTransport {
  name = 'console';

  write(entry: LogEntry): void {
    if (IS_PROD) {
      // Structured JSON for log aggregators (Loki, CloudWatch, etc.)
      process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
      // Human-readable for development
      const color = LEVEL_COLORS[entry.level];
      const ts = entry.timestamp.split('T')[1].replace('Z', '');
      const levelStr = entry.level.toUpperCase().padEnd(5);
      let line = `${DIM}${ts}${RESET} ${color}${BOLD}${levelStr}${RESET} ${DIM}[${entry.service}]${RESET} ${entry.message}`;
      if (entry.data && Object.keys(entry.data).length > 0) {
        line += `\n        ${DIM}${JSON.stringify(entry.data)}${RESET}`;
      }
      if (entry.error) {
        line += `\n        ${LEVEL_COLORS.error}${entry.error.message}${RESET}`;
        if (entry.error.stack && entry.level === 'debug') {
          line += `\n        ${DIM}${entry.error.stack}${RESET}`;
        }
      }
      console.log(line);
    }
  }
}

class LokiTransport implements LogTransport {
  name = 'loki';
  private buffer: LogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private lokiUrl: string, private serviceName: string) {
    if (IS_SERVER && lokiUrl) {
      this.flushInterval = setInterval(() => this.flush(), 5000);
    }
  }

  write(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= 100) this.flush();
  }

  private async flush() {
    if (!this.buffer.length || !this.lokiUrl) return;
    const entries = [...this.buffer];
    this.buffer = [];

    try {
      const streams = [{
        stream: { service: this.serviceName, level: entries[0]?.level || 'info' },
        values: entries.map(e => [
          String(new Date(e.timestamp).getTime() * 1e6),
          JSON.stringify(e),
        ]),
      }];

      await fetch(`${this.lokiUrl}/loki/api/v1/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streams }),
      });
    } catch (_) {
      // Silently fail — don't let logging break the app
    }
  }
}

// ── Ring buffer for in-memory log access (admin console) ──────────────────
class LogRingBuffer {
  private buffer: LogEntry[] = [];
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  push(entry: LogEntry) {
    this.buffer.unshift(entry);
    if (this.buffer.length > this.maxSize) this.buffer.pop();
  }

  getRecent(limit = 50, level?: LogLevel, service?: string): LogEntry[] {
    return this.buffer
      .filter(e => {
        if (level && LEVEL_ORDER[e.level] < LEVEL_ORDER[level]) return false;
        if (service && !e.service.includes(service)) return false;
        return true;
      })
      .slice(0, limit);
  }

  clear() { this.buffer = []; }
}

// ── Core Logger class ─────────────────────────────────────────────────────
export class Logger {
  private transports: LogTransport[];
  private minLevel: LogLevel;
  private ringBuffer: LogRingBuffer;

  constructor() {
    this.minLevel = (NexusConfig.observability.logLevel as LogLevel) || 'info';
    this.ringBuffer = new LogRingBuffer(2000);
    this.transports = [new ConsoleTransport()];

    // Add Loki transport if configured
    if (IS_SERVER && NexusConfig.observability.lokiUrl) {
      this.transports.push(new LokiTransport(
        NexusConfig.observability.lokiUrl,
        NexusConfig.system.name,
      ));
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private write(
    level: LogLevel,
    service: string,
    message: string,
    data?: Record<string, any>,
    error?: Error,
    meta?: { traceId?: string; userId?: string; duration?: number },
  ) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      data,
      error: error ? {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      } : undefined,
      traceId: meta?.traceId,
      userId: meta?.userId,
      duration: meta?.duration,
    };

    this.ringBuffer.push(entry);
    for (const transport of this.transports) {
      try { transport.write(entry); } catch (_) {}
    }
  }

  /** Create a child logger bound to a specific service/module */
  child(service: string, defaultMeta?: Record<string, any>): ChildLogger {
    return new ChildLogger(this, service, defaultMeta);
  }

  /** Access recent logs (for admin dashboard) */
  getRecentLogs(options?: { limit?: number; level?: LogLevel; service?: string }): LogEntry[] {
    return this.ringBuffer.getRecent(options?.limit, options?.level, options?.service);
  }

  // Direct log methods (use child() in practice)
  debug(service: string, msg: string, data?: Record<string, any>) { this.write('debug', service, msg, data); }
  info(service: string, msg: string, data?: Record<string, any>) { this.write('info', service, msg, data); }
  warn(service: string, msg: string, data?: Record<string, any>) { this.write('warn', service, msg, data); }
  error(service: string, msg: string, err?: Error, data?: Record<string, any>) { this.write('error', service, msg, data, err); }
  fatal(service: string, msg: string, err?: Error, data?: Record<string, any>) { this.write('fatal', service, msg, data, err); }

  /** Performance timer — returns a function to call when done */
  startTimer(service: string, operation: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.write('debug', service, `${operation} completed`, { duration_ms: duration }, undefined, { duration });
    };
  }
}

// ── Child logger (bound to a service name) ────────────────────────────────
export class ChildLogger {
  constructor(
    private parent: Logger,
    private service: string,
    private defaultMeta?: Record<string, any>,
  ) {}

  private merge(data?: Record<string, any>): Record<string, any> | undefined {
    if (!this.defaultMeta && !data) return undefined;
    return { ...this.defaultMeta, ...data };
  }

  debug(msg: string, data?: Record<string, any>) { this.parent.debug(this.service, msg, this.merge(data)); }
  info(msg: string, data?: Record<string, any>) { this.parent.info(this.service, msg, this.merge(data)); }
  warn(msg: string, data?: Record<string, any>) { this.parent.warn(this.service, msg, this.merge(data)); }
  error(msg: string, err?: Error | unknown, data?: Record<string, any>) {
    const error = err instanceof Error ? err : err ? new Error(String(err)) : undefined;
    this.parent.error(this.service, msg, error, this.merge(data));
  }
  fatal(msg: string, err?: Error | unknown, data?: Record<string, any>) {
    const error = err instanceof Error ? err : err ? new Error(String(err)) : undefined;
    this.parent.fatal(this.service, msg, error, this.merge(data));
  }

  startTimer(operation: string): () => void {
    return this.parent.startTimer(this.service, operation);
  }

  child(subService: string): ChildLogger {
    return new ChildLogger(this.parent, `${this.service}:${subService}`, this.defaultMeta);
  }
}

// ── Global singleton ──────────────────────────────────────────────────────
export const logger = new Logger();

// ── Express middleware ────────────────────────────────────────────────────
export function requestLogger() {
  const log = logger.child('HTTP');
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    const traceId = req.headers['x-trace-id'] || crypto.randomUUID?.() || Date.now().toString(36);
    req.traceId = traceId;
    res.setHeader('x-trace-id', traceId);

    res.on('finish', () => {
      const duration = Date.now() - start;
      const level: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
      log[level](`${req.method} ${req.path} ${res.statusCode}`, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: duration,
        traceId,
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      });
    });

    next();
  };
}
