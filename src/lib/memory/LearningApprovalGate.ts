/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LEARNING APPROVAL GATE                                                  ║
 * ║  Answers CTO Audit Part 3, section 12: "AI should not Direct Memory      ║
 * ║  Modify" — and the audit's "Ideal Learning" pipeline: Conversation →     ║
 * ║  Feedback → Evaluation → Approval → Learning Queue → Memory Update.     ║
 * ║                                                                           ║
 * ║  Confirmed gap: SupervisorAgent._recordDecision (SupervisorAgent.ts)     ║
 * ║  calls MemoryEngine.writeSemanticKnowledge directly — no approval step,  ║
 * ║  no queue, immediate write. This is the concrete instance of the         ║
 * ║  audit's concern, not a hypothetical.                                    ║
 * ║                                                                           ║
 * ║  DESIGN CHOICE, STATED HONESTLY: full human review of every learning     ║
 * ║  write doesn't scale and isn't what most real systems do either — this  ║
 * ║  gate auto-approves HIGH-confidence writes (the common case) and only    ║
 * ║  queues genuinely uncertain ones for review. That's a deliberate         ║
 * ║  tradeoff, not a shortcut around the audit's ask: the audit's own        ║
 * ║  Confidence Engine section (§9) already established confidence-based    ║
 * ║  gating as the right pattern elsewhere in this system (SupervisorAgent's ║
 * ║  retry-on-low-confidence) — this applies the same pattern to writes.    ║
 * ║                                                                           ║
 * ║  USAGE (replaces a direct MemoryEngine.writeSemanticKnowledge call):     ║
 * ║    await LearningApprovalGate.submit({                                  ║
 * ║      content, collection: 'agent_decisions', ownerId: agentId,          ║
 * ║      confidence: output.confidence, source: 'SupervisorAgent',          ║
 * ║    });                                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { NexusDB } from '../database/NexusDB';
import { EventBus } from '../core/events/NexusEventBus';
import { logger } from '../core/logging/NexusLogger';
import { PromptShield } from '../security/prompt/PromptShield';

const log = logger.child('LearningApprovalGate');
const COLLECTION = 'learning_approval_queue';

/** Below this, auto-write. At/above this line is NOT "definitely safe" — it's
 *  "confident enough that reviewing every one of these doesn't scale AND the
 *  cost of being occasionally wrong here is recoverable" (semantic/episodic
 *  memory, not e.g. a financial ledger — those already go through NexusError's
 *  approval-relevant severities instead, see AI_GOVERNANCE.md). */
const AUTO_APPROVE_THRESHOLD = 0.9;

export interface LearningSubmission {
  content: string;
  collection: string;
  ownerId: string;
  confidence: number;
  source: string; // which agent/module is proposing this (accountability, mirrors ToolDefinition.owner)
  opts?: { tags?: string[]; documentId?: string };
}

export interface PendingLearningEntry extends LearningSubmission {
  id: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
}

class LearningApprovalGateImpl {
  /** The one entry point — replaces direct MemoryEngine.writeSemanticKnowledge
   *  calls from agent code. Returns immediately either way; a queued item isn't
   *  written to memory until approve() is called on it. */
  async submit(submission: LearningSubmission): Promise<{ written: boolean; pendingId?: string }> {
    // CTO Audit Part 4, section 4: learningPermission enforcement. Fail-open for
    // sources that aren't a resolvable registered agent (e.g. system-level code
    // submitting directly isn't required to be an IAgent) — fail-closed only
    // when the source IS a registered agent AND has explicitly set
    // learningPermission: false. This is deliberately not fail-closed-by-default
    // for unregistered sources: that would break every caller that existed
    // before this permission field did.
    const { AgentRegistry } = await import('../core/registry/AgentRegistry');
    const registered = AgentRegistry.resolve(submission.source);
    if (registered && registered.capabilities.learningPermission === false) {
      log.warn('Learning submission blocked — agent lacks learningPermission', { source: submission.source });
      return { written: false };
    }

    // Memory-poisoning check (§16) belongs here as much as at input time — this
    // is exactly the "planting an instruction a future agent read will obey"
    // risk PromptShield.checkMemoryPoisoning exists for.
    const poisonCheck = PromptShield.checkMemoryPoisoning(submission.content);
    if (poisonCheck.blocked) {
      log.warn('Learning submission blocked by memory-poisoning check', { source: submission.source, categories: poisonCheck.categories });
      return { written: false };
    }

    if (submission.confidence >= AUTO_APPROVE_THRESHOLD) {
      await this._write(submission);
      log.info('Learning auto-approved and written (high confidence)', { source: submission.source, confidence: submission.confidence });
      return { written: true };
    }

    const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: PendingLearningEntry = {
      ...submission,
      id: pendingId,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    };
    await NexusDB.add(COLLECTION, entry);
    log.info('Learning submission queued for review (below confidence threshold)', { pendingId, source: submission.source, confidence: submission.confidence });

    // Reuses the existing human-in-the-loop event rather than inventing a
    // parallel one — anything already watching agent.approval.required for
    // tool-approval (ToolRegistry.ts) picks this up too.
    EventBus.emit('agent.approval.required', {
      kind: 'learning_write', pendingId, source: submission.source, confidence: submission.confidence,
    }, 'LearningApprovalGate');

    return { written: false, pendingId };
  }

  async approve(pendingId: string, reviewedBy: string): Promise<boolean> {
    const entries = await NexusDB.find(COLLECTION, { where: [{ field: 'id', op: '==', value: pendingId }] });
    const entry = entries[0] as unknown as PendingLearningEntry | undefined;
    if (!entry || entry.status !== 'pending') return false;

    await this._write(entry);
    await NexusDB.update(COLLECTION, pendingId, { status: 'approved', reviewedBy, reviewedAt: new Date().toISOString() });
    log.info('Pending learning entry approved and written', { pendingId, reviewedBy });
    return true;
  }

  async reject(pendingId: string, reviewedBy: string, reason?: string): Promise<boolean> {
    await NexusDB.update(COLLECTION, pendingId, { status: 'rejected', reviewedBy, reviewedAt: new Date().toISOString(), ...(reason ? { rejectionReason: reason } : {}) });
    log.info('Pending learning entry rejected', { pendingId, reviewedBy, reason });
    return true;
  }

  async listPending(limit = 50): Promise<PendingLearningEntry[]> {
    const entries = await NexusDB.find(COLLECTION, {
      where: [{ field: 'status', op: '==', value: 'pending' }], limit,
    });
    return entries as unknown as PendingLearningEntry[];
  }

  async getStats(): Promise<{ pending: number; approved: number; rejected: number }> {
    const [pending, approved, rejected] = await Promise.all([
      NexusDB.find(COLLECTION, { where: [{ field: 'status', op: '==', value: 'pending' }], limit: 1000 }),
      NexusDB.find(COLLECTION, { where: [{ field: 'status', op: '==', value: 'approved' }], limit: 1000 }),
      NexusDB.find(COLLECTION, { where: [{ field: 'status', op: '==', value: 'rejected' }], limit: 1000 }),
    ]);
    return { pending: pending.length, approved: approved.length, rejected: rejected.length };
  }

  private async _write(submission: LearningSubmission): Promise<void> {
    const { MemoryEngine } = await import('../memory/NexusMemoryEngine');
    await MemoryEngine.writeSemanticKnowledge(
      submission.content, submission.collection, submission.ownerId,
      { source: submission.source, ...submission.opts },
    );
  }
}

export const LearningApprovalGate = new LearningApprovalGateImpl();
