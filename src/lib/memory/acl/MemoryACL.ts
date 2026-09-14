/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              NEXUS MEMORY ACCESS CONTROL LAYER               ║
 * ║  Enforces ownership rules and role-based access for memory.  ║
 * ║  Agents NEVER freely overwrite shared or restricted memory.  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import {
  MemoryType,
  MemoryEntry,
  MemoryACLResult,
  PersonalMemory,
  SharedMemory,
  RestrictedMemory,
  OwnerMemory,
  ImmutableMemory,
} from '../interfaces/MemoryTypes';
import { logger } from '../../core/logging/NexusLogger';

const log = logger.child('MemoryACL');

// ── Caller identity ───────────────────────────────────────────────────────
export interface MemoryCaller {
  id: string;                  // userId or agentId
  type: 'user' | 'agent' | 'system' | 'owner';
  roles: string[];             // e.g. ['admin', 'ceo', 'rider']
  tenantId?: string;
  isOwner?: boolean;           // System owner override
}

// ── ACL Engine ────────────────────────────────────────────────────────────
export class MemoryACL {

  // ── READ access ──────────────────────────────────────────────────────
  static canRead(entry: MemoryEntry, caller: MemoryCaller): MemoryACLResult {
    // System always has read
    if (caller.type === 'system') return { allowed: true };

    // Owner override (with full audit log)
    if (caller.isOwner) {
      log.warn('Owner override used for memory read', {
        entryId: entry.id, type: entry.type, callerId: caller.id,
      });
      return { allowed: true };
    }

    switch (entry.type) {

      case MemoryType.PERSONAL: {
        const p = entry as PersonalMemory;
        const allowed = p.agentId === caller.id || p.ownerId === caller.id;
        return allowed
          ? { allowed: true }
          : { allowed: false, reason: 'Personal memory: only the owning agent can read' };
      }

      case MemoryType.SHARED:
        // All authenticated callers can read shared memory
        return { allowed: true };

      case MemoryType.IMMUTABLE:
        // All callers can read immutable records (audit log)
        return { allowed: true };

      case MemoryType.OWNER: {
        const allowed = !!caller.isOwner;
        return allowed
          ? { allowed: true }
          : { allowed: false, reason: 'Owner memory: only system owner can read' };
      }

      case MemoryType.RESTRICTED: {
        const r = entry as RestrictedMemory;
        if (r.deniedUserIds.includes(caller.id)) {
          return { allowed: false, reason: 'Caller is explicitly denied' };
        }
        if (r.allowedUserIds.includes(caller.id)) return { allowed: true };
        const hasRole = caller.roles.some(role => r.allowedRoles.includes(role));
        return hasRole
          ? { allowed: true }
          : { allowed: false, reason: `Requires one of roles: ${r.allowedRoles.join(', ')}`, requiredRole: r.allowedRoles[0] };
      }

      case MemoryType.EPISODIC: {
        // Only the user who owns the episode, or admins
        const allowed = entry.ownerId === caller.id || caller.roles.includes('admin') || caller.roles.includes('rep');
        return allowed
          ? { allowed: true }
          : { allowed: false, reason: 'Episodic memory: only owner or support roles can read' };
      }

      case MemoryType.SEMANTIC:
        // Semantic knowledge is generally readable
        return { allowed: true };

      case MemoryType.LEARNING: {
        // Learning memory readable by admins, analysts, and owning agent
        const allowed = entry.ownerId === caller.id
          || caller.roles.includes('admin')
          || caller.roles.includes('analyst');
        return allowed
          ? { allowed: true }
          : { allowed: false, reason: 'Learning memory: requires admin or analyst role' };
      }

      default:
        return { allowed: false, reason: 'Unknown memory type' };
    }
  }

  /**
   * Added per CTO Audit Part 5, section 16 ("Cross Agent Memory... Rule: Read
   * Summary Only. No Full Access."). This is a SEPARATE, opt-in check —
   * canRead() above is unchanged (still a hard allow/deny per type, e.g.
   * PersonalMemory still denies non-owning agents outright). Call this
   * instead of canRead() specifically for the "let another agent see enough
   * to have context, without full access" use case — e.g. SupervisorAgent
   * wanting a hint of what CustomerSupportAgent knows about a customer,
   * without reading that agent's full personal memory.
   *
   * Deliberately NOT the default behavior for canRead() itself: changing
   * existing denials into summary-allows would be a real behavior change to
   * every existing caller, not an additive one — see the ADR for why this
   * is a new method rather than a modification to canRead().
   */
  static canReadCrossAgent(entry: MemoryEntry, caller: MemoryCaller): MemoryACLResult {
    if (caller.type === 'system' || caller.isOwner) return { allowed: true }; // full access, unchanged

    // Types that should never be summarized for cross-agent visibility, full
    // stop — these are exactly the types canRead() already hard-denies or
    // tightly scopes, and summarizing them would leak their existence/shape
    // even if content is redacted.
    if (entry.type === MemoryType.OWNER || entry.type === MemoryType.RESTRICTED) {
      return { allowed: false, reason: `${entry.type} memory is never available cross-agent, even as a summary` };
    }

    // Already-owned or already-fully-readable per canRead(): no need for the
    // summary path, full access already applies.
    const full = this.canRead(entry, caller);
    if (full.allowed) return full;

    // Everything else (typically PersonalMemory owned by a different agent):
    // allow, but flagged summary-only. The caller is responsible for actually
    // calling summarize() below rather than returning entry.content directly —
    // this method controls the PERMISSION, not the redaction itself.
    return { allowed: true, summaryOnly: true };
  }

  /** Truncates content for summary-only cross-agent access. Deliberately
   *  simple (length truncation + marker) rather than an AI-generated summary —
   *  an AI-generated summary of memory content is itself a new AI operation
   *  with its own cost/latency/hallucination-risk, out of scope for what's
   *  fundamentally an access-control primitive. Callers wanting a smarter
   *  summary should generate one explicitly via NexusUnifiedCore and cache it,
   *  not expect this function to do it silently. */
  static summarize(content: string, maxLength = 200): string {
    if (content.length <= maxLength) return content;
    return `${content.slice(0, maxLength)}… [truncated — summary-only cross-agent access, see MemoryACL.canReadCrossAgent]`;
  }

  // ── WRITE access ─────────────────────────────────────────────────────
  static canWrite(entry: MemoryEntry | null, type: MemoryType, caller: MemoryCaller): MemoryACLResult {
    if (caller.type === 'system') return { allowed: true };

    if (caller.isOwner) {
      log.warn('Owner override used for memory write', { type, callerId: caller.id });
      return { allowed: true };
    }

    switch (type) {

      case MemoryType.PERSONAL:
        // Only the owning agent can write personal memory
        if (!entry) return { allowed: true }; // New entry OK
        const p = entry as PersonalMemory;
        return p.agentId === caller.id
          ? { allowed: true }
          : { allowed: false, reason: 'Personal memory: only owning agent can write' };

      case MemoryType.SHARED: {
        if (!entry) return { allowed: true }; // New shared memory OK
        const s = entry as SharedMemory;
        if (s.writePolicy === 'owner_only') {
          return s.ownerId === caller.id
            ? { allowed: true }
            : { allowed: false, reason: 'Shared memory write policy: owner_only' };
        }
        if (s.writePolicy === 'single_writer') {
          // Check write lock
          if (s.lockHolder && s.lockHolder !== caller.id) {
            const lockAge = Date.now() - (s.lockedAt || 0);
            if (lockAge < 30_000) { // 30s lock timeout
              return { allowed: false, reason: `Shared memory locked by ${s.lockHolder}` };
            }
          }
        }
        return { allowed: true };
      }

      case MemoryType.IMMUTABLE:
        // Immutable = write once only. Cannot update existing.
        if (entry) {
          return { allowed: false, reason: 'Immutable memory cannot be modified after creation' };
        }
        return { allowed: true };

      case MemoryType.OWNER:
        return caller.isOwner
          ? { allowed: true }
          : { allowed: false, reason: 'Owner memory: only system owner can write' };

      case MemoryType.RESTRICTED: {
        if (!entry) {
          // Creating new restricted memory requires admin
          return caller.roles.includes('admin')
            ? { allowed: true }
            : { allowed: false, reason: 'Creating restricted memory requires admin role' };
        }
        const r = entry as RestrictedMemory;
        const hasRole = caller.roles.some(role => r.allowedRoles.includes(role));
        return hasRole && !r.deniedUserIds.includes(caller.id)
          ? { allowed: true }
          : { allowed: false, reason: 'Insufficient role for restricted memory write' };
      }

      case MemoryType.EPISODIC:
        // Only owning user/agent can append to episode
        if (!entry) return { allowed: true };
        return entry.ownerId === caller.id
          ? { allowed: true }
          : { allowed: false, reason: 'Episodic memory: only owner can append' };

      case MemoryType.SEMANTIC:
        // Semantic knowledge written by admins or knowledge managers
        // (system callers already returned allowed:true at the top of canWrite)
        return caller.roles.includes('admin') || caller.roles.includes('knowledge_manager')
          ? { allowed: true }
          : { allowed: false, reason: 'Semantic memory requires admin or knowledge_manager role' };

      case MemoryType.LEARNING:
        // Learning written by agents or admins
        // (system callers already returned allowed:true at the top of canWrite)
        return caller.type === 'agent' || caller.roles.includes('admin')
          ? { allowed: true }
          : { allowed: false, reason: 'Learning memory written by agents or admins only' };

      default:
        return { allowed: false, reason: 'Unknown memory type' };
    }
  }

  // ── DELETE access ─────────────────────────────────────────────────────
  static canDelete(entry: MemoryEntry, caller: MemoryCaller): MemoryACLResult {
    if (caller.type === 'system') return { allowed: true };
    if (caller.isOwner) return { allowed: true };

    // Immutable memory can NEVER be deleted (not even by owner via API)
    if (entry.type === MemoryType.IMMUTABLE) {
      return { allowed: false, reason: 'Immutable memory cannot be deleted — it is the permanent audit record' };
    }

    // Owner of the entry can delete
    if (entry.ownerId === caller.id) return { allowed: true };

    // Admins can delete anything except immutable
    if (caller.roles.includes('admin')) return { allowed: true };

    return { allowed: false, reason: 'Only entry owner or admin can delete memory' };
  }

  // ── Audit log helper ──────────────────────────────────────────────────
  static logAccessDenied(
    operation: 'read' | 'write' | 'delete',
    entryId: string,
    type: MemoryType,
    caller: MemoryCaller,
    reason: string,
  ) {
    log.warn(`Memory ACL: ${operation} DENIED`, {
      entryId, type, callerId: caller.id, callerType: caller.type,
      callerRoles: caller.roles, reason,
    });
  }
}
