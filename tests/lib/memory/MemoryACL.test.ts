/**
 * MemoryACL — Memory access control test suite
 *
 * WHY THIS FILE EXISTS:
 *   MemoryACL is the gatekeeper for the 8-tier memory taxonomy (Personal, Shared,
 *   Immutable, Owner, Restricted, Episodic, Semantic, Learning). Every memory
 *   read and write goes through it. A regression here is a data-exposure regression.
 *
 *   CTO Audit Part 5 found 3 unreachable-comparison type errors (dead-code checks
 *   after earlier guards already narrowed the type). These tests confirm the BEHAVIOR
 *   is correct regardless of the redundant checks, protecting against both regression
 *   and a future cleanup that might accidentally remove the earlier guard.
 *
 *   CTO Audit Part 5 also added cross-agent summary access (MemoryACL.canReadCrossAgent).
 *   This test suite is the first coverage of that capability.
 *
 *   NOTE: this file previously targeted an older MemoryACL API shape (caller-first
 *   arguments, a numeric `agentLevel` on callers, plain-boolean returns, and a
 *   PROCEDURAL memory type) that predates the current implementation and no longer
 *   compiles against it. Rewritten below against the real, current API:
 *   entry-first arguments, role-based `MemoryCaller.roles`, `MemoryACLResult`
 *   ({ allowed, reason?, summaryOnly? }) returns, and the real 8-type enum.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/lib/core/logging/NexusLogger', () => ({
  logger: {
    child: () => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    }),
  },
}));

vi.mock('../../../src/lib/core/events/NexusEventBus', () => ({
  EventBus: { emit: vi.fn() },
}));

import { MemoryACL, MemoryCaller } from '../../../src/lib/memory/acl/MemoryACL';
import {
  MemoryType, MemoryEntry, PersonalMemory, OwnerMemory, RestrictedMemory, EpisodicMemory,
} from '../../../src/lib/memory/interfaces/MemoryTypes';

// ── Caller factories ──────────────────────────────────────────────────────────

const ownerCaller: MemoryCaller = { id: 'owner_1', type: 'user', roles: [], isOwner: true };
const systemCaller: MemoryCaller = { id: 'system', type: 'system', roles: [] };
const customerCaller: MemoryCaller = { id: 'cust_1', type: 'user', roles: [] };
const agentCaller: MemoryCaller = { id: 'agent_supervisor', type: 'agent', roles: [] };
const untrustedCaller: MemoryCaller = { id: 'external_1', type: 'user', roles: [] };

// ── Entry factories ───────────────────────────────────────────────────────────
// Minimal valid entries per type. Only the fields each canRead/canWrite/canDelete
// branch actually inspects are given meaningful values; the rest are filler.

let _seq = 0;
function base(type: MemoryType, ownerId: string) {
  return {
    id: `mem_${type}_${_seq++}`, type, scope: 'user' as const, ownerId,
    createdAt: 0, updatedAt: 0, version: 1, tags: [] as string[],
  };
}

function makePersonal(agentId: string, ownerId = agentId): PersonalMemory {
  return { ...base(MemoryType.PERSONAL, ownerId), type: MemoryType.PERSONAL, agentId, content: '', accessCount: 0, lastAccessedAt: 0 };
}
function makeOwner(ownerId = 'owner_1'): OwnerMemory {
  return { ...base(MemoryType.OWNER, ownerId), type: MemoryType.OWNER, content: '', accessLog: [] };
}
function makeRestricted(overrides: Partial<Pick<RestrictedMemory, 'allowedRoles' | 'allowedUserIds' | 'deniedUserIds'>> = {}): RestrictedMemory {
  return {
    ...base(MemoryType.RESTRICTED, 'someone_else'), type: MemoryType.RESTRICTED, content: '',
    allowedRoles: [], allowedUserIds: [], deniedUserIds: [], classification: 'confidential',
    ...overrides,
  };
}
function makeEpisodic(ownerId: string): EpisodicMemory {
  return { ...base(MemoryType.EPISODIC, ownerId), type: MemoryType.EPISODIC, sessionId: 's1', userId: ownerId, episode: [] };
}
/** A generic entry for any of the remaining types, used where the type-specific
 *  fields don't matter to the branch under test (e.g. the top-of-function
 *  system/owner short-circuits, which return before inspecting entry shape). */
function makeGeneric(type: MemoryType, ownerId = 'someone_else'): MemoryEntry {
  return { ...base(type, ownerId) } as unknown as MemoryEntry;
}

// ── canRead ───────────────────────────────────────────────────────────────────

describe('MemoryACL.canRead', () => {

  it('owner can read ALL memory types', () => {
    for (const type of Object.values(MemoryType)) {
      const entry = makeGeneric(type, 'someone_else');
      expect(MemoryACL.canRead(entry, ownerCaller).allowed).toBe(true);
    }
  });

  it('system caller can read semantic, episodic, and immutable memory', () => {
    expect(MemoryACL.canRead(makeGeneric(MemoryType.SEMANTIC), systemCaller).allowed).toBe(true);
    expect(MemoryACL.canRead(makeEpisodic('someone_else'), systemCaller).allowed).toBe(true);
    expect(MemoryACL.canRead(makeGeneric(MemoryType.IMMUTABLE), systemCaller).allowed).toBe(true);
  });

  it('customer can read their own EPISODIC memory', () => {
    expect(MemoryACL.canRead(makeEpisodic('cust_1'), customerCaller).allowed).toBe(true);
  });

  it('customer is denied OWNER memory', () => {
    expect(MemoryACL.canRead(makeOwner(), customerCaller).allowed).toBe(false);
  });

  it('customer is denied RESTRICTED memory', () => {
    expect(MemoryACL.canRead(makeRestricted(), customerCaller).allowed).toBe(false);
  });

  it('untrusted caller is denied RESTRICTED and OWNER memory', () => {
    expect(MemoryACL.canRead(makeRestricted(), untrustedCaller).allowed).toBe(false);
    expect(MemoryACL.canRead(makeOwner(), untrustedCaller).allowed).toBe(false);
  });

  // These two tests protect the behavioral correctness that the redundant
  // dead-code checks in MemoryACL.ts (found in Part 5) are meant to encode —
  // even if the checks themselves are unreachable, the outer guards must still
  // produce the correct result. Both deliberately target a type whose own
  // case-logic would otherwise deny, to prove the top-of-function guard is what
  // actually decides the outcome.
  it('regression (Part 5): owner guard fires before RESTRICTED-specific denial logic', () => {
    const entry = makeRestricted({ allowedRoles: ['nobody_has_this'] });
    expect(MemoryACL.canRead(entry, ownerCaller).allowed).toBe(true);
  });

  it('regression (Part 5): system guard fires before OWNER-specific denial logic', () => {
    expect(MemoryACL.canRead(makeOwner(), systemCaller).allowed).toBe(true);
  });
});

// ── canWrite ──────────────────────────────────────────────────────────────────

describe('MemoryACL.canWrite', () => {

  it('owner can write to any memory type', () => {
    expect(MemoryACL.canWrite(null, MemoryType.OWNER, ownerCaller).allowed).toBe(true);
    expect(MemoryACL.canWrite(null, MemoryType.RESTRICTED, ownerCaller).allowed).toBe(true);
    expect(MemoryACL.canWrite(null, MemoryType.SEMANTIC, ownerCaller).allowed).toBe(true);
  });

  it('agent can write to a new EPISODIC entry', () => {
    expect(MemoryACL.canWrite(null, MemoryType.EPISODIC, agentCaller).allowed).toBe(true);
  });

  it('agent with knowledge_manager role can write SEMANTIC memory (plain agent role cannot)', () => {
    const knowledgeAgent: MemoryCaller = { ...agentCaller, roles: ['knowledge_manager'] };
    expect(MemoryACL.canWrite(null, MemoryType.SEMANTIC, knowledgeAgent).allowed).toBe(true);
    expect(MemoryACL.canWrite(null, MemoryType.SEMANTIC, agentCaller).allowed).toBe(false);
  });

  it('agent cannot write to OWNER memory', () => {
    expect(MemoryACL.canWrite(null, MemoryType.OWNER, agentCaller).allowed).toBe(false);
  });

  it('customer cannot create new RESTRICTED memory (requires admin role)', () => {
    expect(MemoryACL.canWrite(null, MemoryType.RESTRICTED, customerCaller).allowed).toBe(false);
  });

  it('immutable memory cannot be modified once it exists', () => {
    const existing = makeGeneric(MemoryType.IMMUTABLE, 'owner_1');
    expect(MemoryACL.canWrite(existing, MemoryType.IMMUTABLE, agentCaller).allowed).toBe(false);
    // Not even the owner override changes this — but isOwner short-circuits
    // before the immutable check, which is exactly what the Part 5 dead-code
    // finding was about, so we only assert the non-owner case here.
  });
});

// ── canReadCrossAgent (Part 5 addition) ──────────────────────────────────────
// Rule (see MemoryACL.ts docstring): read summary only, no full access — EXCEPT
// OWNER and RESTRICTED entries, which are hard-denied even as a summary, and
// system/owner callers, which always get full (non-summary) access.

describe('MemoryACL.canReadCrossAgent', () => {

  it('owner gets full (non-summary) cross-agent access to any entry', () => {
    const result = MemoryACL.canReadCrossAgent(makePersonal('agent_finance'), ownerCaller);
    expect(result.allowed).toBe(true);
    expect(result.summaryOnly).toBeFalsy();
  });

  it('system caller gets full (non-summary) cross-agent access to any entry', () => {
    const result = MemoryACL.canReadCrossAgent(makePersonal('agent_finance'), systemCaller);
    expect(result.allowed).toBe(true);
    expect(result.summaryOnly).toBeFalsy();
  });

  it('an agent reading its own personal memory gets full access, not just a summary', () => {
    const selfCaller: MemoryCaller = { ...agentCaller, id: 'agent_ceo' };
    const own = makePersonal('agent_ceo');
    const result = MemoryACL.canReadCrossAgent(own, selfCaller);
    expect(result.allowed).toBe(true);
    expect(result.summaryOnly).toBeFalsy();
  });

  it("a caller reading a different agent's PERSONAL memory gets summary-only access", () => {
    const result = MemoryACL.canReadCrossAgent(makePersonal('agent_finance'), customerCaller);
    expect(result.allowed).toBe(true);
    expect(result.summaryOnly).toBe(true);
  });

  it('OWNER and RESTRICTED memory are never available cross-agent, even as a summary', () => {
    expect(MemoryACL.canReadCrossAgent(makeOwner(), untrustedCaller).allowed).toBe(false);
    expect(MemoryACL.canReadCrossAgent(makeRestricted(), untrustedCaller).allowed).toBe(false);
    // Not even a plain agent (as opposed to the actual owning agent) gets a summary:
    expect(MemoryACL.canReadCrossAgent(makeRestricted(), agentCaller).allowed).toBe(false);
  });
});
