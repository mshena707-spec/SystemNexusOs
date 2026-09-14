/**
 * PersonalizationEngine — extracts and persists user behavior traits.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 *
 * Ethical note: behavioural profiling is used only for product recommendations
 * and UX personalisation. Data is stored server-side and never sold.
 */
import { NexusDB } from '../database/NexusDB';
import { Telemetry } from '../observability/Telemetry';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('PersonalizationEngine');

const ANON_IDS = new Set(['anonymous', 'offline_user', '']);

export class PersonalizationEngine {
  /**
   * Analyses recent messages, extracts preference traits via LLM,
   * and persists them to `user_preferences/{userId}` via NexusDB.
   */
  static async extractAndSavePreferences(
    userId: string,
    recentMessages: { role: string; content: string }[],
  ): Promise<void> {
    if (!userId || ANON_IDS.has(userId) || recentMessages.length < 2) return;

    const trace = Telemetry.startTrace('PersonalizationEngine.extract', userId, 'system');
    const span  = trace.startSpan('extract_preferences');

    try {
      // 1. Load existing traits to give the LLM context
      const existingPrefs = await NexusDB.get('user_preferences', userId);
      const existingTraits: string[] = (existingPrefs?.traits as string[]) ?? [];

      // 2. Build conversation transcript (capped for token efficiency)
      const conversation = recentMessages
        .slice(-20)
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n');

      // 3. LLM extraction
      const { AIGateway } = await import('../core/AIGateway');
      const ai = AIGateway.getProvider();

      const prompt = `You are a consumer behaviour analyst for NexusOS Marketplace.
Analyse the conversation and extract persistent preference facts for product personalisation.

Known facts:
${existingTraits.length > 0 ? existingTraits.map((p) => `- ${p}`).join('\n') : 'None'}

Recent conversation:
${conversation}

Output ONLY valid JSON — no markdown, no preamble:
{
  "traits": ["prefers dark colors", "size M"],
  "adminInsights": ["User may be interested in seasonal promotions."]
}`;

      const responseText = await ai.generateChat([{ role: 'user', content: prompt }]);
      const rawText = (responseText ?? '{}').replace(/```json|```/g, '').trim();
      const parsed  = JSON.parse(rawText) as { traits?: string[]; adminInsights?: string[] };

      const updatedTraits   = parsed.traits        ?? [];
      const adminInsights   = parsed.adminInsights ?? [];

      if (updatedTraits.length > 0 || adminInsights.length > 0) {
        // 4. Persist via NexusDB (merge so we don't overwrite other fields)
        await NexusDB.set(
          'user_preferences',
          userId,
          {
            userId,
            traits:      updatedTraits,
            insights:    adminInsights,
            lastUpdated: new Date().toISOString(),
          },
          true, // merge = true
        );

        // 5. Push sensitive insights to server memory endpoint (fire-and-forget)
        if (adminInsights.length > 0) {
          fetch('/api/memory/update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              type: 'customerInsights',
              data: { userId, insights: adminInsights, source: 'PersonalizationEngine' },
            }),
          }).catch(() => {});
        }

        trace.endSpan(span.id, 'success', undefined, {
          extractedTraitsCount: updatedTraits.length,
        });
      } else {
        trace.endSpan(span.id, 'success', 'No new traits');
      }

      await trace.endTrace('success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('extractAndSavePreferences failed', { userId, error: msg });
      trace.endSpan(span.id, 'error', msg);
      await trace.endTrace('error');
    }
  }

  /**
   * Returns a formatted string of known user traits for RAG/system-prompt injection.
   */
  static async getUserProfile(userId: string): Promise<string> {
    if (!userId || ANON_IDS.has(userId)) return '';

    try {
      const prefs  = await NexusDB.get('user_preferences', userId);
      const traits = prefs?.traits as string[] | undefined;

      if (traits && traits.length > 0) {
        return (
          '\n\n### KNOWN USER PREFERENCES\n' +
          traits.map((t) => `- ${t}`).join('\n') +
          '\n'
        );
      }
    } catch (e) {
      log.warn('getUserProfile failed', { userId, error: String(e) });
    }
    return '';
  }
}
