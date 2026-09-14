/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  PROMPT SHIELD                                                           ║
 * ║  Answers CTO Audit Part 3, section 16 (AI Security).                    ║
 * ║                                                                           ║
 * ║  Confirmed gap: zero prompt-injection, jailbreak-detection, or sensitive-║
 * ║  data-filtering code existed anywhere in this codebase before this file. ║
 * ║  This is also, not coincidentally, the folder CTO Audit Part 1 found as ║
 * ║  a malformed, empty, unexpanded-brace directory                         ║
 * ║  (`src/lib/security/{abac,audit,prompt}`) — `abac` and `audit` exist as ║
 * ║  real folders; `prompt` never got created. This completes it.           ║
 * ║                                                                           ║
 * ║  SCOPE, STATED HONESTLY: this is pattern/heuristic-based, not an ML      ║
 * ║  classifier. That's a real, meaningful first layer (most production     ║
 * ║  prompt-injection defenses start here and layer ML on top later) but it ║
 * ║  WILL miss novel phrasings a classifier would catch, and it CAN false-   ║
 * ║  positive on legitimate text that happens to match a pattern. Treat     ║
 * ║  `blocked: true` as "route to human review," not "definitely malicious."║
 * ║                                                                           ║
 * ║  USAGE:                                                                  ║
 * ║    const result = PromptShield.inspect(userInput);                      ║
 * ║    if (result.blocked) { throw new NexusError('AI_PROMPT_BLOCKED', ...) }║
 * ║    const cleaned = PromptShield.filterSensitiveData(aiOutput).filtered; ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { EventBus } from '../../core/events/NexusEventBus';
import { logger } from '../../core/logging/NexusLogger';

const log = logger.child('PromptShield');

export type ThreatCategory =
  | 'instruction_override'   // "ignore previous instructions", "you are now DAN"
  | 'system_prompt_leak'     // "repeat your system prompt", "what were you told"
  | 'role_confusion'         // pretending to be system/developer/admin in-band
  | 'delimiter_injection'    // fake ``` or [SYSTEM] blocks trying to inject a new turn
  | 'encoding_evasion'       // base64/hex/rot13 wrapping to smuggle instructions
  | 'excessive_length';      // abnormally long input, a common obfuscation vector

export interface InspectionResult {
  blocked: boolean;
  riskScore: number;                  // 0–1
  categories: ThreatCategory[];
  reason?: string;
}

export interface SensitiveDataResult {
  filtered: string;
  redactions: Array<{ type: string; count: number }>;
}

// Pattern-level, not word-level — kept intentionally small and named, so each
// one is auditable and its false-positive risk is individually understood,
// rather than a giant regurgitated blocklist nobody can reason about.
const INSTRUCTION_OVERRIDE_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+|any\s+)?(previous|prior|above)\s+(instructions?|rules?)/i,
  /you\s+are\s+now\s+(DAN|in\s+developer\s+mode|jailbroken|unrestricted|free\s+from)/i,
  /forget\s+(everything|all)\s+(you\s+)?(were\s+told|know)/i,
  /new\s+instructions?\s*:\s*(ignore|disregard|override)/i,
];

const SYSTEM_PROMPT_LEAK_PATTERNS = [
  /repeat\s+(your\s+)?(system\s+)?(prompt|instructions)/i,
  /what\s+(were\s+you|are\s+your)\s+(told|instructions|system\s+prompt)/i,
  /print\s+(your\s+)?(initial|system)\s+(prompt|instructions)/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
];

const ROLE_CONFUSION_PATTERNS = [
  /\[?(system|developer|admin)\]?\s*:\s*(you|override|new)/i,
  /as\s+the\s+(system|developer|administrator),?\s+i\s+(command|instruct|order)/i,
];

const DELIMITER_INJECTION_PATTERNS = [
  /```\s*(system|instructions?)\s*```/i,
  /<\|?(system|im_start|im_end)\|?>/i,
  /\[SYSTEM\]|\[\/SYSTEM\]/,
];

const ENCODING_EVASION_PATTERNS = [
  /(?:[A-Za-z0-9+/]{40,}={0,2})/,          // long base64-looking blob
  /(?:\\x[0-9a-fA-F]{2}){10,}/,             // hex-escape smuggling
];

// Sensitive-data patterns — deliberately conservative (favor missing a hit over
// mangling legitimate text) since this runs on AI *output* shown to real users.
const SENSITIVE_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'credit_card', pattern: /\b(?:\d[ -]*?){13,16}\b/g },
  { type: 'email', pattern: /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/g },
  { type: 'api_key_like', pattern: /\b(sk|pk|key|token)[-_][A-Za-z0-9]{16,}\b/gi },
  { type: 'phone_bd', pattern: /\b(?:\+?880|0)1[3-9]\d{8}\b/g }, // Bangladesh mobile format — matches the COD/local-payments market focus documented in SYSTEM_SECURITY.md
  // Added per CTO Audit Part 4, section 8 ("Financial Leak Detection", "Owner
  // Data Detection", "Prompt Leak Detection" — beyond what §16's input-side
  // checks already covered):
  { type: 'bank_account', pattern: /\b(?:account|a\/c)[\s#:]*\d{8,17}\b/gi },
  { type: 'routing_swift', pattern: /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g }, // SWIFT/BIC format
  { type: 'owner_secret_marker', pattern: /\bOWNER_SECRET\b|\bJWT_SECRET\b|\bMEMORY_ENCRYPTION_KEY\b/g }, // env var *names* leaking is itself a signal, even without a value attached
];

// Output-side prompt-leak check — distinct from inspect()'s input-side
// SYSTEM_PROMPT_LEAK_PATTERNS (which catch a *user asking* for the prompt).
// This catches the AI's *response* actually containing system-prompt-shaped
// content, which can happen even without the user successfully prompting for
// it (e.g. leaking through a confused completion).
const OUTPUT_PROMPT_LEAK_PATTERNS = [
  /you are (a|an) (helpful )?(ai|assistant|agent)[,.]? (created|built|designed) by/i,
  /my (system prompt|instructions) (is|are|say)/i,
  /\[SYSTEM\][\s\S]{0,200}\[\/SYSTEM\]/,
];

class PromptShieldImpl {
  /** Run before user input reaches an LLM. */
  inspect(input: string, context?: { userId?: string; agentId?: string; traceId?: string }): InspectionResult {
    const categories: ThreatCategory[] = [];

    if (this._matchesAny(input, INSTRUCTION_OVERRIDE_PATTERNS)) categories.push('instruction_override');
    if (this._matchesAny(input, SYSTEM_PROMPT_LEAK_PATTERNS)) categories.push('system_prompt_leak');
    if (this._matchesAny(input, ROLE_CONFUSION_PATTERNS)) categories.push('role_confusion');
    if (this._matchesAny(input, DELIMITER_INJECTION_PATTERNS)) categories.push('delimiter_injection');
    if (this._matchesAny(input, ENCODING_EVASION_PATTERNS)) categories.push('encoding_evasion');
    if (input.length > 8000) categories.push('excessive_length');

    // Weighted, not just a count — instruction override and system-prompt-leak are
    // the two categories with the clearest malicious intent, so they weigh more.
    const weights: Record<ThreatCategory, number> = {
      instruction_override: 0.4,
      system_prompt_leak: 0.35,
      role_confusion: 0.25,
      delimiter_injection: 0.2,
      encoding_evasion: 0.15,
      excessive_length: 0.1,
    };
    const riskScore = Math.min(1, categories.reduce((sum, c) => sum + weights[c], 0));
    const blocked = riskScore >= 0.4;

    if (categories.length > 0) {
      log.warn('Prompt inspection flagged input', { categories, riskScore, blocked, userId: context?.userId, traceId: context?.traceId });
    }
    if (blocked) {
      // Reuses the existing security event taxonomy (docs/architecture/SYSTEM_SECURITY.md)
      // rather than inventing a parallel channel — so this shows up wherever
      // fraud.detected/security.breach_attempt already gets watched.
      EventBus.emit('security.breach_attempt', {
        subtype: 'prompt_injection',
        categories,
        riskScore,
        userId: context?.userId,
        agentId: context?.agentId,
        traceId: context?.traceId,
      }, 'PromptShield');
    }

    return {
      blocked,
      riskScore,
      categories,
      reason: categories.length > 0 ? `Matched: ${categories.join(', ')}` : undefined,
    };
  }

  /** Run on AI *output* before showing it to a user — different concern from
   *  inspect() (which guards input): this guards against the model echoing back
   *  something sensitive it picked up from memory/context/tool results. */
  filterSensitiveData(text: string): SensitiveDataResult {
    let filtered = text;
    const redactions: Array<{ type: string; count: number }> = [];

    for (const { type, pattern } of SENSITIVE_PATTERNS) {
      const matches = filtered.match(pattern);
      if (matches && matches.length > 0) {
        filtered = filtered.replace(pattern, `[REDACTED_${type.toUpperCase()}]`);
        redactions.push({ type, count: matches.length });
      }
    }

    // Output-side prompt leak: redact the whole matched span rather than trying
    // to salvage the surrounding text — a response that's leaking its own
    // system prompt is not one worth partially showing.
    for (const pattern of OUTPUT_PROMPT_LEAK_PATTERNS) {
      if (pattern.test(filtered)) {
        filtered = filtered.replace(pattern, '[RESPONSE WITHHELD — POSSIBLE PROMPT LEAK]');
        redactions.push({ type: 'output_prompt_leak', count: 1 });
      }
    }

    if (redactions.length > 0) {
      log.warn('Sensitive data redacted from AI output', { redactions });
    }
    return { filtered, redactions };
  }

  /** Memory-poisoning check: run before writing agent-sourced content into
   *  SharedMemory/SemanticMemory (docs/architecture/MEMORY_ARCHITECTURE.md) — the
   *  concern is different from inspect(): here we're asking "does this look like
   *  it's trying to plant an instruction that a FUTURE agent read will obey,"
   *  which is exactly the instruction-override pattern set, reused deliberately. */
  checkMemoryPoisoning(content: string): InspectionResult {
    return this.inspect(content); // same pattern set; kept as a named, separate
    // entry point so call sites read as intent ("checking before memory write"),
    // and so the two can diverge later without changing every call site.
  }

  private _matchesAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(input));
  }
}

export const PromptShield = new PromptShieldImpl();
