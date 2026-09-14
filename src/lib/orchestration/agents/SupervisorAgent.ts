/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          NEXUS SUPERVISOR AGENT & ARBITRATION SYSTEM         ║
 * ║  Phase 3: Top-level orchestration and conflict resolution    ║
 * ║                                                              ║
 * ║  ARCHITECTURE:                                               ║
 * ║   SupervisorAgent — routes tasks, monitors agents            ║
 * ║   ArbitrationSystem — resolves agent disagreements           ║
 * ║   DebateEngine — structured multi-agent debate               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { IAgent, AgentInput, AgentOutput, AgentCapabilities, AgentRegistry } from '../../core/registry/AgentRegistry';
import { NexusUnifiedCore } from '../../core/NexusUnifiedCore';
import { ConfidenceScorer, TaskDecomposer } from '../pipeline/ConfidenceAndDecomposer';
import { EventBus } from '../../core/events/NexusEventBus';
import { MemoryType } from '../../memory/interfaces/MemoryTypes';
import { logger } from '../../core/logging/NexusLogger';
import { NexusConfig } from '../../core/config/NexusConfig';

const log = logger.child('SupervisorAgent');

// ── Arbitration result ────────────────────────────────────────────────────
export interface ArbitrationResult {
  winner: string;           // agentId of winning response
  finalAnswer: string;
  confidence: number;
  reasoning: string;
  disagreementResolved: boolean;
  voteCounts: Record<string, number>;
}

// ════════════════════════════════════════════════════════════════════════
// ARBITRATION SYSTEM — Resolves disagreements between agents
// ════════════════════════════════════════════════════════════════════════
export class ArbitrationSystem {

  /** Resolve disagreement between multiple agent outputs */
  static async arbitrate(
    task: string,
    responses: Array<{ agentId: string; agentRole: string; output: AgentOutput }>,
  ): Promise<ArbitrationResult> {
    if (responses.length === 0) {
      return { winner: 'none', finalAnswer: '', confidence: 0, reasoning: 'No responses', disagreementResolved: false, voteCounts: {} };
    }
    if (responses.length === 1) {
      const r = responses[0];
      return {
        winner: r.agentId, finalAnswer: typeof r.output.result === 'string' ? r.output.result : JSON.stringify(r.output.result),
        confidence: r.output.confidence, reasoning: 'Single agent response', disagreementResolved: true, voteCounts: { [r.agentId]: 1 },
      };
    }

    // 1. Check if all agents agree (same decision/direction)
    const texts = responses.map(r => typeof r.output.result === 'string' ? r.output.result : JSON.stringify(r.output.result));
    const avgConfidence = responses.reduce((s, r) => s + r.output.confidence, 0) / responses.length;

    // 2. Score each response by confidence
    const scored = responses.map(r => ({
      ...r,
      score: r.output.confidence,
      text: typeof r.output.result === 'string' ? r.output.result : JSON.stringify(r.output.result),
    })).sort((a, b) => b.score - a.score);

    // 3. If high confidence from top agent and others are close — use top
    if (scored[0].score >= 0.8 && (scored[0].score - scored[1].score) < 0.2) {
      // Use AI to synthesize the best parts from top 2
      try {
        const synthesis = await NexusUnifiedCore.process(
          `You are an arbitrator. Two agents gave similar answers. Pick the best one or synthesize them into a single optimal answer.
Task: "${task}"
Agent A (confidence: ${scored[0].score}): "${scored[0].text.slice(0, 300)}"
Agent B (confidence: ${scored[1].score}): "${scored[1].text.slice(0, 300)}"
Return only the final answer, nothing else.`,
          { agentRole: 'supervisor', systemInstruction: 'You are an impartial arbitrator. Be concise.' }
        );

        return {
          winner: 'synthesis',
          finalAnswer: synthesis.text,
          confidence: Math.min(0.95, (scored[0].score + scored[1].score) / 2 + 0.1),
          reasoning: 'Synthesized from top 2 agents via AI arbitration',
          disagreementResolved: true,
          voteCounts: Object.fromEntries(scored.map(r => [r.agentId, Math.round(r.score * 10)])),
        };
      } catch (_) {}
    }

    // 4. Fallback: use highest confidence response
    const winner = scored[0];
    return {
      winner: winner.agentId,
      finalAnswer: winner.text,
      confidence: winner.score,
      reasoning: `Highest confidence agent selected (${Math.round(winner.score * 100)}%)`,
      disagreementResolved: true,
      voteCounts: Object.fromEntries(scored.map(r => [r.agentId, Math.round(r.score * 10)])),
    };
  }
}

// ════════════════════════════════════════════════════════════════════════
// SUPERVISOR AGENT — Orchestrates all other agents
// ════════════════════════════════════════════════════════════════════════
export class SupervisorAgent implements IAgent {
  agentId = 'supervisor-001';
  private log = logger.child('SupervisorAgent');
  private maxDepth = NexusConfig.security.maxAgentDepth;

  static capabilities: AgentCapabilities = {
    role: 'supervisor',
    capabilities: ['task_routing', 'agent_coordination', 'quality_assurance', 'escalation', 'arbitration'],
    maxConcurrent: 10,
    requiresApproval: false,
    canUseTools: [],
    memoryAccess: ['read', 'write', 'shared', 'restricted'],
    priority: 10,
    version: '1.0.0',
    description: 'Top-level supervisor that routes tasks and coordinates all agents',
    // allowedAgents intentionally omitted (not restricted): the Supervisor's job
    // is routing to whichever specialist agent a task needs, via _resolveAgentForRole
    // (any registered role) — an allowlist here would work against its core function.
    // Contrast with a specialist agent like FraudDetectorAgent, which should be
    // restricted (see SpecialistAgents.ts).
    confidenceThreshold: 0.5, // formalizes the value already hardcoded in execute()'s
    // retry-on-low-confidence check (`primaryOutput?.confidence < 0.5`) — declared
    // here now instead of only living as a magic number at the call site.
    escalationRules: [
      { trigger: 'low_confidence', escalateTo: 'human', note: 'After critique+retry still below threshold — current code returns the fallback response; does not yet actually notify a human. See docs/architecture/AGENT_PROTOCOL.md.' },
      { trigger: 'max_depth_reached', escalateTo: 'human', note: 'maxAgentDepth exceeded — currently returns an error result; does not yet notify a human either.' },
    ],
  };

  async execute(input: AgentInput): Promise<AgentOutput> {
    const depth = input.maxDepth ?? this.maxDepth;
    if (depth <= 0) {
      this.log.warn('Max agent depth reached', { task: input.task.slice(0, 60) });
      return { success: false, result: null, confidence: 0, error: 'Max orchestration depth reached' };
    }

    const start = Date.now();
    this.log.info('Supervisor processing task', { task: input.task.slice(0, 80), depth });

    // ── STEP 1: Plan via PlannerAgent ─────────────────────────────────
    const planResult = await AgentRegistry.execute('planner-001', {
      ...input, maxDepth: depth - 1,
    });

    if (!planResult.success || !planResult.result?.executionWaves) {
      // Fallback: route directly based on task content
      return this._directRoute(input, depth);
    }

    const { plan, executionWaves } = planResult.result;
    this.log.debug('Execution plan ready', {
      complexity: plan.complexity, waves: executionWaves.length,
      subTasks: plan.subTasks.length,
    });

    // ── STEP 2: Execute waves ─────────────────────────────────────────
    const waveResults: AgentOutput[] = [];

    for (const [waveIdx, wave] of executionWaves.entries()) {
      this.log.debug(`Executing wave ${waveIdx + 1}/${executionWaves.length}`, { tasks: wave.length });

      // Execute tasks in this wave in parallel
      const wavePromises = wave.map(async (subTask: any) => {
        const agentId = this._resolveAgentForRole(subTask.requiredRole);
        if (!agentId) {
          this.log.warn(`No agent found for role: ${subTask.requiredRole}`);
          return null;
        }
        return AgentRegistry.execute(agentId, {
          task: `${input.task} [subtask: ${subTask.description}]`,
          context: { ...input.context, subTaskId: subTask.id, tools: subTask.requiredTools },
          userId: input.userId,
          sessionId: input.sessionId,
          traceId: input.traceId,
          parentAgentId: this.agentId,
          maxDepth: depth - 1,
        });
      });

      const waveOutputs = (await Promise.allSettled(wavePromises))
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean) as AgentOutput[];

      waveResults.push(...waveOutputs);
    }

    // ── STEP 3: Collect and critique final outputs ────────────────────
    const validOutputs = waveResults.filter(r => r?.success);
    if (validOutputs.length === 0) {
      return this._directRoute(input, depth);
    }

    // Get the primary response (last successful output from final wave)
    const finalWaveOutputs = waveResults.filter(r => r?.success);
    const primaryOutput = finalWaveOutputs[finalWaveOutputs.length - 1];

    // ── STEP 4: Critique via CriticAgent ─────────────────────────────
    const critiqueResult = await AgentRegistry.execute('critic-001', {
      task: 'Critique this response',
      context: {
        agentResponse: typeof primaryOutput?.result === 'string'
          ? primaryOutput.result
          : JSON.stringify(primaryOutput?.result),
        originalTask: input.task,
        agentId: 'wave-results',
      },
      maxDepth: depth - 1,
    });

    const critique = critiqueResult.success ? critiqueResult.result : null;

    // ── STEP 5: If critique finds issues and confidence is low, retry ─
    if (critique && !critique.approved && primaryOutput?.confidence < 0.5) {
      this.log.warn('Critique failed, attempting direct response', { issues: critique.issues });
      const fallback = await NexusUnifiedCore.process(input.task, {
        agentRole: 'supervisor',
        systemInstruction: `You are a helpful expert. Previous attempt had issues: ${critique.issues?.join(', ')}. Provide a better response.`,
        userId: input.userId,
      });
      return {
        success: true,
        result: fallback.text,
        confidence: Math.min(0.75, (primaryOutput?.confidence || 0) + 0.2),
        nextSteps: critique.suggestions,
      };
    }

    // ── STEP 6: Arbitrate if multiple valid outputs ───────────────────
    if (validOutputs.length > 1) {
      const arbitration = await ArbitrationSystem.arbitrate(
        input.task,
        validOutputs.map((o, i) => ({
          agentId: `wave-agent-${i}`,
          agentRole: 'general',
          output: o,
        }))
      );

      this.log.info('Arbitration complete', {
        winner: arbitration.winner,
        confidence: arbitration.confidence,
        durationMs: Date.now() - start,
      });

      // Record learning: supervisor decision
      this._recordDecision(input.task, arbitration.finalAnswer, arbitration.confidence);

      return {
        success: true,
        result: arbitration.finalAnswer,
        confidence: arbitration.confidence,
        nextSteps: critique?.suggestions || [],
      };
    }

    this.log.info('Supervisor task complete', { durationMs: Date.now() - start, confidence: primaryOutput?.confidence });

    this._recordDecision(input.task, primaryOutput?.result, primaryOutput?.confidence || 0);

    return {
      success: primaryOutput?.success || false,
      result: primaryOutput?.result,
      confidence: primaryOutput?.confidence || 0,
      nextSteps: critique?.suggestions || [],
    };
  }

  /** Direct route without planning — for simple tasks or fallback */
  private async _directRoute(input: AgentInput, depth: number): Promise<AgentOutput> {
    const agentId = this._resolveAgentForTask(input.task);
    if (agentId && agentId !== this.agentId) {
      return AgentRegistry.execute(agentId, { ...input, maxDepth: depth - 1 });
    }
    // Last resort: direct AI call
    const result = await NexusUnifiedCore.process(input.task, {
      agentRole: 'supervisor', userId: input.userId,
    });
    return { success: true, result: result.text, confidence: 0.65 };
  }

  /** Map role to registered agentId */
  private _resolveAgentForRole(role: string): string | null {
    const agents = AgentRegistry.findByRole(role as any);
    return agents[0]?.id || null;
  }

  /** Auto-detect appropriate agent from task content */
  private _resolveAgentForTask(task: string): string {
    const lower = task.toLowerCase();
    if (lower.includes('fraud') || lower.includes('risk')) return 'fraud-detector-001';
    if (lower.includes('order') && (lower.includes('status') || lower.includes('track'))) return 'customer-support-001';
    if (lower.includes('campaign') || lower.includes('promotion') || lower.includes('win-back')) return 'marketing-001';
    if (lower.includes('order') && lower.includes('process')) return 'order-processor-001';
    return 'customer-support-001';
  }

  /**
   * CTO Audit Part 3, section 12: this used to call MemoryEngine.writeSemanticKnowledge
   * directly — an un-gated write, exactly the "AI should not Direct Memory Modify"
   * pattern the audit flagged. Now routes through LearningApprovalGate: high-confidence
   * decisions still write immediately (this is a high-volume path — every supervised
   * task hits it — so gating everything would be impractical, not just cautious), and
   * lower-confidence ones queue for review instead of writing un-reviewed. See
   * docs/architecture/MEMORY_ARCHITECTURE.md and LearningApprovalGate.ts's own header
   * for the reasoning behind the threshold.
   */
  private async _recordDecision(task: string, result: any, confidence: number) {
    const resultText = typeof result === 'string' ? result : JSON.stringify(result);
    const { LearningApprovalGate } = await import('../../memory/LearningApprovalGate');
    await LearningApprovalGate.submit({
      content: `Task: ${task}\nResponse: ${resultText?.slice(0, 200)}`,
      collection: 'supervisor_decisions',
      ownerId: 'system',
      confidence,
      source: 'SupervisorAgent',
      opts: { tags: [`confidence:${Math.round(confidence * 100)}`] },
    }).catch((err) => this.log.warn('Failed to submit decision for learning', { error: String(err) }));
  }

  async ping(): Promise<boolean> { return true; }
}
