/**
 * NEXUS SPECIALIST AGENTS — Phase 3
 * Concrete agent implementations for specific business roles.
 * All extend BaseAgent and register in AgentRegistry.
 */

import { IAgent, AgentInput, AgentOutput, AgentCapabilities } from '../../core/registry/AgentRegistry';
import { ToolRegistry, ToolContext } from '../tools/ToolRegistry';
import { MemoryEngine } from '../../memory/NexusMemoryEngine';
import { NexusUnifiedCore } from '../../core/NexusUnifiedCore';
import { ConfidenceScorer, TaskDecomposer } from '../pipeline/ConfidenceAndDecomposer';
import { logger } from '../../core/logging/NexusLogger';
import { EventBus } from '../../core/events/NexusEventBus';

// ── Base Agent ────────────────────────────────────────────────────────────
// Exported (was previously file-private) so plugins under src/plugins/ can extend
// the same base — see docs/adr/0008-plugin-architecture.md. No existing behavior
// changes; this only widens what can import it.
export abstract class BaseAgent implements IAgent {
  abstract agentId: string;
  abstract role: string;

  protected log = logger.child(this.constructor.name);

  protected toolCtx(input: AgentInput): ToolContext {
    return {
      agentId: this.agentId,
      agentRole: this.role,
      userId: input.userId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    };
  }

  protected buildOutput(
    success: boolean, result: any,
    params: { toolsUsed?: string[]; agreements?: number; disagreements?: number; task?: string; contextFound?: boolean } = {}
  ): AgentOutput {
    const textSignals = ConfidenceScorer.scoreText(
      typeof result === 'string' ? result : JSON.stringify(result)
    );
    const confidence = ConfidenceScorer.score({
      responseLength: typeof result === 'string' ? result.length : 100,
      hasUncertainPhrases: textSignals.hasUncertain,
      hasSpecificData: textSignals.hasSpecific,
      toolsUsed: params.toolsUsed || [],
      agentAgreements: params.agreements || 0,
      agentDisagreements: params.disagreements || 0,
      taskComplexity: 'moderate',
      memoryContextFound: params.contextFound || false,
    });
    return { success, result, confidence: confidence.score, nextSteps: [] };
  }

  abstract execute(input: AgentInput): Promise<AgentOutput>;

  async ping(): Promise<boolean> { return true; }
}

// ════════════════════════════════════════════════════════════════════════
// PLANNER AGENT
// Decomposes complex tasks into ordered sub-task execution plans
// ════════════════════════════════════════════════════════════════════════
export class PlannerAgent extends BaseAgent {
  agentId = 'planner-001';
  role = 'planner';

  static capabilities: AgentCapabilities = {
    role: 'planner',
    capabilities: ['task_decomposition', 'dependency_resolution', 'parallel_planning'],
    maxConcurrent: 5,
    requiresApproval: false,
    canUseTools: [],
    memoryAccess: ['read', 'personal'],
    priority: 9,
    version: '1.0.0',
    description: 'Decomposes complex tasks into ordered execution plans',
  };

  async execute(input: AgentInput): Promise<AgentOutput> {
    const plan = TaskDecomposer.decompose(input.task, input.context);
    const waves = TaskDecomposer.getExecutionOrder(plan);

    this.log.info('Task decomposed', {
      task: input.task.slice(0, 60),
      subTasks: plan.subTasks.length,
      waves: waves.length,
      complexity: plan.complexity,
    });

    return {
      success: true,
      result: { plan, executionWaves: waves },
      confidence: 0.9,
      nextSteps: waves[0]?.map(t => `Execute: ${t.description}`) || [],
    };
  }
}

// ════════════════════════════════════════════════════════════════════════
// CRITIC AGENT
// Reviews outputs from other agents and validates quality
// ════════════════════════════════════════════════════════════════════════
export class CriticAgent extends BaseAgent {
  agentId = 'critic-001';
  role = 'critic';

  static capabilities: AgentCapabilities = {
    role: 'critic',
    capabilities: ['output_validation', 'quality_scoring', 'hallucination_detection', 'fact_checking'],
    maxConcurrent: 10,
    requiresApproval: false,
    canUseTools: ['lookup_order', 'lookup_product', 'search_knowledge'],
    memoryAccess: ['read', 'shared'],
    priority: 8,
    version: '1.0.0',
    description: 'Validates and critiques outputs from other agents',
  };

  async execute(input: AgentInput): Promise<AgentOutput> {
    const { agentResponse, originalTask, agentId: reviewedAgent } = input.context || {};
    if (!agentResponse) {
      return { success: false, result: null, confidence: 0, error: 'No agent response provided for critique' };
    }

    // Structural checks
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!agentResponse || agentResponse.length < 10) {
      issues.push('Response is too short or empty');
    }

    const { hasUncertain } = ConfidenceScorer.scoreText(agentResponse);
    if (hasUncertain) {
      issues.push('Response contains uncertain language');
      suggestions.push('Use tool to verify factual claims');
    }

    // Hallucination signals
    const claimsOrderId = /order\s+#[A-Z0-9-]+/i.test(agentResponse);
    const claimsPrice = /\$[\d,.]+/i.test(agentResponse);
    if ((claimsOrderId || claimsPrice) && !input.context?.toolsUsed?.length) {
      issues.push('Response contains specific data claims without tool verification');
      suggestions.push('Verify order/price data using lookup_order or lookup_product tools');
    }

    // Ask AI to critique
    let aiCritique = '';
    try {
      const critiqueResult = await NexusUnifiedCore.process(
        `You are a quality critic. Briefly assess this customer support response (2-3 sentences max):
Task: "${originalTask}"
Response: "${agentResponse?.slice(0, 500)}"

Identify: accuracy, helpfulness, tone. Be concise.`,
        { agentRole: 'critic', systemInstruction: 'You are a quality critic. Be concise and direct.' }
      );
      aiCritique = critiqueResult.text;
    } catch (_) {}

    const approved = issues.length === 0;
    const critScore = Math.max(0.2, 1 - issues.length * 0.25);

    this.log.debug('Critique complete', {
      reviewedAgent, issues: issues.length, approved, score: critScore,
    });

    return {
      success: true,
      result: { approved, issues, suggestions, aiCritique, critScore, reviewedAgent },
      confidence: 0.85,
      nextSteps: approved ? [] : suggestions,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════
// CUSTOMER SUPPORT AGENT
// Primary interface for omnichannel customer interactions
// ════════════════════════════════════════════════════════════════════════
export class CustomerSupportAgent extends BaseAgent {
  agentId = 'customer-support-001';
  role = 'customer_support';

  static capabilities: AgentCapabilities = {
    role: 'customer_support',
    capabilities: ['chat', 'order_lookup', 'complaint_handling', 'product_info', 'refund_initiation'],
    maxConcurrent: 50,
    requiresApproval: false,
    canUseTools: ['lookup_order', 'lookup_product', 'check_stock', 'send_notification',
                  'get_customer_history', 'calculate_price', 'search_knowledge'],
    memoryAccess: ['read', 'write', 'personal', 'shared'],
    priority: 7,
    version: '1.0.0',
    description: 'Primary customer-facing support agent',
  };

  async execute(input: AgentInput): Promise<AgentOutput> {
    const ctx = this.toolCtx(input);
    const toolsUsed: string[] = [];

    // 1. Get conversation context from episodic memory
    let memoryContext = '';
    let contextFound = false;
    if (input.sessionId) {
      try {
        const caller = { id: input.userId || 'system', type: 'user' as const, roles: [], isOwner: false };
        const episode = await MemoryEngine.getEpisode(input.sessionId, caller);
        if (episode?.episode?.length) {
          memoryContext = episode.episode.slice(-4).map(e => `${e.role}: ${e.content}`).join('\n');
          contextFound = true;
        }
      } catch (_) {}
    }

    // 2. Search semantic knowledge base
    let knowledgeContext = '';
    try {
      const results = await ToolRegistry.execute('search_knowledge', { query: input.task, collection: 'product_kb' }, ctx);
      if (results.success && results.output?.length) {
        knowledgeContext = results.output.slice(0, 2).map((r: any) => r.content).join('\n');
        toolsUsed.push('search_knowledge');
      }
    } catch (_) {}

    // 3. Auto-use tools based on task content
    let orderData: any = null;
    const orderMatch = input.task.match(/#?([A-Z0-9-]{6,})/);
    if (orderMatch && input.task.toLowerCase().includes('order')) {
      const result = await ToolRegistry.execute('lookup_order', { orderId: orderMatch[1] }, ctx);
      if (result.success) { orderData = result.output; toolsUsed.push('lookup_order'); }
    }

    // 4. Generate AI response with full context
    const systemPrompt = `You are a helpful, friendly customer support agent for an e-commerce business.
Be concise (2-4 sentences), warm, and solution-focused.
${memoryContext ? `\nConversation history:\n${memoryContext}` : ''}
${knowledgeContext ? `\nProduct knowledge:\n${knowledgeContext}` : ''}
${orderData ? `\nOrder data: ${JSON.stringify(orderData)}` : ''}`;

    const aiResult = await NexusUnifiedCore.process(input.task, {
      agentRole: 'customer_support',
      systemInstruction: systemPrompt,
      userId: input.userId,
    });

    // 5. Save to episodic memory
    if (input.sessionId && input.userId) {
      try {
        const caller = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };
        await MemoryEngine.appendToEpisode(input.sessionId, [
          { role: 'user', content: input.task, timestamp: Date.now() },
          { role: 'assistant', content: aiResult.text, timestamp: Date.now(), modelUsed: aiResult.modelName, toolCalls: toolsUsed.map(t => ({ tool: t, input: {}, output: {} })) },
        ], caller);
      } catch (_) {}
    }

    return this.buildOutput(true, aiResult.text, { toolsUsed, contextFound });
  }
}

// ════════════════════════════════════════════════════════════════════════
// FRAUD DETECTOR AGENT
// Specialized risk assessment agent
// ════════════════════════════════════════════════════════════════════════
export class FraudDetectorAgent extends BaseAgent {
  agentId = 'fraud-detector-001';
  role = 'fraud_detector';

  static capabilities: AgentCapabilities = {
    role: 'fraud_detector',
    capabilities: ['fraud_assessment', 'velocity_check', 'ip_analysis', 'pattern_matching'],
    maxConcurrent: 100,
    requiresApproval: false,
    canUseTools: ['assess_fraud_risk', 'get_customer_history', 'lookup_order'],
    memoryAccess: ['read', 'restricted'],
    priority: 10,
    version: '1.0.0',
    description: 'Real-time fraud detection and risk assessment',
    // Tighter than SupervisorAgent's 0.5 default, per docs/governance/AI_GOVERNANCE.md's
    // recommendation that fraud/pricing deserve the tightest thresholds — a wrong
    // fraud call costs money and customer trust directly, not just a suboptimal answer.
    confidenceThreshold: 0.75,
    escalationRules: [
      { trigger: 'low_confidence', escalateTo: 'human', note: 'Ambiguous fraud signal — false-positive (blocking a real customer) and false-negative (missing real fraud) are both costly enough to warrant a human look rather than an autonomous call.' },
    ],
  };

  async execute(input: AgentInput): Promise<AgentOutput> {
    const ctx = this.toolCtx(input);
    const { userId, amount, email } = input.context || {};

    const result = await ToolRegistry.execute('assess_fraud_risk', { userId, amount, email }, ctx);

    if (!result.success) {
      return { success: false, result: null, confidence: 0, error: result.error };
    }

    const assessment = result.output;
    if (assessment.decision === 'block') {
      EventBus.emitAsync('fraud.detected', { userId, amount, assessment }, 'FraudDetectorAgent');
      this.log.warn('Fraud detected', { userId, riskScore: assessment.riskScore, decision: assessment.decision });
    }

    return {
      success: true,
      result: assessment,
      confidence: 0.92,
      nextSteps: assessment.decision === 'block' ? ['Block order', 'Notify admin'] :
                 assessment.decision === 'review' ? ['Hold for manual review'] : [],
    };
  }
}

// ════════════════════════════════════════════════════════════════════════
// ORDER PROCESSOR AGENT
// Handles complete order lifecycle
// ════════════════════════════════════════════════════════════════════════
export class OrderProcessorAgent extends BaseAgent {
  agentId = 'order-processor-001';
  role = 'order_processor';

  static capabilities: AgentCapabilities = {
    role: 'order_processor',
    capabilities: ['order_creation', 'order_update', 'payment_processing', 'stock_reservation'],
    maxConcurrent: 20,
    requiresApproval: false,
    canUseTools: ['lookup_order', 'check_stock', 'calculate_price', 'update_order_status', 'send_notification', 'assess_fraud_risk'],
    memoryAccess: ['read', 'write', 'shared'],
    priority: 9,
    version: '1.0.0',
    description: 'Manages complete order lifecycle from creation to delivery',
  };

  async execute(input: AgentInput): Promise<AgentOutput> {
    const ctx = this.toolCtx(input);
    const { action, orderId, items, userId } = input.context || {};
    const toolsUsed: string[] = [];

    if (action === 'status_update' && orderId) {
      const lookup = await ToolRegistry.execute('lookup_order', { orderId }, ctx);
      toolsUsed.push('lookup_order');
      if (!lookup.success || !lookup.output?.found) {
        return { success: false, result: null, confidence: 0, error: `Order not found: ${orderId}` };
      }
      return this.buildOutput(true, lookup.output, { toolsUsed });
    }

    if (action === 'calculate' && items) {
      const calc = await ToolRegistry.execute('calculate_price', { items, discountCode: input.context?.discountCode }, ctx);
      toolsUsed.push('calculate_price');
      if (calc.success) {
        return this.buildOutput(true, calc.output, { toolsUsed });
      }
    }

    // Default: process task via AI
    const aiResult = await NexusUnifiedCore.process(input.task, { agentRole: 'order_processor' });
    return this.buildOutput(true, aiResult.text, { toolsUsed });
  }
}

// ════════════════════════════════════════════════════════════════════════
// MARKETING AGENT
// Retention, campaigns, personalized messaging
// ════════════════════════════════════════════════════════════════════════
export class MarketingAgent extends BaseAgent {
  agentId = 'marketing-001';
  role = 'marketing';

  static capabilities: AgentCapabilities = {
    role: 'marketing',
    capabilities: ['campaign_generation', 'retention_messaging', 'personalization', 'ab_testing'],
    maxConcurrent: 5,
    requiresApproval: true,   // Marketing messages require human approval
    canUseTools: ['get_customer_history', 'send_notification', 'search_knowledge'],
    memoryAccess: ['read', 'learning'],
    priority: 5,
    version: '1.0.0',
    description: 'AI marketing and retention campaign agent',
  };

  async execute(input: AgentInput): Promise<AgentOutput> {
    const { userId, campaignType, customerName } = input.context || {};

    const prompt = campaignType === 'win_back'
      ? `Write a short, friendly win-back message (max 30 words) for a customer named ${customerName || 'there'} who hasn't ordered in a while. Include a 10% discount code COMEBACK10.`
      : campaignType === 'abandoned_cart'
      ? `Write a short cart abandonment reminder (max 25 words) for ${customerName || 'a customer'}. Mention their cart is waiting.`
      : `Write a brief promotional message (max 30 words) to engage a customer.`;

    const result = await NexusUnifiedCore.process(prompt, { agentRole: 'marketing_agent' });

    if (userId) {
      await ToolRegistry.execute('send_notification', {
        userId, title: 'A message for you ✨', message: result.text, channels: ['push', 'in_app'],
      }, this.toolCtx(input)).catch(() => {});
    }

    return this.buildOutput(true, result.text, { toolsUsed: ['send_notification'] });
  }
}
