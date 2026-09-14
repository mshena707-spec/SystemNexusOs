/**
 * NEXUS CONFIDENCE SCORER & TASK DECOMPOSER — Phase 3
 * Scores agent outputs and decomposes complex tasks into sub-tasks.
 */

import { logger } from '../../core/logging/NexusLogger';

const log = logger.child('ConfidenceScorer');

// ════════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORER
// ════════════════════════════════════════════════════════════════════════
export interface ConfidenceScore {
  score: number;           // 0.0 – 1.0
  level: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  factors: string[];
  requiresReview: boolean;
}

export class ConfidenceScorer {

  static score(params: {
    responseLength: number;
    hasUncertainPhrases: boolean;
    hasSpecificData: boolean;
    toolsUsed: string[];
    agentAgreements: number;   // how many agents agreed
    agentDisagreements: number;
    taskComplexity: 'simple' | 'moderate' | 'complex' | 'expert';
    memoryContextFound: boolean;
  }): ConfidenceScore {
    let score = 0.5;
    const factors: string[] = [];

    // Response quality signals
    if (params.responseLength > 50) { score += 0.05; factors.push('substantial_response'); }
    if (params.responseLength > 200) { score += 0.05; factors.push('detailed_response'); }
    if (params.hasUncertainPhrases) { score -= 0.15; factors.push('uncertain_language'); }
    if (params.hasSpecificData) { score += 0.15; factors.push('specific_data_cited'); }

    // Tool usage signals
    if (params.toolsUsed.length > 0) { score += 0.1; factors.push(`tools_used:${params.toolsUsed.join(',')}`); }
    if (params.toolsUsed.includes('lookup_order')) { score += 0.05; factors.push('order_verified'); }

    // Multi-agent agreement signals
    if (params.agentAgreements > 0) { score += 0.1 * params.agentAgreements; factors.push('agent_agreement'); }
    if (params.agentDisagreements > 0) { score -= 0.15 * params.agentDisagreements; factors.push('agent_disagreement'); }

    // Memory context
    if (params.memoryContextFound) { score += 0.1; factors.push('memory_context_found'); }

    // Task complexity penalty
    const complexityPenalty = { simple: 0, moderate: -0.05, complex: -0.1, expert: -0.15 };
    score += complexityPenalty[params.taskComplexity];
    factors.push(`complexity:${params.taskComplexity}`);

    // Clamp
    score = Math.max(0, Math.min(1, score));

    const level: ConfidenceScore['level'] =
      score >= 0.85 ? 'very_high' :
      score >= 0.70 ? 'high' :
      score >= 0.50 ? 'medium' :
      score >= 0.30 ? 'low' : 'very_low';

    return {
      score: Math.round(score * 100) / 100,
      level,
      factors,
      requiresReview: score < 0.50 || params.agentDisagreements > 1,
    };
  }

  static scoreText(text: string): { hasUncertain: boolean; hasSpecific: boolean } {
    const uncertain = /i think|i believe|i'm not sure|maybe|perhaps|possibly|it seems|not certain|i cannot|i don't know/i.test(text);
    const specific = /\$[\d,.]+|#[A-Z0-9-]+|\d{4}-\d{2}-\d{2}|\d+%|order|invoice|confirmed/i.test(text);
    return { hasUncertain: uncertain, hasSpecific: specific };
  }
}

// ════════════════════════════════════════════════════════════════════════
// TASK DECOMPOSER
// ════════════════════════════════════════════════════════════════════════
export interface SubTask {
  id: string;
  description: string;
  requiredRole: string;
  requiredTools: string[];
  dependsOn: string[];     // IDs of tasks that must complete first
  priority: number;        // 1 (low) to 10 (critical)
  estimatedMs: number;
  context?: Record<string, any>;
}

export interface DecomposedPlan {
  originalTask: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  subTasks: SubTask[];
  estimatedTotalMs: number;
  requiresParallelExecution: boolean;
}

export class TaskDecomposer {

  static decompose(task: string, context?: Record<string, any>): DecomposedPlan {
    const lower = task.toLowerCase();
    const subTasks: SubTask[] = [];

    // ── Pattern: Order-related tasks ──────────────────────────────────
    if (lower.includes('order') && (lower.includes('status') || lower.includes('where') || lower.includes('track'))) {
      subTasks.push({
        id: 'lookup_order', description: 'Look up order in database',
        requiredRole: 'customer_support', requiredTools: ['lookup_order'],
        dependsOn: [], priority: 8, estimatedMs: 500,
        context: { userId: context?.userId },
      });
      subTasks.push({
        id: 'format_response', description: 'Format order status for customer',
        requiredRole: 'customer_support', requiredTools: [],
        dependsOn: ['lookup_order'], priority: 7, estimatedMs: 200,
      });
      return { originalTask: task, complexity: 'simple', subTasks, estimatedTotalMs: 700, requiresParallelExecution: false };
    }

    // ── Pattern: Complaint handling ──────────────────────────────────
    if (lower.includes('complaint') || lower.includes('unhappy') || lower.includes('refund')) {
      subTasks.push({
        id: 'assess_sentiment', description: 'Assess customer sentiment and urgency',
        requiredRole: 'customer_support', requiredTools: [],
        dependsOn: [], priority: 9, estimatedMs: 300,
      });
      subTasks.push({
        id: 'get_history', description: 'Retrieve customer order history',
        requiredRole: 'customer_support', requiredTools: ['get_customer_history'],
        dependsOn: [], priority: 8, estimatedMs: 600,
      });
      subTasks.push({
        id: 'fraud_check', description: 'Fraud risk assessment',
        requiredRole: 'fraud_detector', requiredTools: ['assess_fraud_risk'],
        dependsOn: [], priority: 7, estimatedMs: 400,
      });
      subTasks.push({
        id: 'generate_resolution', description: 'Generate resolution proposal',
        requiredRole: 'customer_support', requiredTools: [],
        dependsOn: ['assess_sentiment', 'get_history', 'fraud_check'], priority: 9, estimatedMs: 800,
      });
      subTasks.push({
        id: 'notify_customer', description: 'Send notification to customer',
        requiredRole: 'customer_support', requiredTools: ['send_notification'],
        dependsOn: ['generate_resolution'], priority: 8, estimatedMs: 300,
      });
      return { originalTask: task, complexity: 'complex', subTasks, estimatedTotalMs: 1400, requiresParallelExecution: true };
    }

    // ── Pattern: Price/product inquiry ───────────────────────────────
    if (lower.includes('price') || lower.includes('product') || lower.includes('stock') || lower.includes('available')) {
      subTasks.push({
        id: 'search_product', description: 'Search product catalog',
        requiredRole: 'general', requiredTools: ['lookup_product', 'check_stock'],
        dependsOn: [], priority: 7, estimatedMs: 500,
      });
      subTasks.push({
        id: 'search_knowledge', description: 'Search product knowledge base',
        requiredRole: 'general', requiredTools: ['search_knowledge'],
        dependsOn: [], priority: 6, estimatedMs: 600,
      });
      subTasks.push({
        id: 'compile_answer', description: 'Compile product information',
        requiredRole: 'general', requiredTools: [],
        dependsOn: ['search_product', 'search_knowledge'], priority: 7, estimatedMs: 300,
      });
      return { originalTask: task, complexity: 'moderate', subTasks, estimatedTotalMs: 900, requiresParallelExecution: true };
    }

    // ── Pattern: New order placement ─────────────────────────────────
    if ((lower.includes('order') && lower.includes('place')) || lower.includes('buy') || lower.includes('purchase')) {
      subTasks.push({
        id: 'check_stock', description: 'Verify product availability',
        requiredRole: 'order_processor', requiredTools: ['check_stock'],
        dependsOn: [], priority: 9, estimatedMs: 400,
      });
      subTasks.push({
        id: 'calculate_price', description: 'Calculate total with discounts',
        requiredRole: 'order_processor', requiredTools: ['calculate_price'],
        dependsOn: [], priority: 8, estimatedMs: 200,
      });
      subTasks.push({
        id: 'fraud_check', description: 'Pre-order fraud assessment',
        requiredRole: 'fraud_detector', requiredTools: ['assess_fraud_risk'],
        dependsOn: [], priority: 9, estimatedMs: 400,
      });
      subTasks.push({
        id: 'create_order', description: 'Create order in system',
        requiredRole: 'order_processor', requiredTools: ['update_order_status'],
        dependsOn: ['check_stock', 'calculate_price', 'fraud_check'], priority: 10, estimatedMs: 600,
      });
      subTasks.push({
        id: 'notify_order', description: 'Send order confirmation',
        requiredRole: 'order_processor', requiredTools: ['send_notification'],
        dependsOn: ['create_order'], priority: 8, estimatedMs: 300,
      });
      return { originalTask: task, complexity: 'complex', subTasks, estimatedTotalMs: 1500, requiresParallelExecution: true };
    }

    // ── Default: Simple single-step task ─────────────────────────────
    subTasks.push({
      id: 'general_response', description: 'Generate response for general query',
      requiredRole: 'general', requiredTools: ['search_knowledge'],
      dependsOn: [], priority: 5, estimatedMs: 600,
    });
    return { originalTask: task, complexity: 'simple', subTasks, estimatedTotalMs: 600, requiresParallelExecution: false };
  }

  /** Get execution order respecting dependencies */
  static getExecutionOrder(plan: DecomposedPlan): SubTask[][] {
    const waves: SubTask[][] = [];
    const completed = new Set<string>();
    const remaining = [...plan.subTasks];

    while (remaining.length > 0) {
      const wave = remaining.filter(t => t.dependsOn.every(dep => completed.has(dep)));
      if (wave.length === 0) break; // circular dependency guard
      wave.sort((a, b) => b.priority - a.priority);
      waves.push(wave);
      wave.forEach(t => { completed.add(t.id); remaining.splice(remaining.indexOf(t), 1); });
    }
    return waves;
  }
}
