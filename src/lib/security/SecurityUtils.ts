/**
 * Security Utilities (Phase H)
 * PII Masking, Signature Validation, and Anomaly scoring.
 */
export class SecurityUtils {
  
  /**
   * Masks Personally Identifiable Information (PII) before storage or logging.
   */
  static maskPII(text: string): string {
    let masked = text;
    // Mask emails
    masked = masked.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi, '***@***.***');
    // Mask Phone numbers (simple regex for demo)
    masked = masked.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '***-***-****');
    // Mask Credit Cards
    masked = masked.replace(/\b(?:\d[ -]*?){13,16}\b/g, '****-****-****-****');
    
    return masked;
  }

  /**
   * Validates a Webhook Signature (e.g. for incoming WhatsApp, FB requests)
   */
  static validateWebhookSignature(payload: string, signature: string, secret: string): boolean {
    // In actual implementation, implement HMAC SHA256 validation
    // import crypto from 'crypto';
    // const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    // return hash === signature;
    return signature.length > 5; // Placeholder
  }

  /**
   * Advanced RBAC/ABAC Evaluator
   */
  static evaluateAccess(userAttributes: Record<string, string>, resourcePolicy: Record<string, string[]>): boolean {
    const userRole = userAttributes.role || 'guest';
    const allowedRoles = resourcePolicy.allowedRoles || ['admin'];
    
    if (allowedRoles.includes(userRole)) return true;
    if (allowedRoles.includes('*')) return true;

    return false;
  }
}
