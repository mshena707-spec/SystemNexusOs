import { TaintEngine } from './TaintEngine';

export class SecureToolRouter {
  // Define allowed tools for the system
  private static allowedTools = new Set([
    'search_products', 
    'check_order_status', 
    'get_shipping_info',
    'generate_3d_model',
    'analyze_security_logs'
  ]);

  /**
   * Validates if a tool call is permitted and malformed.
   */
  static validateToolCall(toolName: string, args: any): { valid: boolean; reason?: string } {
    if (!this.allowedTools.has(toolName)) {
      console.warn(`[Security] Blocked unauthorized tool call: ${toolName}`);
      return { valid: false, reason: `Tool ${toolName} is not in the allowlist.` };
    }

    if (typeof args !== 'object' || args === null) {
      return { valid: false, reason: `Malformed arguments for tool ${toolName}.` };
    }

    // Reject tainted arguments
    if (TaintEngine.isTainted(args)) {
      return { valid: false, reason: `Tool arguments are tainted and cannot be executed.` };
    }

    // Basic schema validation (could be expanded per tool)
    for (const key in args) {
      if (typeof args[key] === 'string' && args[key].length > 1000) {
         return { valid: false, reason: `Argument ${key} exceeds maximum length.` };
      }
    }

    return { valid: true };
  }
}
