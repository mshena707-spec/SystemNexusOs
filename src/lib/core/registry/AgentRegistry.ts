/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                    NEXUS AGENT REGISTRY                      ║
 * ║  Central catalog of all agents. Lifecycle management.        ║
 * ║  Foundation for Phase 3 multi-agent orchestration.           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE:
 *   Every agent in the system registers here.
 *   The Orchestrator uses this to discover and invoke agents.
 *   Enables hot-swapping, versioning, and health tracking.
 *
 * USAGE:
 *   AgentRegistry.register('customer-support', new CustomerSupportAgent(), {
 *     role: 'customer_support',
 *     capabilities: ['chat', 'order_lookup', 'complaint_handling'],
 *     maxConcurrent: 10,
 *   });
 *
 *   const agent = AgentRegistry.resolve('customer-support');
 */

import { logger } from '../logging/NexusLogger';
import { EventBus } from '../events/NexusEventBus';

const log = logger.child('AgentRegistry');

// ── Agent types ───────────────────────────────────────────────────────────
export type AgentRole =
  | 'supervisor'          // Oversees other agents
  | 'planner'             // Decomposes tasks
  | 'critic'              // Validates outputs
  | 'customer_support'    // Handles customer queries
  | 'order_processor'     // Manages order lifecycle
  | 'fraud_detector'      // Risk assessment
  | 'marketing'           // Campaign and retention
  | 'analytics'           // Business intelligence
  | 'logistics'           // Rider and delivery
  | 'inventory'           // Stock management
  | 'payment'             // Payment processing
  | 'general'             // Generic purpose
  | string;

export type AgentStatus = 'idle' | 'active' | 'paused' | 'failed' | 'shutdown';

export interface EscalationRule {
  /** What triggers this rule: confidence below threshold, a specific tool denied,
   *  or a specific memory access denied. Checked in order; first match wins. */
  trigger: 'low_confidence' | 'tool_denied' | 'memory_denied' | 'max_depth_reached';
  /** Who/what handles it: a specific agentId, an AgentLevel from AgentHierarchy
   *  (src/lib/agents/AgentHierarchy.ts), or 'human' for agent.approval.required. */
  escalateTo: string | 'human';
  note?: string;
}

export interface AgentCapabilities {
  role: AgentRole;
  capabilities: string[];       // e.g. ['chat', 'order_lookup', 'refund']
  maxConcurrent: number;        // Max parallel executions
  requiresApproval: boolean;    // Human-in-the-loop
  canUseTools: string[];        // Tool IDs this agent is allowed to use
  /** Widened from the original 5 values (read/write/personal/shared/immutable) to
   *  also include 'restricted' and 'learning' — matching MemoryType.RESTRICTED and
   *  MemoryType.LEARNING in src/lib/memory/interfaces/MemoryTypes.ts. FraudDetectorAgent
   *  and MarketingAgent (SpecialistAgents.ts) were already using these two values;
   *  `tsc --noEmit` (= `npm run lint`) confirms they were type errors before this fix —
   *  see docs/governance/TECHNICAL_DEBT_REGISTER.md. */
  memoryAccess: ('read' | 'write' | 'personal' | 'shared' | 'immutable' | 'restricted' | 'learning')[];
  priority: number;             // 1 (low) to 10 (critical)
  version: string;
  description: string;

  // ── Added per CTO Audit Part 3, section 4: the audit asked for a unified
  // profile covering Hierarchy + Role + Permission + Memory + Tool + API,
  // enforced together. Role/Memory/Tool/Priority already existed above (and
  // Hierarchy is enforced separately by AgentHierarchy.assertAuthority — see
  // docs/architecture/AGENT_PROTOCOL.md). These four were the confirmed gap.
  // All optional: existing capability declarations remain valid unchanged.

  /** External API identifiers this agent may call directly (payment gateways,
   *  SMS providers, etc.) — separate from canUseTools, which covers internal
   *  ToolRegistry tools. Omitted/undefined means "no direct external API access,"
   *  not "unrestricted" — the safe default for a new agent. */
  allowedAPIs?: string[];

  /** Which OTHER agentIds this agent may invoke/delegate to (e.g. SupervisorAgent
   *  calling 'planner-001', 'critic-001'). Omitted means "cannot invoke other
   *  agents" — the safe default. This is a second, finer-grained control layered
   *  on top of AgentHierarchy's level-based authority check: hierarchy answers
   *  "is this level allowed to override that level," this answers "is this
   *  specific agent allowed to call that specific agent," which matters once
   *  two agents are at the same hierarchy level but shouldn't call each other. */
  allowedAgents?: string[];

  /** Below this confidence, output should be treated as provisional — checked
   *  against AgentOutput.confidence by the caller (e.g. SupervisorAgent already
   *  does an ad hoc version of this at 0.5; formalizing it here makes the
   *  threshold a declared property of the agent instead of a magic number
   *  hardcoded at each call site). Default assumed 0.5 if unset. */
  confidenceThreshold?: number;

  /** What happens when this agent can't proceed confidently or is denied a
   *  tool/memory access. Checked in array order. If empty/unset, the caller's
   *  own fallback applies (e.g. SupervisorAgent._directRoute) — these rules let
   *  an agent declare a MORE SPECIFIC escalation path than the generic fallback. */
  escalationRules?: EscalationRule[];

  // ── Added per CTO Audit Part 4, section 4: "Each Agent will have Memory
  // Permission, API Permission, Tool Permission, File Permission, Network
  // Permission, Delete Permission, Learning Permission." Memory (memoryAccess),
  // Tool (canUseTools), and API (allowedAPIs, added in Part 3) already existed.
  // These three complete the list. All default to the safe/restrictive reading
  // when unset (no file access, no direct network, no delete) — an agent
  // declaration written before these fields existed should be interpreted as
  // NOT having these permissions, not as unrestricted.

  /** Explicit opt-in for filesystem access. Almost no agent should need this —
   *  NexusDB (docs/architecture/DATABASE_SCHEMA.md) is the sanctioned data path.
   *  Real, legitimate use: an agent that reads/writes generated reports or
   *  exports, not one doing business logic. */
  fileAccess?: boolean;

  /** Explicit opt-in for direct outbound network calls (not through NexusDB,
   *  not through a registered Tool). Most agents should reach external services
   *  via a Tool (ToolDefinition already has its own resourceAccess declaration)
   *  rather than this — this flag is for the rare case of an agent needing raw
   *  network access outside the tool-calling pattern. */
  networkAccess?: boolean;

  /** Explicit opt-in for delete operations (memory, records, files). Separate
   *  from write access on purpose — deletion is harder to recover from than an
   *  incorrect write, and CTO Audit Part 3's MEMORY_ARCHITECTURE.md flagged
   *  retention/deletion as under-governed even before this field existed. */
  deletePermission?: boolean;

  /** Explicit opt-in for submitting content to LearningApprovalGate
   *  (src/lib/memory/LearningApprovalGate.ts, Part 3) at all — a coarser gate
   *  than that module's own confidence threshold. An agent without this
   *  permission can't propose new learned knowledge regardless of how
   *  confident it is; one with it still goes through the confidence-based
   *  approval queue for anything below the auto-approve threshold. Two
   *  independent gates on purpose: this answers "should this agent be
   *  learning at all," confidence answers "is this specific write safe enough
   *  to auto-commit." */
  learningPermission?: boolean;
}

/**
 * Standard agent lifecycle — extended per CTO Audit Part 2, section 4 (Liskov
 * Substitution: "All agents should follow the same lifecycle: initialize(),
 * reason(), execute(), learn(), shutdown()").
 *
 * `execute` was already required and `ping`/`shutdown` already optional — 7 of the
 * 8 agent classes in this codebase (SupervisorAgent + the 6 BaseAgent subclasses in
 * SpecialistAgents.ts) already implement this correctly. `initialize` and `learn`
 * are added here as OPTIONAL, not required, specifically so this is a non-breaking
 * change — every existing implementer remains valid without modification. Make them
 * required only once every real agent has a meaningful implementation for both;
 * forcing empty no-op methods on 7 classes today would be worse than not having
 * the hook yet.
 *
 * The one confirmed exception is CEOAgent (src/lib/orchestration/agents/CEOAgent.ts),
 * which does not implement IAgent at all — see docs/architecture/AGENT_PROTOCOL.md
 * for why, and why forcing it to conform wasn't done as part of this same change.
 */
export interface IAgent {
  agentId: string;
  /** Optional: one-time setup (load config, warm caches, register tools). Runs once
   *  before the agent's first execute() — not before every call. */
  initialize?(): Promise<void>;
  /** Optional: the deliberation step before acting — where TaskDecomposer/
   *  ConfidenceScorer (src/lib/orchestration/pipeline/ConfidenceAndDecomposer.ts)
   *  naturally plug in. Kept separate from execute() so an agent can expose "what
   *  I'm about to do and how confident I am" before committing to a side effect —
   *  useful for the agent.approval.required flow in docs/governance/AI_GOVERNANCE.md. */
  reason?(input: AgentInput): Promise<{ plan: string; confidence: number }>;
  execute(input: AgentInput): Promise<AgentOutput>;
  /** Optional: feed the outcome back into the memory/learning system
   *  (src/lib/memory/interfaces/MemoryTypes.ts's LearningMemory type already exists
   *  for exactly this). */
  learn?(input: AgentInput, output: AgentOutput): Promise<void>;
  ping?(): Promise<boolean>;
  shutdown?(): Promise<void>;
}

export interface AgentInput {
  task: string;
  context?: Record<string, any>;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  parentAgentId?: string;
  maxDepth?: number;
}

export interface AgentOutput {
  success: boolean;
  result: any;
  confidence: number;       // 0.0 to 1.0
  tokensUsed?: number;
  durationMs?: number;
  requiresApproval?: boolean;
  nextSteps?: string[];
  error?: string;
}

export interface RegisteredAgent {
  id: string;
  agent: IAgent;
  capabilities: AgentCapabilities;
  status: AgentStatus;
  metrics: {
    totalExecutions: number;
    successRate: number;
    avgDurationMs: number;
    lastExecutedAt: number | null;
    consecutiveFailures: number;
  };
  registeredAt: number;
}

// ── Agent Registry ────────────────────────────────────────────────────────
class NexusAgentRegistryImpl {
  private agents = new Map<string, RegisteredAgent>();
  private maxConsecutiveFailures = 3;

  /** Register an agent */
  register(id: string, agent: IAgent, capabilities: AgentCapabilities): void {
    if (this.agents.has(id)) {
      log.warn(`Agent already registered, overwriting: ${id}`);
    }

    this.agents.set(id, {
      id,
      agent,
      capabilities,
      status: 'idle',
      metrics: {
        totalExecutions: 0,
        successRate: 1.0,
        avgDurationMs: 0,
        lastExecutedAt: null,
        consecutiveFailures: 0,
      },
      registeredAt: Date.now(),
    });

    log.info(`Agent registered: ${id}`, {
      role: capabilities.role,
      capabilities: capabilities.capabilities,
      version: capabilities.version,
    });
  }

  /** Unregister an agent */
  async unregister(id: string): Promise<void> {
    const entry = this.agents.get(id);
    if (!entry) return;

    try {
      await entry.agent.shutdown?.();
    } catch (e) {
      log.warn(`Agent shutdown error: ${id}`, { error: String(e) });
    }

    this.agents.delete(id);
    log.info(`Agent unregistered: ${id}`);
  }

  /** Resolve an agent by ID */
  resolve(id: string): RegisteredAgent | undefined {
    return this.agents.get(id);
  }

  /** Find agents by role */
  findByRole(role: AgentRole): RegisteredAgent[] {
    return Array.from(this.agents.values())
      .filter(a => a.capabilities.role === role && a.status !== 'failed' && a.status !== 'shutdown');
  }

  /** Find agents by capability */
  findByCapability(capability: string): RegisteredAgent[] {
    return Array.from(this.agents.values())
      .filter(a =>
        a.capabilities.capabilities.includes(capability) &&
        a.status !== 'failed' &&
        a.status !== 'shutdown'
      )
      .sort((a, b) => b.capabilities.priority - a.capabilities.priority);
  }

  /** Execute an agent with metrics tracking */
  async execute(agentId: string, input: AgentInput): Promise<AgentOutput> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      return { success: false, result: null, confidence: 0, error: `Agent not found: ${agentId}` };
    }
    if (entry.status === 'failed' || entry.status === 'shutdown') {
      return { success: false, result: null, confidence: 0, error: `Agent unavailable: ${entry.status}` };
    }
    if (entry.capabilities.requiresApproval) {
      EventBus.emitAsync('agent.approval.required', {
        agentId,
        task: input.task,
        userId: input.userId,
      }, 'AgentRegistry');
      return { success: false, result: null, confidence: 0, requiresApproval: true, error: 'Human approval required' };
    }

    const start = Date.now();
    entry.status = 'active';
    entry.metrics.totalExecutions++;

    EventBus.emitAsync('agent.task.started', { agentId, task: input.task, traceId: input.traceId }, 'AgentRegistry');

    try {
      const output = await entry.agent.execute(input);
      const duration = Date.now() - start;

      entry.status = 'idle';
      entry.metrics.consecutiveFailures = 0;
      entry.metrics.lastExecutedAt = Date.now();
      entry.metrics.avgDurationMs = (entry.metrics.avgDurationMs * 0.9) + (duration * 0.1);
      const prevSuccess = entry.metrics.successRate * (entry.metrics.totalExecutions - 1);
      entry.metrics.successRate = (prevSuccess + (output.success ? 1 : 0)) / entry.metrics.totalExecutions;

      EventBus.emitAsync('agent.task.completed', {
        agentId, success: output.success, durationMs: duration, traceId: input.traceId,
      }, 'AgentRegistry');

      log.debug(`Agent ${agentId} completed`, {
        success: output.success,
        confidence: output.confidence,
        duration_ms: duration,
      });

      return { ...output, durationMs: duration };
    } catch (err) {
      const duration = Date.now() - start;
      entry.metrics.consecutiveFailures++;
      entry.metrics.lastExecutedAt = Date.now();

      if (entry.metrics.consecutiveFailures >= this.maxConsecutiveFailures) {
        entry.status = 'failed';
        log.error(`Agent ${agentId} marked as FAILED after ${entry.metrics.consecutiveFailures} consecutive failures`, err instanceof Error ? err : undefined);
        EventBus.emitAsync('agent.task.failed', { agentId, error: String(err), status: 'failed' }, 'AgentRegistry');
      } else {
        entry.status = 'idle';
        EventBus.emitAsync('agent.task.failed', { agentId, error: String(err), status: 'retryable' }, 'AgentRegistry');
      }

      log.error(`Agent ${agentId} execution failed`, err instanceof Error ? err : undefined, { durationMs: duration });

      return {
        success: false,
        result: null,
        confidence: 0,
        durationMs: duration,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Get health summary for all agents */
  /**
   * Added during CTO Audit Part 10 response (2026-07-27) — answers Part 10's
   * suggested future addition, "Capability Registry: Registry of what each
   * agent can do." Not a new system: `AgentCapabilities` (role, memory/tool/
   * API/agent access, confidence threshold, escalation rules) has existed
   * since Parts 3-4 on every registered agent — this is the first method
   * that surfaces it as one queryable list, which didn't exist before.
   * Real, current data only — reads the live registry, not a static
   * document that can drift from what's actually registered.
   */
  listCapabilities() {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      role: a.capabilities.role,
      capabilities: a.capabilities.capabilities,
      memoryAccess: a.capabilities.memoryAccess,
      canUseTools: a.capabilities.canUseTools,
      allowedAPIs: a.capabilities.allowedAPIs ?? [],
      allowedAgents: a.capabilities.allowedAgents ?? [],
      fileAccess: a.capabilities.fileAccess ?? false,
      networkAccess: a.capabilities.networkAccess ?? false,
      deletePermission: a.capabilities.deletePermission ?? false,
      learningPermission: a.capabilities.learningPermission ?? false,
      confidenceThreshold: a.capabilities.confidenceThreshold ?? null,
      escalationRules: a.capabilities.escalationRules ?? [],
      requiresApproval: a.capabilities.requiresApproval,
      priority: a.capabilities.priority,
      version: a.capabilities.version,
    }));
  }

  getHealthSummary() {
    const all = Array.from(this.agents.values());
    return {
      total: all.length,
      idle: all.filter(a => a.status === 'idle').length,
      active: all.filter(a => a.status === 'active').length,
      failed: all.filter(a => a.status === 'failed').length,
      agents: all.map(a => ({
        id: a.id,
        role: a.capabilities.role,
        status: a.status,
        successRate: Math.round(a.metrics.successRate * 100),
        totalExecutions: a.metrics.totalExecutions,
        avgDurationMs: Math.round(a.metrics.avgDurationMs),
        version: a.capabilities.version,
      })),
    };
  }

  /** Pause/resume an agent */
  setStatus(agentId: string, status: 'paused' | 'idle'): void {
    const entry = this.agents.get(agentId);
    if (entry && entry.status !== 'failed' && entry.status !== 'shutdown') {
      entry.status = status;
      log.info(`Agent ${agentId} status set to: ${status}`);
    }
  }

  /** Ping all agents and mark unhealthy ones */
  async pingAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [id, entry] of this.agents.entries()) {
      if (!entry.agent.ping) { results[id] = true; continue; }
      try {
        results[id] = await entry.agent.ping();
        if (!results[id] && entry.status !== 'paused') {
          entry.metrics.consecutiveFailures++;
          if (entry.metrics.consecutiveFailures >= this.maxConsecutiveFailures) {
            entry.status = 'failed';
            EventBus.emitAsync('agent.task.failed', { agentId: id, status: 'failed', reason: 'ping failed' }, 'AgentRegistry');
          }
        } else {
          entry.metrics.consecutiveFailures = 0;
        }
      } catch {
        results[id] = false;
      }
    }
    return results;
  }
}

/** Global AgentRegistry singleton */
export const AgentRegistry = new NexusAgentRegistryImpl();
