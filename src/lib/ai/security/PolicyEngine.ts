import policy from './security_policy.json';

export class PolicyEngine {
  static evaluate(actionType: string, userRole: string | undefined): { allowed: boolean; requiresConfirmation: boolean; reason?: string } {
    const role = userRole || 'anonymous';
    
    // Role check
    const allowedActionsForRole = (policy.roles as any)[role] || [];
    const hasRoleAccess = allowedActionsForRole.includes('*') || allowedActionsForRole.includes(actionType);
    
    if (!hasRoleAccess) {
      return { allowed: false, requiresConfirmation: false, reason: `Role ${role} is not permitted to perform ${actionType}` };
    }

    // Action check
    const actionPolicy = (policy.actions as any)[actionType] || policy.default;
    
    if (actionPolicy === 'block') {
      return { allowed: false, requiresConfirmation: false, reason: `Action ${actionType} is blocked by policy` };
    }
    
    if (actionPolicy === 'require_confirmation') {
      return { allowed: true, requiresConfirmation: true };
    }

    return { allowed: actionPolicy === 'allow', requiresConfirmation: false };
  }
}
