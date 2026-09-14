/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              NEXUS TOOL REGISTRY & EXECUTOR                  ║
 * ║  Phase 3: Sandboxed tool execution for agents               ║
 * ║                                                              ║
 * ║  SECURITY PRINCIPLE:                                         ║
 * ║   Agents never call external APIs directly.                  ║
 * ║   All tool calls go through ToolRegistry with ACL check.     ║
 * ║   Dangerous tools require human approval gate.               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   ToolRegistry.register('lookup_order', {
 *     description: 'Look up order status by order ID',
 *     schema: { orderId: 'string' },
 *     allowedRoles: ['customer_support', 'supervisor'],
 *     requiresApproval: false,
 *     execute: async ({ orderId }) => { ... }
 *   });
 *
 *   const result = await ToolRegistry.execute('lookup_order', { orderId: '#123' }, agentCaller);
 */

import { logger } from '../../core/logging/NexusLogger';
import { EventBus } from '../../core/events/NexusEventBus';
import { NexusConfig } from '../../core/config/NexusConfig';
import { RetryManager } from '../../core/resilience/RetryManager';

const log = logger.child('ToolRegistry');

// ── Tool definition ───────────────────────────────────────────────────────
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  schema: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
  allowedRoles: string[];          // Agent roles that can use this tool
  requiresApproval: boolean;       // Human-in-the-loop gate
  timeout?: number;                // ms, default 10000
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
  /**
   * Added per CTO Audit Part 3, section 10 ("Each Tool will have Permission,
   * Timeout, Retry, Owner, Audit, Rate Limit, Risk Level"). Permission
   * (allowedRoles/requiresApproval), Timeout, Rate Limit, and a basic Audit
   * trail (see executionLog below) already existed — these three were the
   * confirmed gap. All optional: every existing tool registration remains valid.
   */
  /** Who's accountable for this tool's correctness/safety — a team or agentId,
   *  for "who do I ask about this" and "who gets paged if it misbehaves." */
  owner?: string;
  /** How dangerous a failure or misuse of this tool is. Independent of
   *  requiresApproval (a tool can be high-risk but still auto-approved if its
   *  blast radius is well-contained, e.g. a read-only lookup on sensitive data —
   *  or low-risk but still requiresApproval for unrelated policy reasons). */
  riskLevel?: ToolRiskLevel;
  /** If set, transient failures are retried with exponential backoff via the
   *  existing RetryManager (src/lib/core/resilience/RetryManager.ts) instead of
   *  failing on the first error. Omit for tools where a retry could cause a
   *  duplicate side effect (e.g. a payment charge) — retry is opt-in, not default,
   *  specifically to avoid that failure mode. */
  retryPolicy?: {
    maxRetries: number;
    baseDelayMs?: number;
  };
  /**
   * Added per CTO Audit Part 4, section 13 ("AI will never Direct File System,
   * Database, OS Access"). Declares what this tool touches — auditable by a
   * security reviewer against what the tool's code actually does, and the
   * basis for future runtime policy enforcement. NOT currently runtime-enforced
   * for existing tools (see ToolSandbox.ts's header for the technical reason
   * why retroactive enforcement on pre-compiled functions isn't achievable
   * without a bigger architectural change) — this is real, useful metadata
   * today, not yet a hard guarantee.
   */
  resourceAccess?: Array<'database' | 'network' | 'filesystem' | 'payment' | 'none'>;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

export interface ToolContext {
  agentId: string;
  agentRole: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
}

export interface ToolResult<T = any> {
  success: boolean;
  output?: T;
  error?: string;
  durationMs: number;
  requiresApproval?: boolean;
  approvalRequestId?: string;
}

// ── Rate limit state ──────────────────────────────────────────────────────
const rateLimitState = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(toolName: string, agentId: string, limit: { maxCalls: number; windowMs: number }): boolean {
  const key = `${toolName}:${agentId}`;
  const now = Date.now();
  const state = rateLimitState.get(key);

  if (!state || now - state.windowStart > limit.windowMs) {
    rateLimitState.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (state.count >= limit.maxCalls) return false;
  state.count++;
  return true;
}

// ── Tool Registry ─────────────────────────────────────────────────────────
class NexusToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>();
  private executionLog: Array<{
    toolName: string; agentId: string; success: boolean;
    durationMs: number; timestamp: number;
    owner?: string; riskLevel?: ToolRiskLevel;
  }> = [];

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    log.info(`Tool registered: ${tool.name}`, {
      allowedRoles: tool.allowedRoles,
      requiresApproval: tool.requiresApproval,
    });
  }

  unregister(name: string): void {
    this.tools.delete(name);
    log.info(`Tool unregistered: ${name}`);
  }

  listTools(role?: string): ToolDefinition[] {
    const all = Array.from(this.tools.values());
    if (!role) return all;
    return all.filter(t => t.allowedRoles.includes(role) || t.allowedRoles.includes('*'));
  }

  async execute<T = any>(
    toolName: string,
    input: any,
    context: ToolContext,
  ): Promise<ToolResult<T>> {
    const start = Date.now();
    const tool = this.tools.get(toolName);

    if (!tool) {
      return { success: false, error: `Tool not found: ${toolName}`, durationMs: 0 };
    }

    // Role check
    const hasRole = tool.allowedRoles.includes('*') || tool.allowedRoles.includes(context.agentRole);
    if (!hasRole) {
      log.warn(`Tool access denied: ${toolName}`, { agentId: context.agentId, role: context.agentRole });
      EventBus.emitAsync('security.breach_attempt', {
        type: 'unauthorized_tool_access',
        toolName, agentId: context.agentId, agentRole: context.agentRole,
      }, 'ToolRegistry');
      return { success: false, error: `Agent role '${context.agentRole}' not allowed to use tool '${toolName}'`, durationMs: 0 };
    }

    // ── Agent Permission Matrix enforcement (Part 12) ────────────────────────
    // Prior to this change, fileAccess / networkAccess / deletePermission were
    // metadata on AgentCapabilities but never checked at runtime. The comment in
    // AgentRegistry.ts read "Agent Permission Matrix fields ... are metadata only,
    // not enforced" — that ends here. We resolve the agent record and gate each
    // tool's resourceAccess needs against what the agent is declared to have.
    //
    // Fail-open if AgentRegistry.resolve() throws (external DB may be unavailable
    // at startup), so a registry outage never blocks legitimate tool calls.
    if (context.agentId && tool.resourceAccess && tool.resourceAccess.length > 0) {
      try {
        const { AgentRegistry } = await import('../index');
        const agent = AgentRegistry.resolve(context.agentId);
        if (agent?.capabilities) {
          const caps = agent.capabilities;
          const needs = tool.resourceAccess;

          if (needs.includes('filesystem') && caps.fileAccess === false) {
            log.warn('Permission matrix: filesystem access denied', { toolName, agentId: context.agentId });
            EventBus.emitAsync('security.permission_denied', {
              type: 'filesystem_access', toolName, agentId: context.agentId,
            }, 'ToolRegistry');
            return { success: false, error: `Agent '${context.agentId}' does not have fileAccess permission`, durationMs: Date.now() - start };
          }

          if (needs.includes('network') && caps.networkAccess === false) {
            log.warn('Permission matrix: network access denied', { toolName, agentId: context.agentId });
            EventBus.emitAsync('security.permission_denied', {
              type: 'network_access', toolName, agentId: context.agentId,
            }, 'ToolRegistry');
            return { success: false, error: `Agent '${context.agentId}' does not have networkAccess permission`, durationMs: Date.now() - start };
          }
        }
      } catch (_permErr) {
        // Fail-open: if registry lookup fails, proceed with execution
        log.warn('Permission matrix check skipped (registry unavailable)', { toolName, agentId: context.agentId });
      }
    }

    // deletePermission check — enforced for any tool name containing 'delete', 'remove', or 'purge'
    if (context.agentId) {
      const isDestructive = /delete|remove|purge|destroy|wipe/i.test(toolName);
      if (isDestructive) {
        try {
          const { AgentRegistry } = await import('../index');
          const agent = AgentRegistry.resolve(context.agentId);
          if (agent?.capabilities && agent.capabilities.deletePermission === false) {
            log.warn('Permission matrix: delete access denied', { toolName, agentId: context.agentId });
            return { success: false, error: `Agent '${context.agentId}' does not have deletePermission`, durationMs: Date.now() - start };
          }
        } catch (_) { /* fail-open */ }
      }
    }
    // ── End permission matrix ─────────────────────────────────────────────────

    // Rate limit check
    if (tool.rateLimit && !checkRateLimit(toolName, context.agentId, tool.rateLimit)) {
      return { success: false, error: `Rate limit exceeded for tool: ${toolName}`, durationMs: 0 };
    }

    // Human approval gate
    if (tool.requiresApproval && !NexusConfig.features.enableAutonomousAgents) {
      const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      EventBus.emitAsync('agent.approval.required', {
        approvalId, toolName, agentId: context.agentId,
        input, userId: context.userId,
      }, 'ToolRegistry');
      log.warn(`Tool requires approval: ${toolName}`, { approvalId, agentId: context.agentId });
      return {
        success: false,
        requiresApproval: true,
        approvalRequestId: approvalId,
        error: 'Tool execution requires human approval',
        durationMs: Date.now() - start,
      };
    }

    // Execute with timeout (+ retry, if the tool opted in — see retryPolicy's
    // own doc comment for why this is opt-in rather than default)
    try {
      const timeout = tool.timeout || 10_000;
      const runOnce = () => Promise.race([
        tool.execute(input, context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms: ${toolName}`)), timeout)
        ),
      ]);

      const result = tool.retryPolicy
        ? await RetryManager.withRetry(runOnce, tool.retryPolicy.maxRetries, tool.retryPolicy.baseDelayMs)
        : await runOnce();

      const durationMs = Date.now() - start;
      this.executionLog.unshift({
        toolName, agentId: context.agentId, success: true, durationMs, timestamp: Date.now(),
        owner: tool.owner, riskLevel: tool.riskLevel,
      });
      if (this.executionLog.length > 500) this.executionLog.pop();

      log.debug(`Tool executed: ${toolName}`, { durationMs, agentId: context.agentId });
      return { success: true, output: result as T, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      this.executionLog.unshift({
        toolName, agentId: context.agentId, success: false, durationMs, timestamp: Date.now(),
        owner: tool.owner, riskLevel: tool.riskLevel,
      });
      log.error(`Tool failed: ${toolName}`, err instanceof Error ? err : undefined, { agentId: context.agentId });
      // Risk-weighted alerting: a failed critical-risk tool is worth a louder
      // signal than a failed low-risk one — reuses the existing security event
      // taxonomy rather than a parallel channel.
      if (tool.riskLevel === 'critical' || tool.riskLevel === 'high') {
        EventBus.emitAsync('system.health.degraded', {
          reason: `tool_failure:${toolName}`, riskLevel: tool.riskLevel, owner: tool.owner, error,
        }, 'ToolRegistry');
      }
      return { success: false, error, durationMs };
    }
  }

  getExecutionLog(limit = 50) { return this.executionLog.slice(0, limit); }
}

export const ToolRegistry = new NexusToolRegistryImpl();

// ════════════════════════════════════════════════════════════════════════
// BUILT-IN BUSINESS TOOLS
// ════════════════════════════════════════════════════════════════════════
export function registerBuiltInTools(): void {

  // ── Order lookup ─────────────────────────────────────────────────────
  ToolRegistry.register({
    name: 'lookup_order',
    description: 'Look up order details and status by order ID',
    schema: { orderId: 'string' },
    allowedRoles: ['customer_support', 'supervisor', 'order_processor', 'general'],
    requiresApproval: false,
    timeout: 5000,
    rateLimit: { maxCalls: 50, windowMs: 60_000 },
    execute: async ({ orderId }, ctx) => {
      const { db } = await import('../../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'orders', orderId));
      if (!snap.exists()) return { found: false, orderId };
      const data = snap.data();
      return {
        found: true, orderId, status: data.status,
        total: data.total, createdAt: data.createdAt,
        items: data.items?.length || 0,
      };
    },
  });

  // ── Product lookup ───────────────────────────────────────────────────
  ToolRegistry.register({
    name: 'lookup_product',
    description: 'Search for product information by name or ID',
    schema: { query: 'string' },
    allowedRoles: ['*'],
    requiresApproval: false,
    timeout: 5000,
    execute: async ({ query }) => {
      const { db } = await import('../../../firebase');
      const { collection, query: q, where, getDocs, limit } = await import('firebase/firestore');
      const snap = await getDocs(q(collection(db, 'products'),
        where('name', '>=', query), where('name', '<=', query + '\uf8ff'), limit(5)));
      return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    },
  });

  // ── Check stock ──────────────────────────────────────────────────────
  ToolRegistry.register({
    name: 'check_stock',
    description: 'Check current stock level for a product',
    schema: { productId: 'string' },
    allowedRoles: ['inventory', 'supervisor', 'customer_support'],
    requiresApproval: false,
    timeout: 3000,
    execute: async ({ productId }) => {
      const { db } = await import('../../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'products', productId));
      if (!snap.exists()) return { found: false };
      const data = snap.data();
      return { found: true, stock: data.stock, name: data.name, lowStock: data.stock < 10 };
    },
  });

  // ── Send notification ────────────────────────────────────────────────
  ToolRegistry.register({
    name: 'send_notification',
    description: 'Send a push/in-app notification to a user',
    schema: { userId: 'string', title: 'string', message: 'string', channels: 'array' },
    allowedRoles: ['supervisor', 'marketing', 'order_processor'],
    requiresApproval: false,
    timeout: 8000,
    execute: async ({ userId, title, message, channels }) => {
      const { NotificationEngine } = await import('../../notifications/NotificationEngine');
      await NotificationEngine.notify({ userId, title, message, channels: channels || ['in_app'] });
      return { sent: true, userId, channels };
    },
  });

  // ── Semantic memory search ───────────────────────────────────────────
  ToolRegistry.register({
    name: 'search_knowledge',
    description: 'Search the semantic knowledge base for relevant information',
    schema: { query: 'string', collection: 'string' },
    allowedRoles: ['*'],
    requiresApproval: false,
    timeout: 8000,
    execute: async ({ query, collection }) => {
      const { MemoryEngine } = await import('../../memory/NexusMemoryEngine');
      return MemoryEngine.semanticSearch(query, { collection, topK: 5 });
    },
  });

  // ── Update order status ──────────────────────────────────────────────
  ToolRegistry.register({
    name: 'update_order_status',
    description: 'Update the status of an order',
    schema: { orderId: 'string', status: 'string', note: 'string' },
    allowedRoles: ['order_processor', 'supervisor'],
    requiresApproval: true,   // Requires human approval
    timeout: 5000,
    execute: async ({ orderId, status, note }) => {
      const { db } = await import('../../../firebase');
      const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
      await updateDoc(doc(db, 'orders', orderId), {
        status, updatedAt: serverTimestamp(), note: note || '',
      });
      return { updated: true, orderId, status };
    },
  });

  // ── Calculate price ──────────────────────────────────────────────────
  ToolRegistry.register({
    name: 'calculate_price',
    description: 'Calculate total price with discounts and delivery',
    schema: { items: 'array', discountCode: 'string', deliveryZone: 'string' },
    allowedRoles: ['*'],
    requiresApproval: false,
    timeout: 2000,
    execute: async ({ items, discountCode }) => {
      const subtotal = (items || []).reduce((sum: number, item: any) =>
        sum + (item.price || 0) * (item.quantity || 1), 0);
      const discount = discountCode === 'SAVE10' ? subtotal * 0.1 : 0;
      const delivery = subtotal > 50 ? 0 : 5;
      return { subtotal, discount, delivery, total: subtotal - discount + delivery };
    },
  });

  // ── Get customer history ─────────────────────────────────────────────
  ToolRegistry.register({
    name: 'get_customer_history',
    description: 'Retrieve order history for a customer',
    schema: { userId: 'string', limit: 'number' },
    allowedRoles: ['customer_support', 'supervisor', 'analytics'],
    requiresApproval: false,
    timeout: 8000,
    rateLimit: { maxCalls: 20, windowMs: 60_000 },
    execute: async ({ userId, limit: lim = 10 }) => {
      const { db } = await import('../../../firebase');
      const { collection, query: q, where, orderBy, getDocs, limit } = await import('firebase/firestore');
      const snap = await getDocs(q(
        collection(db, 'orders'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(lim),
      ));
      return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    },
  });

  // ── Detect fraud risk ────────────────────────────────────────────────
  ToolRegistry.register({
    name: 'assess_fraud_risk',
    description: 'Run fraud detection on an order or user action',
    schema: { userId: 'string', amount: 'number', email: 'string' },
    allowedRoles: ['fraud_detector', 'supervisor', 'payment'],
    requiresApproval: false,
    timeout: 5000,
    execute: async ({ userId, amount, email }) => {
      const { FraudDetectionEngine } = await import('../../security/FraudDetectionEngine');
      return FraudDetectionEngine.assess({ userId, amount, email, itemCount: 1 });
    },
  });

  log.info('Built-in tools registered: 9 tools');
}
