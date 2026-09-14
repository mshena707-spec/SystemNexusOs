import { describe, it, expect } from 'vitest';
import { AgentHierarchy, AgentLevel } from '../../../src/lib/agents/AgentHierarchy';

/**
 * This is the test flagged as highest-priority across both Part 1
 * (docs/architecture/SYSTEM_SECURITY.md) and Part 2 (docs/architecture/AGENT_PROTOCOL.md):
 * the authority hierarchy is the single security-relevant control this whole
 * multi-agent system leans on, and until now nothing verified it actually
 * blocks what it claims to block.
 */
describe('AgentHierarchy — authority enforcement', () => {
  it('allows a higher-authority agent (lower number) to override a lower-authority agent', () => {
    expect(AgentHierarchy.canOverride(AgentLevel.OWNER_AI, AgentLevel.CUSTOMER_AI)).toBe(true);
    expect(AgentHierarchy.canOverride(AgentLevel.SECURITY_AI, AgentLevel.SYSTEM_AI)).toBe(true);
  });

  it('blocks a lower-authority agent from overriding a higher-authority agent', () => {
    expect(AgentHierarchy.canOverride(AgentLevel.CUSTOMER_AI, AgentLevel.OWNER_AI)).toBe(false);
    expect(AgentHierarchy.canOverride(AgentLevel.BACKUP_AI, AgentLevel.SECURITY_AI)).toBe(false);
  });

  it('blocks a same-level agent from "overriding" a peer (strict inequality, not <=)', () => {
    expect(AgentHierarchy.canOverride(AgentLevel.SYSTEM_AI, AgentLevel.SYSTEM_AI)).toBe(false);
  });

  it('assertAuthority throws when a lower-authority agent attempts to override a higher one', () => {
    expect(() => AgentHierarchy.assertAuthority(AgentLevel.CUSTOMER_AI, AgentLevel.OWNER_AI)).toThrow(
      /INSUFFICIENT CLEARANCE/
    );
  });

  it('assertAuthority does not throw for a legitimate override', () => {
    expect(() => AgentHierarchy.assertAuthority(AgentLevel.OWNER_AI, AgentLevel.CUSTOMER_AI)).not.toThrow();
  });

  it('every level in the 5-tier hierarchy is distinct and ordered as documented', () => {
    // OWNER_AI(0) > SECURITY_AI(1) > SYSTEM_AI(2) > CUSTOMER_AI(3) > BACKUP_AI(4)
    expect(AgentLevel.OWNER_AI).toBe(0);
    expect(AgentLevel.SECURITY_AI).toBe(1);
    expect(AgentLevel.SYSTEM_AI).toBe(2);
    expect(AgentLevel.CUSTOMER_AI).toBe(3);
    expect(AgentLevel.BACKUP_AI).toBe(4);
  });
});
