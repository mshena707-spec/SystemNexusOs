/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         NEXUS ABAC ENGINE — Phase 4+5                        ║
 * ║  Attribute-Based Access Control for all system resources     ║
 * ║                                                              ║
 * ║  Covers:                                                     ║
 * ║   ✓ ABAC policy evaluation                                   ║
 * ║   ✓ Prompt injection defense                                 ║
 * ║   ✓ Output sanitization                                      ║
 * ║   ✓ Immutable audit logging                                  ║
 * ║   ✓ Tenant isolation enforcement                             ║
 * ║   ✓ API gateway protection                                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { logger } from '../../core/logging/NexusLogger';
import { EventBus } from '../../core/events/NexusEventBus';
import { MemoryEngine } from '../../memory/NexusMemoryEngine';

const log = logger.child('ABACEngine');
const SYSTEM_CALLER = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };

// ── ABAC Policy types ─────────────────────────────────────────────────────
export interface ABACSubject {
  userId: string;
  roles: string[];
  tenantId?: string;
  agentId?: string;
  ipAddress?: string;
  sessionId?: string;
}

export interface ABACResource {
  type: string;       // 'order' | 'product' | 'memory' | 'agent' | 'tool' | 'api'
  id?: string;
  ownerId?: string;
  tenantId?: string;
  classification?: 'public' | 'internal' | 'confidential' | 'secret';
}

export interface ABACAction {
  type: 'read' | 'write' | 'delete' | 'execute' | 'admin';
}

export interface ABACPolicy {
  id: string;
  name: string;
  effect: 'allow' | 'deny';
  subjects: { roles?: string[]; userIds?: string[] };
  resources: { types?: string[]; classifications?: string[] };
  actions: ABACAction['type'][];
  conditions?: {
    requireSameOwner?: boolean;
    requireSameTenant?: boolean;
    timeWindow?: { start: number; end: number };
    ipWhitelist?: string[];
  };
  priority: number;   // Higher = evaluated first
}

export interface ABACDecision {
  allowed: boolean;
  policy?: string;
  reason: string;
  auditId: string;
}

// ════════════════════════════════════════════════════════════════════════
// ABAC ENGINE
// ════════════════════════════════════════════════════════════════════════
class NexusABACEngineImpl {
  private policies: ABACPolicy[] = [];
  private auditLog: Array<{
    id: string; subject: ABACSubject; resource: ABACResource;
    action: string; decision: boolean; policy?: string; timestamp: number;
  }> = [];

  constructor() {
    this._loadDefaultPolicies();
  }

  /** Evaluate whether a subject can perform an action on a resource */
  evaluate(subject: ABACSubject, resource: ABACResource, action: ABACAction): ABACDecision {
    const auditId = `abac_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Sort policies by priority desc
    const sorted = [...this.policies].sort((a, b) => b.priority - a.priority);

    for (const policy of sorted) {
      if (!this._matchesPolicy(policy, subject, resource, action)) continue;

      const decision: ABACDecision = {
        allowed: policy.effect === 'allow',
        policy: policy.id,
        reason: `Policy '${policy.name}' ${policy.effect}s ${action.type} on ${resource.type}`,
        auditId,
      };

      this._logDecision(auditId, subject, resource, action.type, decision.allowed, policy.id);
      return decision;
    }

    // Default deny
    const decision: ABACDecision = {
      allowed: false,
      reason: `No matching policy found for ${action.type} on ${resource.type}`,
      auditId,
    };
    this._logDecision(auditId, subject, resource, action.type, false);
    return decision;
  }

  /** Register a custom policy */
  addPolicy(policy: ABACPolicy): void {
    this.policies = this.policies.filter(p => p.id !== policy.id);
    this.policies.push(policy);
    log.info(`ABAC policy added: ${policy.id} (${policy.effect})`);
  }

  removePolicy(policyId: string): void {
    this.policies = this.policies.filter(p => p.id !== policyId);
  }

  listPolicies(): ABACPolicy[] { return [...this.policies]; }
  getAuditLog(limit = 100) { return this.auditLog.slice(0, limit); }

  private _matchesPolicy(policy: ABACPolicy, subject: ABACSubject, resource: ABACResource, action: ABACAction): boolean {
    // Check action
    if (!policy.actions.includes(action.type)) return false;

    // Check subject roles/ids
    const subjectMatch =
      (!policy.subjects.roles?.length || policy.subjects.roles.some(r => subject.roles.includes(r))) &&
      (!policy.subjects.userIds?.length || policy.subjects.userIds.includes(subject.userId));
    if (!subjectMatch) return false;

    // Check resource type/classification
    const resourceMatch =
      (!policy.resources.types?.length || policy.resources.types.includes(resource.type)) &&
      (!policy.resources.classifications?.length ||
        (resource.classification && policy.resources.classifications.includes(resource.classification)));
    if (!resourceMatch) return false;

    // Check conditions
    if (policy.conditions) {
      const { requireSameOwner, requireSameTenant, ipWhitelist } = policy.conditions;
      if (requireSameOwner && resource.ownerId && resource.ownerId !== subject.userId) return false;
      if (requireSameTenant && resource.tenantId && resource.tenantId !== subject.tenantId) return false;
      if (ipWhitelist?.length && subject.ipAddress && !ipWhitelist.includes(subject.ipAddress)) return false;
    }

    return true;
  }

  private _logDecision(auditId: string, subject: ABACSubject, resource: ABACResource, action: string, decision: boolean, policy?: string) {
    this.auditLog.unshift({ id: auditId, subject, resource, action, decision, policy, timestamp: Date.now() });
    if (this.auditLog.length > 5000) this.auditLog.pop();

    if (!decision) {
      log.warn('ABAC: access denied', { userId: subject.userId, roles: subject.roles, resource: resource.type, action, policy });
      EventBus.emitAsync('security.breach_attempt', { type: 'abac_denial', auditId, subject, resource, action }, 'ABACEngine');
    }

    // Persist to immutable memory for compliance
    MemoryEngine.writeImmutable('system', `abac:${subject.userId}`,
      `${decision ? 'ALLOW' : 'DENY'} | ${subject.userId} | ${action} | ${resource.type}:${resource.id || '*'}`,
      {}, SYSTEM_CALLER
    ).catch(() => {});
  }

  private _loadDefaultPolicies(): void {
    // Admin: full access
    this.addPolicy({
      id: 'admin-full', name: 'Admin Full Access', effect: 'allow', priority: 100,
      subjects: { roles: ['admin', 'ceo'] },
      resources: { types: ['order', 'product', 'user', 'memory', 'agent', 'tool', 'api', 'analytics'] },
      actions: ['read', 'write', 'delete', 'execute', 'admin'],
    });

    // Customer: own orders + public products
    this.addPolicy({
      id: 'customer-own-orders', name: 'Customer Own Orders', effect: 'allow', priority: 50,
      subjects: { roles: ['customer'] },
      resources: { types: ['order'], classifications: ['public', 'internal'] },
      actions: ['read'],
      conditions: { requireSameOwner: true },
    });
    this.addPolicy({
      id: 'customer-products', name: 'Customer Product Read', effect: 'allow', priority: 50,
      subjects: { roles: ['customer'] },
      resources: { types: ['product'], classifications: ['public'] },
      actions: ['read'],
    });

    // Rider: delivery orders
    this.addPolicy({
      id: 'rider-orders', name: 'Rider Delivery Orders', effect: 'allow', priority: 60,
      subjects: { roles: ['rider'] },
      resources: { types: ['order'] },
      actions: ['read', 'write'],
    });

    // Support rep: customer data + orders
    this.addPolicy({
      id: 'rep-support', name: 'Support Rep Access', effect: 'allow', priority: 60,
      subjects: { roles: ['rep'] },
      resources: { types: ['order', 'user', 'product'] },
      actions: ['read', 'write'],
    });

    // Deny confidential data to non-admins
    this.addPolicy({
      id: 'deny-confidential', name: 'Deny Confidential to Non-Admin', effect: 'deny', priority: 90,
      subjects: { roles: ['customer', 'rider', 'vendor'] },
      resources: { classifications: ['confidential', 'secret'] },
      actions: ['read', 'write', 'delete', 'execute', 'admin'],
    });

    // Vendor: own store only
    this.addPolicy({
      id: 'vendor-own-store', name: 'Vendor Own Store', effect: 'allow', priority: 55,
      subjects: { roles: ['vendor'] },
      resources: { types: ['product', 'order'] },
      actions: ['read', 'write'],
      conditions: { requireSameTenant: true },
    });

    log.info(`ABAC: ${this.policies.length} default policies loaded`);
  }
}

export const ABACEngine = new NexusABACEngineImpl();

// ════════════════════════════════════════════════════════════════════════
// PROMPT INJECTION DEFENSE — Phase 5
// ════════════════════════════════════════════════════════════════════════
const INJECTION_PATTERNS = [
  // Classic prompt injection — supports multi-word modifiers (e.g. 'all previous instructions')
  /ignore\s+(?:(?:previous|all|above|prior|the|my|your|these)\s+)+(instructions?|prompts?|context|rules?|guidelines?)/i,
  /forget\s+(everything|all|previous|what|your)/i,
  /you\s+are\s+(now|actually)\s+(a\s+)?(?!helpful|an?\s+AI)/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(a\s+)?(?!helpful|an?\s+assistant)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(?!helpful)/i,
  /roleplay\s+as\s+(?!helpful)/i,
  /your\s+(real|true|actual)\s+(instructions?|purpose|goal|task)/i,
  /system\s*prompt/i,
  /jailbreak/i,
  // Data exfiltration attempts
  /print\s+(all|your|the)\s+(instructions?|system|prompt|config)/i,
  /reveal\s+(your|the)\s+(system|prompt|instructions?|api\s+key)/i,
  /show\s+me\s+(your|the)\s+(system|prompt|config|key)/i,
  // Command injection
  /```\s*(bash|sh|python|js|javascript|cmd|powershell)/i,
  /<script|<iframe|javascript:/i,
  /\$\{.*\}|`.*`/,  // Template injection
  // SSRF attempts
  /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.)/i,
  // SQL injection patterns
  /union\s+select|drop\s+table|insert\s+into\s+\w+\s+values/i,
];

export interface SanitizeResult {
  safe: boolean;
  sanitized: string;
  threats: string[];
  blocked: boolean;
}

export class PromptDefender {

  static analyze(input: string): SanitizeResult {
    const threats: string[] = [];
    let blocked = false;

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        threats.push(pattern.source.split('\\')[0].slice(0, 40));
        blocked = true;
      }
    }

    // Score-based approach for borderline cases
    const suspiciousCount = (input.match(/ignore|forget|pretend|act as|jailbreak|system prompt/gi) || []).length;
    if (suspiciousCount >= 2) {
      threats.push('multiple_injection_keywords');
      blocked = true;
    }

    if (blocked) {
      EventBus.emitAsync('security.breach_attempt', {
        type: 'prompt_injection', threats, inputLength: input.length,
      }, 'PromptDefender');
      log.warn('Prompt injection detected', { threats, inputPreview: input.slice(0, 80) });
    }

    // Sanitize: remove obvious injection attempts but preserve legitimate text
    const sanitized = blocked
      ? input
          .replace(/ignore\s+(previous|all|above)\s+instructions?/gi, '[filtered]')
          .replace(/forget\s+everything/gi, '[filtered]')
          .replace(/<script[^>]*>.*?<\/script>/gi, '[filtered]')
          .replace(/```(bash|sh|python|javascript)/gi, '```[filtered]')
      : input;

    return { safe: !blocked, sanitized, threats, blocked };
  }

  /** Sanitize AI output before sending to users */
  static sanitizeOutput(output: string): string {
    return output
      // Remove potential secret leakage
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[API_KEY_REDACTED]')
      .replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[AWS_KEY_REDACTED]')
      // Remove file paths that could reveal server structure
      .replace(/\/home\/[a-zA-Z0-9_-]+\//g, '/[PATH_REDACTED]/')
      .replace(/C:\\Users\\[a-zA-Z0-9_-]+\\/g, 'C:\\[PATH_REDACTED]\\');
  }
}

// ════════════════════════════════════════════════════════════════════════
// EXPRESS MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════

/** ABAC middleware for Express routes */
export function abacMiddleware(resourceType: string, action: ABACAction['type']) {
  return (req: any, res: any, next: any) => {
    const subject: ABACSubject = {
      userId: req.user?.uid || 'anonymous',
      roles: req.user?.roles || ['customer'],
      tenantId: req.headers['x-tenant-id'],
      ipAddress: req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress,
      sessionId: req.headers['x-session-id'],
    };

    const resource: ABACResource = {
      type: resourceType,
      id: req.params?.id,
      ownerId: req.body?.userId || req.params?.userId,
      classification: 'internal',
    };

    const decision = ABACEngine.evaluate(subject, resource, { type: action });

    if (!decision.allowed) {
      return res.status(403).json({
        error: 'Access denied',
        reason: decision.reason,
        auditId: decision.auditId,
      });
    }

    req.abacDecision = decision;
    next();
  };
}

/** Prompt injection defense middleware */
export function promptDefenseMiddleware() {
  return (req: any, res: any, next: any) => {
    const message = req.body?.message || req.body?.prompt || req.body?.task || '';
    if (!message) return next();

    const result = PromptDefender.analyze(message);
    if (result.blocked) {
      return res.status(400).json({
        error: 'Message contains potentially harmful content',
        threats: result.threats,
      });
    }

    // Replace with sanitized version
    if (req.body.message) req.body.message = result.sanitized;
    if (req.body.prompt) req.body.prompt = result.sanitized;
    if (req.body.task) req.body.task = result.sanitized;
    next();
  };
}
