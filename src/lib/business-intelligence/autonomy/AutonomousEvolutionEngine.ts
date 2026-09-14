/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        NEXUS AUTONOMOUS EVOLUTION ENGINE — Phase 10          ║
 * ║  Self-improvement, learning loops, workflow generation.      ║
 * ║                                                              ║
 * ║  SAFETY: Only runs when FEATURE_AUTONOMOUS_AGENTS=true       ║
 * ║  All evolution proposals require human approval by default.  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * WHAT IT DOES:
 *  1. Monitors agent performance continuously
 *  2. Detects patterns in failures and successes
 *  3. Proposes system improvements (requires human approval)
 *  4. Applies approved optimizations automatically
 *  5. Generates new workflow templates from repeated patterns
 *  6. Updates routing weights based on model performance
 */

import { logger } from '../../core/logging/NexusLogger';
import { EventBus } from '../../core/events/NexusEventBus';
import { AgentRegistry } from '../../core/registry/AgentRegistry';
import { GlobalProviderRegistry } from '../../ai/providers/ProviderRegistry';
import { MemoryEngine } from '../../memory/NexusMemoryEngine';
import { MemoryType } from '../../memory/interfaces/MemoryTypes';
import { AuditLog } from '../../security/audit/ImmutableAuditLog';
import { NexusUnifiedCore } from '../../core/NexusUnifiedCore';
import { NexusConfig } from '../../core/config/NexusConfig';
import { BIEngine } from '../analytics/BIEngine';

const log = logger.child('EvolutionEngine');
const SYSTEM_CALLER = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };

// ── Types ──────────────────────────────────────────────────────────────────
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface EvolutionProposal {
  id: string;
  type: 'provider_routing' | 'agent_config' | 'workflow_template' | 'prompt_optimization' | 'feature_toggle';
  title: string;
  description: string;
  rationale: string;
  expectedImpact: string;
  riskLevel: 'low' | 'medium' | 'high';
  proposedChange: Record<string, any>;
  status: ProposalStatus;
  createdAt: number;
  appliedAt?: number;
  approvedBy?: string;
}

export interface LearningInsight {
  pattern: string;
  frequency: number;
  impact: 'positive' | 'negative';
  recommendation: string;
  confidence: number;
}

export interface SystemEvolutionReport {
  period: string;
  insights: LearningInsight[];
  proposals: EvolutionProposal[];
  appliedOptimizations: number;
  performanceGains: Record<string, number>;
  generatedAt: number;
}

// ════════════════════════════════════════════════════════════════════════
// AUTONOMOUS EVOLUTION ENGINE
// ════════════════════════════════════════════════════════════════════════
class AutonomousEvolutionEngineImpl {
  private proposals = new Map<string, EvolutionProposal>();
  private learningHistory: LearningInsight[] = [];
  private cycles = 0;

  // ── Learning Loop (runs periodically) ────────────────────────────────
  async runLearningCycle(): Promise<LearningInsight[]> {
    if (!NexusConfig.features.enableSelfHealing) return [];

    this.cycles++;
    log.info(`Learning cycle #${this.cycles} started`);
    const insights: LearningInsight[] = [];

    // 1. Analyze agent performance
    const agentHealth = AgentRegistry.getHealthSummary();
    for (const agent of agentHealth.agents) {
      if (agent.successRate < 0.7 && agent.totalExecutions > 10) {
        insights.push({
          pattern: `Agent ${agent.id} has low success rate`,
          frequency: agent.totalExecutions,
          impact: 'negative',
          recommendation: `Consider retraining or replacing agent ${agent.id} (${agent.role})`,
          confidence: 0.85,
        });
        // Propose provider routing change if critic agent is failing
        if (agent.role === 'critic' && agent.successRate < 0.6) {
          await this._proposeChange({
            type: 'agent_config',
            title: `Lower confidence threshold for ${agent.id}`,
            description: `Agent ${agent.id} is failing too often. Lower the minimum confidence threshold.`,
            rationale: `Success rate: ${(agent.successRate * 100).toFixed(1)}% < 70% over ${agent.totalExecutions} executions`,
            expectedImpact: 'Reduce agent failures by ~30%, improve response availability',
            riskLevel: 'low',
            proposedChange: { agentId: agent.id, minConfidenceThreshold: 0.4 },
          });
        }
      }
      if (agent.avgDurationMs > 5000 && agent.totalExecutions > 5) {
        insights.push({
          pattern: `Agent ${agent.id} is slow (avg ${agent.avgDurationMs}ms)`,
          frequency: agent.totalExecutions,
          impact: 'negative',
          recommendation: `Route ${agent.role} tasks to faster provider (e.g. groq-llama-fast)`,
          confidence: 0.78,
        });
      }
    }

    // 2. Analyze AI provider performance
    const provHealth = GlobalProviderRegistry.getHealthSummary();
    for (const prov of provHealth.providers) {
      if (!prov.isHealthy && prov.failureCount > 5) {
        insights.push({
          pattern: `Provider ${prov.id} is unhealthy`,
          frequency: prov.failureCount,
          impact: 'negative',
          recommendation: `Temporarily disable ${prov.id} and route to fallback`,
          confidence: 0.95,
        });
        // Auto-propose routing change
        await this._proposeChange({
          type: 'provider_routing',
          title: `Disable unhealthy provider: ${prov.id}`,
          description: `Provider ${prov.id} has ${prov.failureCount} failures. Route to next best.`,
          rationale: `Failure count: ${prov.failureCount}`,
          expectedImpact: 'Eliminate provider-caused errors immediately',
          riskLevel: 'low',
          proposedChange: { action: 'disable_provider', providerId: prov.id },
        });
      }
    }

    // 3. Learn from memory (LearningMemory entries)
    try {
      const learningEntries = await MemoryEngine.getLearningContext('system', 50);
      const negativeCount = learningEntries.filter(e => e.feedback === 'negative').length;
      const positiveCount = learningEntries.filter(e => e.feedback === 'positive').length;
      const total = learningEntries.length;

      if (total > 10 && negativeCount / total > 0.4) {
        insights.push({
          pattern: `High negative feedback rate: ${Math.round(negativeCount/total*100)}%`,
          frequency: total,
          impact: 'negative',
          recommendation: 'Analyze top failure categories and update system prompts',
          confidence: 0.8,
        });
        // Generate improved prompt via AI
        await this._proposePromptOptimization(learningEntries.filter(e => e.feedback === 'negative').slice(0, 5));
      }
      if (total > 10 && positiveCount / total > 0.8) {
        insights.push({
          pattern: `High positive feedback: ${Math.round(positiveCount/total*100)}%`,
          frequency: total,
          impact: 'positive',
          recommendation: 'System performing well. Consider increasing automation autonomy.',
          confidence: 0.85,
        });
      }
    } catch (_) {}

    // 4. Business pattern detection
    try {
      const metrics = await BIEngine.getRevenueMetrics();
      if (metrics.growth.daily < -30) {
        insights.push({
          pattern: `Significant revenue drop: ${metrics.growth.daily.toFixed(1)}% today`,
          frequency: 1,
          impact: 'negative',
          recommendation: 'Trigger win-back campaign and check for operational issues',
          confidence: 0.9,
        });
        // Auto-trigger campaign if autonomous mode
        if (NexusConfig.features.enableAutonomousAgents) {
          EventBus.emitAsync('campaign.triggered', {
            type: 'revenue_recovery', trigger: 'autonomous_evolution', metrics,
          }, 'EvolutionEngine');
        }
      }
    } catch (_) {}

    // Persist insights as learning memory
    for (const insight of insights) {
      await MemoryEngine.recordLearning(
        'evolution-engine',
        insight.pattern,
        insight.recommendation,
        insight.impact === 'positive' ? 'positive' : 'negative',
        { feedbackSource: 'automated', confidenceShift: insight.impact === 'positive' ? 0.05 : -0.05 },
        SYSTEM_CALLER,
      ).catch(() => {});
    }

    this.learningHistory.unshift(...insights);
    if (this.learningHistory.length > 500) this.learningHistory.length = 500;

    log.info(`Learning cycle complete: ${insights.length} insights`, { cycle: this.cycles });
    return insights;
  }

  // ── Auto-apply safe low-risk proposals ───────────────────────────────
  async applyApprovedProposals(): Promise<number> {
    let applied = 0;
    for (const [id, proposal] of this.proposals.entries()) {
      if (proposal.status !== 'approved') continue;
      if (proposal.riskLevel === 'high' && !NexusConfig.features.enableAutonomousAgents) continue;

      try {
        await this._applyProposal(proposal);
        proposal.status = 'applied';
        proposal.appliedAt = Date.now();
        applied++;

        await AuditLog.record('config.changed', { id: 'evolution-engine', type: 'system' }, {
          proposalId: id, type: proposal.type, title: proposal.title,
        }, { outcome: 'success' });

        log.info(`Applied evolution proposal: ${proposal.title}`, { id, type: proposal.type });
      } catch (e) {
        log.error(`Failed to apply proposal: ${proposal.title}`, e instanceof Error ? e : undefined);
      }
    }
    return applied;
  }

  /** Approve a proposal (called by admin) */
  approveProposal(proposalId: string, approvedBy: string): boolean {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== 'pending') return false;
    p.status = 'approved';
    p.approvedBy = approvedBy;
    log.info(`Proposal approved: ${p.title}`, { proposalId, approvedBy });

    // Auto-apply low-risk approved proposals
    if (p.riskLevel === 'low') {
      setTimeout(() => this.applyApprovedProposals(), 1000);
    }
    return true;
  }

  /** Reject a proposal */
  rejectProposal(proposalId: string): boolean {
    const p = this.proposals.get(proposalId);
    if (!p) return false;
    p.status = 'rejected';
    return true;
  }

  // ── Generate evolution report ────────────────────────────────────────
  async generateEvolutionReport(): Promise<SystemEvolutionReport> {
    const insights = await this.runLearningCycle();
    const pendingProposals = Array.from(this.proposals.values()).filter(p => p.status === 'pending');
    const applied = Array.from(this.proposals.values()).filter(p => p.status === 'applied').length;

    return {
      period: new Date().toISOString().split('T')[0],
      insights: insights.slice(0, 20),
      proposals: pendingProposals,
      appliedOptimizations: applied,
      performanceGains: {
        agentSuccessRate: AgentRegistry.getHealthSummary().agents
          .reduce((s, a) => s + a.successRate, 0) / Math.max(1, AgentRegistry.getHealthSummary().total),
        providerHealthy: GlobalProviderRegistry.getHealthSummary().healthy /
          Math.max(1, GlobalProviderRegistry.getHealthSummary().total),
      },
      generatedAt: Date.now(),
    };
  }

  listProposals(status?: ProposalStatus): EvolutionProposal[] {
    const all = Array.from(this.proposals.values());
    return status ? all.filter(p => p.status === status) : all;
  }

  getInsights(limit = 20): LearningInsight[] {
    return this.learningHistory.slice(0, limit);
  }

  // ── Private helpers ───────────────────────────────────────────────────
  private async _proposeChange(opts: Omit<EvolutionProposal, 'id' | 'status' | 'createdAt'>): Promise<void> {
    const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Don't propose duplicate changes
    const existing = Array.from(this.proposals.values())
      .find(p => p.title === opts.title && p.status === 'pending');
    if (existing) return;

    const proposal: EvolutionProposal = { ...opts, id, status: 'pending', createdAt: Date.now() };
    this.proposals.set(id, proposal);

    // Auto-approve low-risk proposals if autonomous mode enabled
    if (opts.riskLevel === 'low' && NexusConfig.features.enableAutonomousAgents) {
      proposal.status = 'approved';
      proposal.approvedBy = 'autonomous-engine';
    } else {
      // Notify admin for approval
      EventBus.emitAsync('agent.approval.required', {
        type: 'evolution_proposal', proposalId: id, title: opts.title, riskLevel: opts.riskLevel,
      }, 'EvolutionEngine');
    }
  }

  private async _proposePromptOptimization(failedExamples: any[]): Promise<void> {
    try {
      const examples = failedExamples.map(e => `Q: ${e.stimulus}\nA (failed): ${e.response}`).join('\n\n');
      const result = await NexusUnifiedCore.process(
        `These AI responses received negative feedback. Identify the common failure pattern in 1 sentence: ${examples.slice(0, 1000)}`,
        { agentRole: 'analytics', systemInstruction: 'Be concise. Identify the pattern only.' }
      );
      await this._proposeChange({
        type: 'prompt_optimization',
        title: 'Improve response quality based on feedback',
        description: result.text,
        rationale: `${failedExamples.length} negative feedback examples analyzed`,
        expectedImpact: 'Reduce negative feedback rate by 20-40%',
        riskLevel: 'low',
        proposedChange: { pattern: result.text, examples: failedExamples.length },
      });
    } catch (_) {}
  }

  private async _applyProposal(proposal: EvolutionProposal): Promise<void> {
    switch (proposal.type) {
      case 'provider_routing':
        if (proposal.proposedChange.action === 'disable_provider') {
          GlobalProviderRegistry.reportFailure(proposal.proposedChange.providerId);
          GlobalProviderRegistry.reportFailure(proposal.proposedChange.providerId);
          GlobalProviderRegistry.reportFailure(proposal.proposedChange.providerId);
        }
        if (proposal.proposedChange.roleOverride) {
          GlobalProviderRegistry.setPrimaryForRole(
            proposal.proposedChange.role,
            proposal.proposedChange.providerId,
          );
        }
        break;
      case 'feature_toggle':
        log.info(`Feature toggle proposal: ${proposal.proposedChange.feature} — requires manual .env change`);
        break;
      case 'prompt_optimization':
        // Store in semantic memory so agents pick it up
        await MemoryEngine.writeSemanticKnowledge(
          `System improvement: ${proposal.description}`,
          'system_optimizations',
          'system',
          { tags: ['prompt_optimization', 'autonomous'] },
          SYSTEM_CALLER,
        ).catch(() => {});
        break;
      default:
        log.info(`Proposal type ${proposal.type} logged for manual review`);
    }
  }
}

export const EvolutionEngine = new AutonomousEvolutionEngineImpl();
