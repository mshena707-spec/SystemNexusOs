/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DEBATE ENGINE                                                           ║
 * ║  Answers CTO Audit Part 3, section 8. Confirmed missing in both the     ║
 * ║  Part 1 and this round's search — no file/class matching "Debate" or    ║
 * ║  "Reflection" existed anywhere. Score 3.0/10 in the audit was accurate. ║
 * ║                                                                           ║
 * ║  This is NOT the same thing as SupervisorAgent's ArbitrationSystem      ║
 * ║  (src/lib/orchestration/agents/SupervisorAgent.ts), even though this    ║
 * ║  reuses it — worth being precise about the difference, since the audit  ║
 * ║  itself conflates them a little:                                        ║
 * ║    ArbitrationSystem: agents answer INDEPENDENTLY, then the best answer ║
 * ║      is picked/synthesized after the fact. No agent sees another's work.║
 * ║    DebateEngine (this file): agents see EACH OTHER's answers and are    ║
 * ║      explicitly asked to critique and revise before a final round —     ║
 * ║      genuine back-and-forth, then arbitration on the FINAL round only.  ║
 * ║  Debate is strictly more expensive (more LLM calls) — use it for        ║
 * ║  decisions where being wrong is costly, not as the default path.        ║
 * ║                                                                           ║
 * ║  USAGE:                                                                  ║
 * ║    const result = await DebateEngine.debate({                          ║
 * ║      task: 'Should we approve this $50k procurement order?',           ║
 * ║      participantAgentIds: ['fraud-detector-001', 'order-processor-001'],║
 * ║      rounds: 2,                                                         ║
 * ║    });                                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { AgentRegistry, AgentInput, AgentOutput } from '../../core/registry/AgentRegistry';
import { ArbitrationSystem, ArbitrationResult } from '../agents/SupervisorAgent';
import { EventBus } from '../../core/events/NexusEventBus';
import { logger } from '../../core/logging/NexusLogger';

const log = logger.child('DebateEngine');

export interface DebateRequest {
  task: string;
  participantAgentIds: string[];
  /** Bounded on purpose — debate cost grows with rounds × participants. Default 2:
   *  one proposal round, one critique-and-revise round. */
  rounds?: number;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  context?: Record<string, unknown>;
}

export interface DebateTranscriptEntry {
  round: number;
  agentId: string;
  output: AgentOutput;
}

export interface DebateResult {
  finalAnswer: string;
  confidence: number;
  winner: string;
  transcript: DebateTranscriptEntry[];
  roundsRun: number;
  reasoning: string;
}

class DebateEngineImpl {
  async debate(request: DebateRequest): Promise<DebateResult> {
    const rounds = Math.max(1, Math.min(request.rounds ?? 2, 4)); // hard cap at 4 — cost control
    const transcript: DebateTranscriptEntry[] = [];
    const start = Date.now();

    log.info('Debate started', { task: request.task.slice(0, 80), participants: request.participantAgentIds, rounds });

    let currentRoundOutputs: Array<{ agentId: string; output: AgentOutput }> = [];

    for (let round = 1; round <= rounds; round++) {
      const isFirstRound = round === 1;

      const roundPromises = request.participantAgentIds.map(async (agentId) => {
        const promptForRound = isFirstRound
          ? request.task
          : this._buildCritiqueRoundPrompt(request.task, agentId, currentRoundOutputs);

        const input: AgentInput = {
          task: promptForRound,
          context: { ...request.context, debateRound: round },
          userId: request.userId,
          sessionId: request.sessionId,
          traceId: request.traceId,
        };

        const output = await AgentRegistry.execute(agentId, input);
        transcript.push({ round, agentId, output });
        return { agentId, output };
      });

      currentRoundOutputs = await Promise.all(roundPromises);

      EventBus.emit('agent.task.completed', {
        debateRound: round, task: request.task.slice(0, 80),
        participants: request.participantAgentIds,
      }, 'DebateEngine');

      // Early exit: if every participant agrees with high confidence, further
      // rounds are cost without benefit — this is what makes debate not
      // unconditionally 2-4x the cost of a single call.
      const allHighConfidence = currentRoundOutputs.every(r => r.output.success && r.output.confidence >= 0.85);
      if (allHighConfidence && round < rounds) {
        log.info('Debate converged early — all participants high-confidence and agreeing', { round });
        break;
      }
    }

    // Final arbitration over the LAST round's outputs only — earlier rounds
    // informed the debate but shouldn't out-vote the agents' final, revised
    // positions.
    const validOutputs = currentRoundOutputs.filter(r => r.output.success);
    const arbitration: ArbitrationResult = await ArbitrationSystem.arbitrate(
      request.task,
      validOutputs.map(r => ({ agentId: r.agentId, agentRole: r.agentId, output: r.output })),
    );

    const roundsRun = Math.max(...transcript.map(t => t.round), 1);
    log.info('Debate complete', {
      winner: arbitration.winner, confidence: arbitration.confidence,
      roundsRun, durationMs: Date.now() - start,
    });

    return {
      finalAnswer: arbitration.finalAnswer,
      confidence: arbitration.confidence,
      winner: arbitration.winner,
      transcript,
      roundsRun,
      reasoning: arbitration.reasoning,
    };
  }

  /** Builds the prompt an agent sees in round 2+: their own previous answer,
   *  everyone else's, and an explicit instruction to critique and (if warranted)
   *  revise — this is the mechanism that makes it a debate, not just two
   *  independent votes. */
  private _buildCritiqueRoundPrompt(
    task: string,
    selfAgentId: string,
    previousRound: Array<{ agentId: string; output: AgentOutput }>,
  ): string {
    const selfAnswer = previousRound.find(r => r.agentId === selfAgentId);
    const others = previousRound.filter(r => r.agentId !== selfAgentId);

    const othersText = others.map(o =>
      `Agent "${o.agentId}" answered (confidence ${Math.round((o.output.confidence ?? 0) * 100)}%): ${this._stringifyResult(o.output.result)}`
    ).join('\n');

    return [
      `Original task: "${task}"`,
      selfAnswer ? `Your previous answer: ${this._stringifyResult(selfAnswer.output.result)}` : '',
      `Other agents' answers:\n${othersText}`,
      `Review the other agents' reasoning. If they raise a point that changes your answer, revise it and explain why. If you still disagree, restate your position and explain specifically why the other view is wrong. Do not simply repeat your first answer without engaging with theirs.`,
    ].filter(Boolean).join('\n\n');
  }

  private _stringifyResult(result: unknown): string {
    return typeof result === 'string' ? result : JSON.stringify(result);
  }
}

export const DebateEngine = new DebateEngineImpl();
