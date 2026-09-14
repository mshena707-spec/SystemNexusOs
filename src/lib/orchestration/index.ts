/**
 * NEXUS ORCHESTRATION ENGINE — Public API & Boot Registration
 * Phase 3: Multi-agent orchestration system
 *
 * USAGE:
 *   import { initOrchestration, Orchestrator } from '@/lib/orchestration';
 *
 *   // Boot (called from SystemBoot)
 *   await initOrchestration();
 *
 *   // Process any task through the full agent hierarchy
 *   const result = await Orchestrator.process({
 *     task: 'Customer complaint about late delivery',
 *     userId: 'user-123',
 *     sessionId: 'sess-abc',
 *   });
 */

import { AgentRegistry } from '../core/registry/AgentRegistry';
import { ToolRegistry, registerBuiltInTools } from './tools/ToolRegistry';
import {
  PlannerAgent,
  CriticAgent,
  CustomerSupportAgent,
  FraudDetectorAgent,
  OrderProcessorAgent,
  MarketingAgent,
} from './agents/SpecialistAgents';
import { SupervisorAgent } from './agents/SupervisorAgent';
import { logger } from '../core/logging/NexusLogger';
import { AgentInput, AgentOutput } from '../core/registry/AgentRegistry';

const log = logger.child('Orchestration');
let initialized = false;

// ── Boot all agents ───────────────────────────────────────────────────────
export async function initOrchestration(): Promise<void> {
  if (initialized) return;
  initialized = true;

  log.info('Initializing orchestration engine...');

  // 1. Register built-in tools
  registerBuiltInTools();

  // 2. Register all specialist agents
  const supervisor = new SupervisorAgent();
  AgentRegistry.register(supervisor.agentId, supervisor, SupervisorAgent.capabilities);

  const planner = new PlannerAgent();
  AgentRegistry.register(planner.agentId, planner, PlannerAgent.capabilities);

  const critic = new CriticAgent();
  AgentRegistry.register(critic.agentId, critic, CriticAgent.capabilities);

  const support = new CustomerSupportAgent();
  AgentRegistry.register(support.agentId, support, CustomerSupportAgent.capabilities);

  const fraud = new FraudDetectorAgent();
  AgentRegistry.register(fraud.agentId, fraud, FraudDetectorAgent.capabilities);

  const orders = new OrderProcessorAgent();
  AgentRegistry.register(orders.agentId, orders, OrderProcessorAgent.capabilities);

  const marketing = new MarketingAgent();
  AgentRegistry.register(marketing.agentId, marketing, MarketingAgent.capabilities);

  const summary = AgentRegistry.getHealthSummary();
  log.info(`Orchestration ready: ${summary.total} agents, ${ToolRegistry.listTools().length} tools`);
}

// ── Primary entry point ───────────────────────────────────────────────────
class OrchestratorImpl {
  /** Route any task through the full supervisor → planner → specialist → critic pipeline */
  async process(input: AgentInput): Promise<AgentOutput> {
    if (!initialized) await initOrchestration();
    return AgentRegistry.execute('supervisor-001', input);
  }

  /** Execute a specific agent directly (bypasses supervisor) */
  async executeAgent(agentId: string, input: AgentInput): Promise<AgentOutput> {
    return AgentRegistry.execute(agentId, input);
  }

  /** Use a specific tool directly */
  async executeTool(toolName: string, toolInput: any, context: { agentId: string; agentRole: string }) {
    return ToolRegistry.execute(toolName, toolInput, context);
  }

  getAgentHealth() { return AgentRegistry.getHealthSummary(); }
  listTools(role?: string) { return ToolRegistry.listTools(role); }
  getToolLog(limit = 50) { return ToolRegistry.getExecutionLog(limit); }
}

export const Orchestrator = new OrchestratorImpl();

// Re-exports
export { AgentRegistry } from '../core/registry/AgentRegistry';
export { ToolRegistry } from './tools/ToolRegistry';
export { ArbitrationSystem } from './agents/SupervisorAgent';
export { ConfidenceScorer, TaskDecomposer } from './pipeline/ConfidenceAndDecomposer';
export type { AgentInput, AgentOutput } from '../core/registry/AgentRegistry';
