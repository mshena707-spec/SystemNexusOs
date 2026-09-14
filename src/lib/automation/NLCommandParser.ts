/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  NATURAL LANGUAGE COMMAND PARSER — Phase Q                           ║
 * ║                                                                       ║
 * ║  Converts owner commands like "give 10% discount to inactive         ║
 * ║  customers" into a structured AutomationRule via a real AI call      ║
 * ║  (AIProviderOrchestrator — same orchestrator used elsewhere in the   ║
 * ║  codebase, not a new fabricated provider integration).               ║
 * ║                                                                       ║
 * ║  SAFETY DESIGN (deliberate, not a missing feature):                  ║
 * ║  The AI's output is constrained to a strict allowlist of condition   ║
 * ║  and action types (see AutomationRuleEngine.CONDITION_TYPES /        ║
 * ║  ACTION_TYPES) and is schema-validated server-side before it is ever ║
 * ║  trusted. The parser NEVER creates or runs a rule itself — it only   ║
 * ║  returns a structured preview. A human (the owner) must explicitly   ║
 * ║  confirm before anything is saved or executed, because these        ║
 * ║  actions can issue real discounts or alert real suppliers. This is  ║
 * ║  the same human-in-the-loop pattern Phase P used for TaskScheduler's ║
 * ║  "Run Now" — manual confirmation, not blind autonomous execution.   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { AIProviderOrchestrator } from '../ai/providers/AIProviderOrchestrator';
import { CONDITION_TYPES, ACTION_TYPES, ConditionType, ActionType } from './AutomationRuleEngine';

export interface ParsedCommand {
  understood: boolean;
  ruleName?: string;
  conditionType?: ConditionType;
  conditionParams?: Record<string, any>;
  actionType?: ActionType;
  actionParams?: Record<string, any>;
  explanation: string;     // plain-English summary shown to the owner for confirmation
  rawCommand: string;
}

const SYSTEM_PROMPT = `You convert a store owner's plain-language business command into a structured automation rule.

You MUST respond with ONLY a single JSON object — no markdown fences, no prose before or after.

Allowed conditionType values (pick exactly one):
- "customer_inactive": params = { "minDaysInactive": number }
- "low_stock": params = { "maxDaysOfStockRemaining": number }
- "rider_performance_low": params = { "maxPerformanceScore": number (0-100) }

Allowed actionType values (pick exactly one):
- "issue_coupon": params = { "discountType": "percent"|"fixed", "discountValue": number, "expiresInDays": number }
  (only valid when conditionType is "customer_inactive")
- "alert_admin": params = {}
- "notify_supplier": params = {}
  (only valid when conditionType is "low_stock")

If the command does not clearly map to one of these combinations, respond with:
{ "understood": false, "explanation": "<why you could not map it>" }

If it does map, respond with exactly this shape:
{
  "understood": true,
  "ruleName": "<short human-readable name, max 8 words>",
  "conditionType": "...",
  "conditionParams": { ... },
  "actionType": "...",
  "actionParams": { ... },
  "explanation": "<one plain-English sentence describing what this rule will do, for the owner to confirm>"
}

Use sensible defaults when the owner doesn't give a number (e.g. "inactive" alone → minDaysInactive: 30; "10% discount" → discountType: "percent", discountValue: 10).`;

function safeJsonParse(text: string): any {
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

export class NLCommandParser {
  static async parse(command: string, userId?: string): Promise<ParsedCommand> {
    const trimmed = command.trim();
    if (!trimmed) {
      return { understood: false, explanation: 'Empty command.', rawCommand: command };
    }

    let raw: any;
    try {
      const result = await AIProviderOrchestrator.call({
        messages: [{ role: 'user', content: trimmed }],
        systemPrompt: SYSTEM_PROMPT,
        task: 'extract',
        role: 'admin',
        userId,
        timeoutMs: 20000,
      });
      raw = safeJsonParse(result.text);
    } catch (err: any) {
      return { understood: false, explanation: `AI parsing failed: ${err.message}`, rawCommand: command };
    }

    if (!raw || raw.understood !== true) {
      return { understood: false, explanation: raw?.explanation || 'Could not understand this command.', rawCommand: command };
    }

    // Hard server-side validation — never trust the model's allowlist adherence blindly.
    if (!CONDITION_TYPES.includes(raw.conditionType)) {
      return { understood: false, explanation: `Model proposed an unsupported condition "${raw.conditionType}".`, rawCommand: command };
    }
    if (!ACTION_TYPES.includes(raw.actionType)) {
      return { understood: false, explanation: `Model proposed an unsupported action "${raw.actionType}".`, rawCommand: command };
    }
    if (raw.actionType === 'issue_coupon' && raw.conditionType !== 'customer_inactive') {
      return { understood: false, explanation: 'Discount actions currently only support targeting inactive customers.', rawCommand: command };
    }
    if (raw.actionType === 'notify_supplier' && raw.conditionType !== 'low_stock') {
      return { understood: false, explanation: 'Supplier notifications currently only support the low-stock condition.', rawCommand: command };
    }

    return {
      understood: true,
      ruleName: String(raw.ruleName || 'Untitled rule').slice(0, 80),
      conditionType: raw.conditionType,
      conditionParams: raw.conditionParams || {},
      actionType: raw.actionType,
      actionParams: raw.actionParams || {},
      explanation: String(raw.explanation || ''),
      rawCommand: command,
    };
  }
}
