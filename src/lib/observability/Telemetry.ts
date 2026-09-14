/**
 * Telemetry — distributed tracing for AI agent operations.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 * Features: PII sanitization, loop detection, cost tracking.
 */
import { NexusDB } from '../database/NexusDB';

export enum AIErrorType {
  Validation     = 'Validation Error',
  ToolTimeout    = 'Tool Timeout',
  ExternalAPI    = 'External API Failure',
  ModelRefusal   = 'Model Refusal',
  Parsing        = 'Parsing Error',
  PermissionDenied = 'Permission Denied',
  RateLimited    = 'Rate Limited',
  MemoryOverflow = 'Memory Overflow',
  LoopDetected   = 'Loop Detected',
  Unknown        = 'Unknown Failure',
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'success' | 'error';
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  error?: string;
  errorType?: AIErrorType;
  rationale?: string;
  inputSize?: number;
  outputSize?: number;
  retryCount?: number;
}

export interface TraceData {
  id: string;
  name: string;
  userId: string;
  agentRole: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'success' | 'error';
  totalTokens: number;
  estimatedCost: number;
  spans: Span[];
  timestamp?: unknown;
  loopAlert?: boolean;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);
}

// ── PII Sanitizer ────────────────────────────────────────────────────
class PIISanitizer {
  static sanitize<T>(obj: T): T {
    if (typeof obj === 'string') {
      let s: string = obj;
      s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
      s = s.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]');
      s = s.replace(/(AIza[0-9A-Za-z-_]{35}|sk-[a-zA-Z0-9]{48})/g, '[REDACTED_API_KEY]');
      return s as unknown as T;
    }
    if (Array.isArray(obj)) return obj.map((i) => PIISanitizer.sanitize(i)) as unknown as T;
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const isSecret = ['password', 'secret', 'token', 'key'].some((s) =>
          k.toLowerCase().includes(s),
        );
        result[k] = isSecret ? '[REDACTED]' : PIISanitizer.sanitize(v);
      }
      return result as unknown as T;
    }
    return obj;
  }
}

// ── Remove undefined values (Firestore doesn't accept them) ─────────
function removeUndefined<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(removeUndefined) as unknown as T;
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) result[k] = removeUndefined(v);
    }
    return result as unknown as T;
  }
  return obj;
}

// ── TraceTracker ─────────────────────────────────────────────────────
export class TraceTracker {
  private trace: TraceData;
  private toolCallHistory: { name: string; argsHash: string; count: number }[] = [];
  private readonly MAX_SAME_TOOL_CALLS  = 3;
  private readonly MAX_TOTAL_TOOL_CALLS = 15;

  constructor(name: string, userId: string, agentRole: string) {
    this.trace = {
      id: generateId(),
      name,
      userId,
      agentRole,
      startTime: Date.now(),
      status: 'running',
      totalTokens: 0,
      estimatedCost: 0,
      spans: [],
      loopAlert: false,
    };
  }

  startSpan(name: string, attributes: Record<string, unknown> = {}, parentSpanId?: string): Span {
    const span: Span = {
      id: generateId(),
      traceId: this.trace.id,
      parentSpanId,
      name,
      startTime: Date.now(),
      status: 'running',
      attributes: PIISanitizer.sanitize(attributes),
      events: [],
      retryCount: 0,
    };
    this.trace.spans.push(span);
    return span;
  }

  endSpan(
    spanId: string,
    status: 'success' | 'error' = 'success',
    error?: string,
    attributes?: Record<string, unknown>,
    errorType?: AIErrorType,
    rationale?: string,
  ): void {
    const span = this.trace.spans.find((s) => s.id === spanId);
    if (!span) return;
    span.endTime  = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status   = status;
    if (error)      span.error     = error;
    if (errorType)  span.errorType = errorType;
    if (rationale)  span.rationale = rationale;
    if (attributes) span.attributes = { ...span.attributes, ...PIISanitizer.sanitize(attributes) };
  }

  addSpanEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const span = this.trace.spans.find((s) => s.id === spanId);
    if (span) {
      span.events.push({ name, timestamp: Date.now(), attributes: PIISanitizer.sanitize(attributes) });
    }
  }

  addTokensAndCost(tokens: number, cost: number): void {
    this.trace.totalTokens  += tokens;
    this.trace.estimatedCost += cost;
  }

  detectLoop(toolName: string, args: unknown): { isLoop: boolean; reason?: string } {
    const argsHash   = JSON.stringify(args);
    const totalCalls = this.toolCallHistory.reduce((s, h) => s + h.count, 0);

    if (totalCalls >= this.MAX_TOTAL_TOOL_CALLS) {
      this.trace.loopAlert = true;
      return { isLoop: true, reason: `Max total tool calls (${this.MAX_TOTAL_TOOL_CALLS}) exceeded.` };
    }

    const existing = this.toolCallHistory.find(
      (h) => h.name === toolName && h.argsHash === argsHash,
    );
    if (existing) {
      existing.count += 1;
      if (existing.count >= this.MAX_SAME_TOOL_CALLS) {
        this.trace.loopAlert = true;
        return { isLoop: true, reason: `Tool '${toolName}' called with same args ${this.MAX_SAME_TOOL_CALLS} times.` };
      }
    } else {
      this.toolCallHistory.push({ name: toolName, argsHash, count: 1 });
    }
    return { isLoop: false };
  }

  async endTrace(status: 'success' | 'error' = 'success'): Promise<void> {
    this.trace.endTime   = Date.now();
    this.trace.duration  = this.trace.endTime - this.trace.startTime;
    this.trace.status    = status;
    this.trace.timestamp = NexusDB.serverTimestamp();

    try {
      const sanitized = removeUndefined(this.trace);
      await NexusDB.set('traces', this.trace.id, sanitized as unknown as Record<string, unknown>);
    } catch (err) {
      console.error('[Telemetry] Failed to save trace:', err);
    }
  }

  getTraceId(): string {
    return this.trace.id;
  }
  
  getTrace(): TraceData {
    return { ...this.trace };
  }
}

export const Telemetry = {
  startTrace: (name: string, userId: string, agentRole: string): TraceTracker =>
    new TraceTracker(name, userId, agentRole),
};
