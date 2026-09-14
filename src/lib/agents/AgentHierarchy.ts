/**
 * PHASE 52: AGENT HIERARCHY SYSTEM
 * Establishes absolute chain of command. Lower agents CANNOT override higher agents.
 */
export enum AgentLevel {
  OWNER_AI = 0,
  SECURITY_AI = 1,
  SYSTEM_AI = 2,
  CUSTOMER_AI = 3,
  BACKUP_AI = 4
}

export class AgentHierarchy {
  static canOverride(actorLevel: AgentLevel, targetLevel: AgentLevel): boolean {
    return actorLevel < targetLevel;
  }

  static assertAuthority(actorLevel: AgentLevel, targetLevel: AgentLevel) {
    if (!this.canOverride(actorLevel, targetLevel)) {
      throw new Error(`[AgentHierarchy] INSUFFICIENT CLEARANCE. Agent level ${actorLevel} cannot override level ${targetLevel}.`);
    }
  }
}
