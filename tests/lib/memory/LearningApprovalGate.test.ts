/**
 * LearningApprovalGate — Confidence-gated memory write test suite
 *
 * WHY THIS FILE EXISTS:
 *   LearningApprovalGate is the sentinel between AI agent outputs and permanent
 *   memory. It was built in Part 3 as a direct response to the finding that
 *   SupervisorAgent._recordDecision was writing to memory WITHOUT any approval
 *   step — meaning a low-confidence or adversarially-triggered agent output
 *   could permanently pollute the knowledge base.
 *
 *   The gate's core contract is: confidence >= 0.9 → auto-write; below that →
 *   queue for human review. This test suite verifies that contract is maintained
 *   and that learningPermission enforcement (Part 4 addition) blocks disallowed
 *   agents even at high confidence.
 *
 * MOCKING STRATEGY: NexusDB and AgentRegistry are mocked so these tests run
 *   without network access. MemoryEngine is mocked since testing the gate's
 *   routing decision is the goal, not MemoryEngine's internals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockWriteSemanticKnowledge = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/lib/memory/NexusMemoryEngine', () => ({
  MemoryEngine: { writeSemanticKnowledge: mockWriteSemanticKnowledge },
}));

const mockNexusDBSet  = vi.fn().mockResolvedValue(undefined);
const mockNexusDBFind = vi.fn().mockResolvedValue([]);
const mockNexusDBGet  = vi.fn().mockResolvedValue(null);
const mockNexusDBUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/lib/database/NexusDB', () => ({
  NexusDB: {
    set:    (...args: any[]) => mockNexusDBSet(...args),
    find:   (...args: any[]) => mockNexusDBFind(...args),
    get:    (...args: any[]) => mockNexusDBGet(...args),
    update: (...args: any[]) => mockNexusDBUpdate(...args),
  },
}));

const mockAgentRegistryResolve = vi.fn().mockReturnValue(null);
vi.mock('../../../src/lib/core/registry/AgentRegistry', () => ({
  AgentRegistry: { resolve: (...args: any[]) => mockAgentRegistryResolve(...args) },
}));

vi.mock('../../../src/lib/core/events/NexusEventBus', () => ({
  EventBus: { emit: vi.fn() },
}));

vi.mock('../../../src/lib/security/prompt/PromptShield', () => ({
  PromptShield: { analyze: vi.fn().mockReturnValue({ safe: true, sanitized: '' }) },
}));

vi.mock('../../../src/lib/core/logging/NexusLogger', () => ({
  logger: {
    child: () => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    }),
  },
}));

import { LearningApprovalGate, LearningSubmission } from '../../../src/lib/memory/LearningApprovalGate';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSubmission(overrides: Partial<LearningSubmission> = {}): LearningSubmission {
  return {
    content:    'Customer prefers express delivery',
    collection: 'semantic_knowledge',
    ownerId:    'owner_001',
    confidence: 0.95,
    source:     'SupervisorAgent',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgentRegistryResolve.mockReturnValue(null); // unregistered source → fail-open by default
});

// ── Auto-approve path (confidence >= 0.9) ─────────────────────────────────────

describe('LearningApprovalGate.submit — auto-approve path', () => {

  it('auto-approves and writes directly at confidence >= 0.9', async () => {
    const result = await LearningApprovalGate.submit(makeSubmission({ confidence: 0.9 }));
    expect(result.written).toBe(true);
    expect(result.pendingId).toBeUndefined();
    expect(mockWriteSemanticKnowledge).toHaveBeenCalledOnce();
  });

  it('auto-approves at confidence exactly 0.9 (boundary inclusive)', async () => {
    const result = await LearningApprovalGate.submit(makeSubmission({ confidence: 0.9 }));
    expect(result.written).toBe(true);
  });

  it('auto-approves at confidence 1.0', async () => {
    const result = await LearningApprovalGate.submit(makeSubmission({ confidence: 1.0 }));
    expect(result.written).toBe(true);
    expect(mockWriteSemanticKnowledge).toHaveBeenCalled();
  });
});

// ── Queue path (confidence < 0.9) ────────────────────────────────────────────

describe('LearningApprovalGate.submit — queue path', () => {

  it('queues for review at confidence 0.89 (just below threshold)', async () => {
    const result = await LearningApprovalGate.submit(makeSubmission({ confidence: 0.89 }));
    expect(result.written).toBe(false);
    expect(result.pendingId).toBeDefined();
    expect(typeof result.pendingId).toBe('string');
    expect(mockWriteSemanticKnowledge).not.toHaveBeenCalled();
  });

  it('queues for review at confidence 0.5', async () => {
    const result = await LearningApprovalGate.submit(makeSubmission({ confidence: 0.5 }));
    expect(result.written).toBe(false);
    expect(result.pendingId).toBeDefined();
  });

  it('queues for review at confidence 0.0', async () => {
    const result = await LearningApprovalGate.submit(makeSubmission({ confidence: 0.0 }));
    expect(result.written).toBe(false);
    expect(result.pendingId).toBeDefined();
  });

  it('persists the pending entry to the approval queue collection', async () => {
    await LearningApprovalGate.submit(makeSubmission({ confidence: 0.5 }));
    expect(mockNexusDBSet).toHaveBeenCalledOnce();
    const [collection] = mockNexusDBSet.mock.calls[0];
    expect(collection).toBe('learning_approval_queue');
  });

  it('pending entry has status = pending', async () => {
    await LearningApprovalGate.submit(makeSubmission({ confidence: 0.5 }));
    const [, , entry] = mockNexusDBSet.mock.calls[0];
    expect(entry.status).toBe('pending');
    expect(entry.submittedAt).toBeDefined();
  });
});

// ── learningPermission enforcement (Part 4) ───────────────────────────────────

describe('LearningApprovalGate — learningPermission enforcement', () => {

  it('blocks a registered agent with learningPermission: false, even at confidence 1.0', async () => {
    mockAgentRegistryResolve.mockReturnValue({
      id: 'MarketingAgent',
      capabilities: { learningPermission: false },
    });
    const result = await LearningApprovalGate.submit(makeSubmission({
      source: 'MarketingAgent',
      confidence: 1.0,
    }));
    expect(result.written).toBe(false);
    expect(result.pendingId).toBeUndefined();
    expect(mockWriteSemanticKnowledge).not.toHaveBeenCalled();
  });

  it('allows a registered agent with learningPermission: true', async () => {
    mockAgentRegistryResolve.mockReturnValue({
      id: 'SupervisorAgent',
      capabilities: { learningPermission: true },
    });
    const result = await LearningApprovalGate.submit(makeSubmission({
      source: 'SupervisorAgent',
      confidence: 0.95,
    }));
    expect(result.written).toBe(true);
  });

  it('fails-open for unregistered sources (system-level code should not be blocked)', async () => {
    mockAgentRegistryResolve.mockReturnValue(null); // unregistered
    const result = await LearningApprovalGate.submit(makeSubmission({
      source: 'SystemBootstrap',
      confidence: 0.95,
    }));
    expect(result.written).toBe(true);
  });

  it('fails-open when learningPermission is undefined (backward-compatible with pre-Part-4 agents)', async () => {
    mockAgentRegistryResolve.mockReturnValue({
      id: 'LegacyAgent',
      capabilities: { /* no learningPermission field */ },
    });
    const result = await LearningApprovalGate.submit(makeSubmission({
      source: 'LegacyAgent',
      confidence: 0.95,
    }));
    expect(result.written).toBe(true);
  });
});

// ── approve / reject ─────────────────────────────────────────────────────────

describe('LearningApprovalGate.approve / reject', () => {

  it('approve: marks the entry approved in DB then writes to memory', async () => {
    // simulate a pending entry that can be fetched
    mockNexusDBGet.mockResolvedValueOnce({
      id: 'pending_1',
      content: 'some content',
      collection: 'semantic_knowledge',
      ownerId: 'owner_1',
      confidence: 0.5,
      source: 'SpecialistAgent',
      status: 'pending',
    });
    const result = await LearningApprovalGate.approve('pending_1', 'owner_user_1');
    expect(result).toBe(true);
    expect(mockNexusDBUpdate).toHaveBeenCalledWith(
      'learning_approval_queue',
      'pending_1',
      expect.objectContaining({ status: 'approved', reviewedBy: 'owner_user_1' }),
    );
    expect(mockWriteSemanticKnowledge).toHaveBeenCalledOnce();
  });

  it('reject: marks the entry rejected in DB and does NOT write to memory', async () => {
    mockNexusDBGet.mockResolvedValueOnce({
      id: 'pending_2',
      status: 'pending',
    });
    const result = await LearningApprovalGate.reject('pending_2', 'owner_user_1');
    expect(result).toBe(true);
    expect(mockNexusDBUpdate).toHaveBeenCalledWith(
      'learning_approval_queue',
      'pending_2',
      expect.objectContaining({ status: 'rejected', reviewedBy: 'owner_user_1' }),
    );
    expect(mockWriteSemanticKnowledge).not.toHaveBeenCalled();
  });
});
