export class PermissionEngine {
  /**
   * Evaluates if a user is allowed to perform an action or talk to a specific agent.
   * Enforces a "deny by default" policy.
   */
  static check(userRole: string | undefined, agentRole: string, intent?: string): boolean {
    // Deny by default
    let allowed = false;
    const role = userRole || 'anonymous';

    // Admins have full access
    if (role === 'admin' || role === 'owner') {
      return true;
    }

    // Role-based routing checks
    if (role === 'rider') {
      if (agentRole === 'rider') allowed = true;
    } else if (role === 'customer' || role === 'anonymous') {
      if (agentRole === 'customer') allowed = true;
    }

    // If intent is provided, we can do granular action checks here
    if (intent && intent === 'system_modification') {
      allowed = false; // Only admins can modify system, handled above
    }

    return allowed;
  }
}
