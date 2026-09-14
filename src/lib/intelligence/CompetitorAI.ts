import { SecretVault } from '../security/vault/SecretVault';
/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  COMPETITOR INTELLIGENCE ENGINE — Phase X (rebuild)                      ║
 * ║                                                                           ║
 * ║  BEFORE: Pure AI hallucination — prompt said "based on average online    ║
 * ║  competitors" but no competitor data was ever fetched. The AI invented   ║
 * ║  a price from thin air.                                                  ║
 * ║                                                                           ║
 * ║  AFTER: Two-step real process:                                           ║
 * ║  1. Web search via SerpAPI/Google Custom Search (if key configured)      ║
 * ║     — searches for "{productName} price Bangladesh" or similar           ║
 * ║     — extracts price mentions from snippets                              ║
 * ║  2. AI synthesis — fed REAL search snippets, asked to extract prices    ║
 * ║     and provide recommendation. Not asked to invent.                    ║
 * ║                                                                           ║
 * ║  FALLBACK (no search key): AI analysis with explicit prompt caveat      ║
 * ║  "you have no current market data — acknowledge this in your response". ║
 * ║  Transparent, not fake-confident.                                        ║
 * ║                                                                           ║
 * ║  ENV VARS:                                                               ║
 * ║    SERPAPI_KEY           — SerpAPI key for Google search results         ║
 * ║    GOOGLE_CSE_KEY        — Google Custom Search API key (alternative)    ║
 * ║    GOOGLE_CSE_CX         — Custom Search Engine ID                       ║
 * ║    COMPETITOR_SEARCH_LOCALE — default 'Bangladesh' (appended to query)  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { NexusUnifiedCore } from '../core/NexusUnifiedCore';
import { NexusDB } from '../database/NexusDB';
import { AuditLog } from '../security/audit/ImmutableAuditLog';

declare const process: { env: Record<string, string | undefined> };

export interface CompetitorPricePoint {
  source: string;       // domain or snippet origin
  priceText: string;    // raw price string from snippet
  parsedPrice: number | null;
}

export interface CompetitorAnalysis {
  productName: string;
  currentPrice: number;
  searchPerformed: boolean;
  searchLocale: string;
  pricePoints: CompetitorPricePoint[];
  marketMedianPrice: number | null;
  recommendation: string;
  suggestedPrice: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'no_data';
  analysedAt: string;
}

// ── Web search ─────────────────────────────────────────────────────────────
async function searchCompetitorPrices(
  productName: string,
  locale: string,
): Promise<{ snippets: string[]; sources: string[] }> {
  const query = encodeURIComponent(`${productName} price ${locale}`);

  // Try SerpAPI
  const serpKey = SecretVault.get('SERPAPI_KEY', { caller: 'system', module: 'CompetitorAI' });
  if (serpKey) {
    try {
      const url = `https://serpapi.com/search.json?q=${query}&gl=bd&hl=en&api_key=${serpKey}&num=10`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const results: any[] = data.organic_results ?? [];
        return {
          snippets: results.map((r: any) => r.snippet ?? '').filter(Boolean).slice(0, 8),
          sources: results.map((r: any) => r.displayed_link ?? r.link ?? '').slice(0, 8),
        };
      }
    } catch { /* fall through */ }
  }

  // Try Google Custom Search API
  const cseKey = SecretVault.get('GOOGLE_CSE_KEY', { caller: 'system', module: 'CompetitorAI' });
  const cseCx = process.env.GOOGLE_CSE_CX;
  if (cseKey && cseCx) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?q=${query}&key=${cseKey}&cx=${cseCx}&num=10`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const items: any[] = data.items ?? [];
        return {
          snippets: items.map((i: any) => i.snippet ?? '').filter(Boolean).slice(0, 8),
          sources: items.map((i: any) => i.displayLink ?? '').slice(0, 8),
        };
      }
    } catch { /* fall through */ }
  }

  return { snippets: [], sources: [] };
}

// Extract numeric prices from text (handles ৳, BDT, $, ₹ etc.)
function extractPrices(text: string): number[] {
  const patterns = [
    /(?:৳|BDT|Tk\.?|taka)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:৳|BDT|Tk\.?|taka)/gi,
    /(?:\$|USD)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /price[:\s]+(?:৳|BDT|\$)?\s*([\d,]+(?:\.\d{1,2})?)/gi,
  ];
  const found: number[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const n = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 1_000_000) found.push(n);
    }
  }
  return [...new Set(found)];
}

export class CompetitorAI {
  /**
   * Analyse competitor pricing for a product using real web search data.
   */
  static async analysePricing(
    productName: string,
    currentPrice: number,
    productId?: string,
  ): Promise<CompetitorAnalysis> {
    const locale = process.env.COMPETITOR_SEARCH_LOCALE ?? 'Bangladesh';
    const { snippets, sources } = await searchCompetitorPrices(productName, locale);
    const searchPerformed = snippets.length > 0;

    // Extract price points from snippets
    const pricePoints: CompetitorPricePoint[] = [];
    const allPrices: number[] = [];
    for (let i = 0; i < snippets.length; i++) {
      const prices = extractPrices(snippets[i]);
      for (const price of prices) {
        pricePoints.push({
          source: sources[i] ?? 'unknown',
          priceText: `${price}`,
          parsedPrice: price,
        });
        allPrices.push(price);
      }
    }

    const marketMedianPrice = allPrices.length > 0
      ? allPrices.sort((a, b) => a - b)[Math.floor(allPrices.length / 2)]
      : null;

    // Build AI prompt with REAL data
    let prompt: string;
    if (searchPerformed && snippets.length > 0) {
      const snippetBlock = snippets.slice(0, 6).map((s, i) => `[${i + 1}] ${sources[i]}: ${s}`).join('\n');
      const priceList = allPrices.length > 0 ? `Extracted prices: ${allPrices.join(', ')}` : 'No prices could be extracted from snippets.';
      prompt = `You are a pricing analyst. A product named "${productName}" is currently priced at ${currentPrice}.

Here are REAL search results for "${productName} price ${locale}":
${snippetBlock}

${priceList}
Median market price (if available): ${marketMedianPrice ?? 'N/A'}

Based ONLY on the real data above (do not invent prices):
1. What is the competitive price range you observe?
2. Should the seller increase, decrease, or maintain the current price of ${currentPrice}?
3. Suggest a specific price.

Respond ONLY in JSON: { "recommendation": "string", "suggestedPrice": number, "confidenceLevel": "high"|"medium"|"low" }`;
    } else {
      prompt = `You are a pricing analyst. A product named "${productName}" is currently priced at ${currentPrice} in ${locale}.

IMPORTANT: You have NO current market data available. Web search returned no results.
Do not invent competitor prices. Acknowledge this limitation in your recommendation.

Respond ONLY in JSON: { "recommendation": "string acknowledging no market data, general advice only", "suggestedPrice": ${currentPrice}, "confidenceLevel": "no_data" }`;
    }

    let recommendation = 'Unable to generate recommendation.';
    let suggestedPrice = currentPrice;
    let confidenceLevel: CompetitorAnalysis['confidenceLevel'] = 'no_data';

    try {
      const res = await NexusUnifiedCore.process(prompt, { agentRole: 'master_analytics' });
      const jsonStr = res.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      recommendation = parsed.recommendation ?? recommendation;
      suggestedPrice = typeof parsed.suggestedPrice === 'number' ? parsed.suggestedPrice : currentPrice;
      confidenceLevel = parsed.confidenceLevel ?? 'low';
    } catch { /* keep defaults */ }

    const analysis: CompetitorAnalysis = {
      productName, currentPrice, searchPerformed, searchLocale: locale,
      pricePoints: pricePoints.slice(0, 20),
      marketMedianPrice, recommendation, suggestedPrice, confidenceLevel,
      analysedAt: new Date().toISOString(),
    };

    // Persist analysis for audit / history
    if (productId) {
      await NexusDB.add('competitor_analyses', { productId, ...analysis });
    }

    await AuditLog.record(
      'admin.action', { id: 'system_competitor_ai', type: 'system' },
      { productName, currentPrice, searchPerformed, pricePointsFound: pricePoints.length, suggestedPrice, confidenceLevel },
      { action: 'competitor.analysed', resource: `products/${productId ?? productName}`, outcome: 'success' },
    );

    return analysis;
  }

  /** Batch analyse multiple products */
  static async analyseAll(products: Array<{ productId: string; name: string; price: number }>) {
    const results: CompetitorAnalysis[] = [];
    for (const p of products) {
      try {
        const analysis = await this.analysePricing(p.name, p.price, p.productId);
        results.push(analysis);
        // Rate-limit: 1 request per 2s to avoid search API quota exhaustion
        await new Promise(r => setTimeout(r, 2000));
      } catch { /* skip individual failures */ }
    }
    return results;
  }

  /** Get history of previous analyses for a product */
  static async getAnalysisHistory(productId: string, limit = 10): Promise<CompetitorAnalysis[]> {
    return NexusDB.find('competitor_analyses', {
      where: [{ field: 'productId', op: '==', value: productId }],
      orderBy: 'analysedAt', orderDir: 'desc', limit,
    }) as unknown as CompetitorAnalysis[];
  }
}
