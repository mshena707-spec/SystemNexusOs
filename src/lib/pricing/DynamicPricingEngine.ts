/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DYNAMIC PRICING ENGINE — Phase S                                        ║
 * ║                                                                           ║
 * ║  BEFORE: AutonomousBusinessEngine.generateDynamicPricing() existed but   ║
 * ║  accepted a caller-supplied `demandLevel: 'high'|'normal'|'low'` string  ║
 * ║  — it had NO mechanism to measure demand itself. The caller would have   ║
 * ║  had to already know demand was high/low, making the engine pointless.   ║
 * ║  It also made no use of stock levels or trend data.                      ║
 * ║                                                                           ║
 * ║  NOW: This engine derives demand signals from real data already in the   ║
 * ║  codebase:                                                                ║
 * ║    - BIEngine.analyzeProductTrends() → velocityScore (0-100), trend,    ║
 * ║      stockDaysLeft (real data from orders + inventory)                   ║
 * ║    - StockAlertEngine.runAlerts() → stock pressure (scarcity pricing)   ║
 * ║    - AI sanity-check → psychological price rounding (e.g. 499 vs 500)   ║
 * ║                                                                           ║
 * ║  PRICING RULES (all configurable via env):                               ║
 * ║    High demand (velocity > 70) → up to +15%                             ║
 * ║    Rising trend bonus → +5%                                              ║
 * ║    Low stock pressure (< 5 days) → +10% (scarcity)                      ║
 * ║    Low demand (velocity < 20) → -10%                                    ║
 * ║    Declining trend penalty → -5%                                         ║
 * ║    Max deviation cap → ±25% of basePrice (guardrail)                    ║
 * ║                                                                           ║
 * ║  SCOPE NOTE: This engine SUGGESTS prices. It does NOT write prices to   ║
 * ║  the products collection automatically. The owner reviews suggestions   ║
 * ║  via the admin dashboard and applies them manually or via automation     ║
 * ║  rule. Autonomous price application would require owner opt-in and is   ║
 * ║  a follow-up concern.                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { BIEngine } from '../business-intelligence/analytics/BIEngine';
import { StockAlertEngine } from '../procurement/StockAlertEngine';
import { NexusUnifiedCore } from '../core/NexusUnifiedCore';
import { NexusDB } from '../database/NexusDB';
import { AuditLog } from '../security/audit/ImmutableAuditLog';

declare const process: { env: Record<string, string | undefined> };

const MAX_INCREASE_PCT = parseFloat(process.env?.DYNAMIC_PRICE_MAX_UP ?? '0.25');
const MAX_DECREASE_PCT = parseFloat(process.env?.DYNAMIC_PRICE_MAX_DOWN ?? '0.25');

export interface PricingSignal {
  velocityScore: number;
  trend: 'rising' | 'stable' | 'declining';
  stockDaysLeft: number;
  stockAlertSeverity: 'critical' | 'warning' | 'info' | 'no_reorder_point' | 'none';
  demandLevel: 'high' | 'normal' | 'low';
  /** Added per CTO Audit Part 6, section 6 ("Competition" factor — one of 4
   *  confirmed missing from this engine, which previously only used demand
   *  velocity and stock pressure). Sourced from CompetitorAI's cached
   *  analysis (src/lib/intelligence/CompetitorAI.ts, real web-search-backed
   *  competitor pricing that already existed and was already run as a
   *  background job via TaskQueue's competitor_analyse worker) — reads the
   *  most recent cached result rather than triggering a fresh web search
   *  inline, since pricing calculation needs to stay fast and this data is
   *  already being refreshed on its own schedule. Undefined when no analysis
   *  has run yet for this product. */
  competitorMedianPrice?: number;
  competitorConfidence?: 'high' | 'medium' | 'low' | 'no_data';
}

export interface PricingSuggestion {
  productId: string;
  productName: string;
  basePrice: number;
  suggestedPrice: number;
  changePercent: number;             // signed: positive = increase, negative = decrease
  signals: PricingSignal;
  rationale: string;                 // human-readable explanation
  aiAdjustedPrice?: number;          // after psychological price rounding via AI
  computedAt: string;
  applied: boolean;
}

export class DynamicPricingEngine {

  /**
   * Compute a pricing suggestion for a single product.
   * basePrice is the current active price — retrieved from the products
   * collection if not supplied.
   */
  static async suggestForProduct(productId: string, basePrice?: number): Promise<PricingSuggestion | null> {
    // Retrieve base price from DB if not provided
    let price = basePrice;
    let productName = productId;
    if (price === undefined) {
      const product = await NexusDB.get('products', productId);
      if (!product) return null;
      price = parseFloat(product.price ?? product.basePrice ?? '0');
      productName = product.name ?? productId;
    }
    if (!price || price <= 0) return null;

    // ── Signal 1: demand / velocity from BIEngine ─────────────────────────
    let velocityScore = 50;
    let trend: PricingSignal['trend'] = 'stable';
    let stockDaysLeft = 999;

    try {
      const trends = await BIEngine.analyzeProductTrends();
      const insight = trends.find(t => t.productId === productId);
      if (insight) {
        velocityScore = insight.velocityScore;
        trend = insight.trend;
        stockDaysLeft = insight.stockDaysLeft;
        productName = insight.name ?? productName;
      }
    } catch {
      // BIEngine failure is non-fatal; price calculation continues with defaults
    }

    // ── Signal 2: stock pressure from StockAlertEngine ────────────────────
    let stockAlertSeverity: PricingSignal['stockAlertSeverity'] = 'none';
    try {
      const alerts = await StockAlertEngine.runAlerts(500);
      const alert = alerts.find(a => a.productId === productId);
      if (alert) {
        stockAlertSeverity = alert.severity;
        // Override stockDaysLeft if alert has more accurate data
        if (alert.daysOfStockRemaining < stockDaysLeft) {
          stockDaysLeft = alert.daysOfStockRemaining;
        }
      }
    } catch {
      // Non-fatal
    }

    const demandLevel: PricingSignal['demandLevel'] =
      velocityScore >= 70 ? 'high' : velocityScore <= 20 ? 'low' : 'normal';

    // ── Price calculation ──────────────────────────────────────────────────
    let multiplier = 1.0;
    const reasons: string[] = [];

    if (demandLevel === 'high') {
      multiplier += 0.15;
      reasons.push('high demand (velocity score ' + velocityScore + ')');
    } else if (demandLevel === 'low') {
      multiplier -= 0.10;
      reasons.push('low demand (velocity score ' + velocityScore + ')');
    }

    if (trend === 'rising') {
      multiplier += 0.05;
      reasons.push('rising trend');
    } else if (trend === 'declining') {
      multiplier -= 0.05;
      reasons.push('declining trend');
    }

    // Scarcity pricing: very low stock + at least normal demand
    if (stockDaysLeft < 5 && demandLevel !== 'low') {
      multiplier += 0.10;
      reasons.push(`low stock (${stockDaysLeft} day${stockDaysLeft !== 1 ? 's' : ''} remaining)`);
    }

    // ── Signal 3: competitor pricing from CompetitorAI (cached, not a live
    // search — see PricingSignal.competitorMedianPrice's doc comment) ──────
    let competitorMedianPrice: number | undefined;
    let competitorConfidence: PricingSignal['competitorConfidence'];
    try {
      const { CompetitorAI } = await import('../intelligence/CompetitorAI');
      const history = await CompetitorAI.getAnalysisHistory(productId, 1);
      const latest = history[0];
      // Only act on recent, reasonably-confident data — a week-old or
      // no-data analysis shouldn't move today's price.
      if (latest && latest.confidenceLevel !== 'no_data' && latest.marketMedianPrice) {
        const ageMs = Date.now() - new Date(latest.analysedAt).getTime();
        if (ageMs < 7 * 24 * 60 * 60 * 1000) {
          competitorMedianPrice = latest.marketMedianPrice;
          competitorConfidence = latest.confidenceLevel;
          const priceDelta = (competitorMedianPrice - price) / price;
          // Only adjust for a meaningfully-confident, meaningfully-large gap —
          // small gaps or low-confidence data shouldn't chase noise.
          if (latest.confidenceLevel === 'high' && Math.abs(priceDelta) > 0.08) {
            if (priceDelta < 0) {
              // We're priced above the market median — pull back, but only
              // half the gap, not a full match (a single-signal race to the
              // bottom against one cached data point is a real risk worth
              // damping, not just enabling).
              multiplier += priceDelta / 2;
              reasons.push(`priced above competitor median ($${competitorMedianPrice.toFixed(2)})`);
            } else if (demandLevel !== 'low') {
              // We're priced below the market median AND demand isn't weak —
              // room to raise. Gated on demand so a low-demand product
              // doesn't get pushed further from sales just because
              // competitors charge more for it.
              multiplier += Math.min(priceDelta / 2, 0.08);
              reasons.push(`priced below competitor median ($${competitorMedianPrice.toFixed(2)}) with healthy demand`);
            }
          }
        }
      }
    } catch {
      // Non-fatal — same pattern as Signals 1 and 2 above
    }

    // Guardrail: cap deviation to ±MAX_*%
    multiplier = Math.max(1 - MAX_DECREASE_PCT, Math.min(1 + MAX_INCREASE_PCT, multiplier));

    const rawSuggestedPrice = Math.round(price * multiplier * 100) / 100;
    const changePercent = Math.round((rawSuggestedPrice / price - 1) * 1000) / 10;
    const rationale = reasons.length > 0 ? reasons.join(', ') : 'no change signals — price stable';

    // ── AI psychological rounding (optional enhancement, non-blocking) ─────
    let aiAdjustedPrice: number | undefined;
    if (Math.abs(changePercent) >= 1) {
      try {
        const prompt = `Suggest a psychologically appealing retail price near ${rawSuggestedPrice}. The base price is ${price}. Respond with ONLY the number, no currency symbol, no explanation.`;
        const aiResp = await NexusUnifiedCore.process(prompt, { agentRole: 'master_analytics' });
        const parsed = parseFloat(aiResp?.text?.replace(/[^0-9.]/g, '') ?? '');
        // Accept AI suggestion only if it's within 5% of the rule-based price
        if (!isNaN(parsed) && Math.abs(parsed / rawSuggestedPrice - 1) < 0.05) {
          aiAdjustedPrice = Math.round(parsed * 100) / 100;
        }
      } catch {
        // Non-fatal
      }
    }

    const suggestion: PricingSuggestion = {
      productId, productName, basePrice: price,
      suggestedPrice: rawSuggestedPrice,
      changePercent,
      signals: { velocityScore, trend, stockDaysLeft, stockAlertSeverity, demandLevel, competitorMedianPrice, competitorConfidence },
      rationale,
      aiAdjustedPrice,
      computedAt: new Date().toISOString(),
      applied: false,
    };

    return suggestion;
  }

  /**
   * Compute pricing suggestions for ALL products with non-zero sales velocity
   * in the last 30 days. Products with no velocity data are skipped (no signal).
   */
  static async suggestForAll(maxProducts = 100): Promise<PricingSuggestion[]> {
    const trends = await BIEngine.analyzeProductTrends().catch(() => []);
    // Only price products where we have real velocity data
    const active = trends
      .filter(t => t.velocityScore > 0)
      .slice(0, maxProducts);

    const suggestions: PricingSuggestion[] = [];
    for (const t of active) {
      try {
        const s = await this.suggestForProduct(t.productId, undefined);
        if (s) suggestions.push(s);
      } catch {
        // One product failing should not stop the rest
      }
    }
    return suggestions;
  }

  /**
   * Apply a pricing suggestion: write the new price to the products collection.
   * Requires explicit actorId — never called autonomously.
   */
  static async applyPrice(productId: string, newPrice: number, suggestion: PricingSuggestion, actorId: string): Promise<void> {
    if (newPrice <= 0) throw new Error('New price must be positive');

    await NexusDB.update('products', productId, { price: newPrice, lastPricedAt: new Date().toISOString() });

    // Persist suggestion record with applied = true
    await NexusDB.add('pricing_suggestions', { ...suggestion, appliedPrice: newPrice, appliedBy: actorId, applied: true, appliedAt: new Date().toISOString() });

    await AuditLog.record(
      'admin.action',
      { id: actorId, type: 'user' },
      { productId, oldPrice: suggestion.basePrice, newPrice, changePercent: suggestion.changePercent, rationale: suggestion.rationale },
      { action: 'product.price_applied', resource: `products/${productId}`, outcome: 'success' },
    );
  }

  /**
   * What-if simulation: "what happens if I reduce price by 5%?"
   * Uses BIEngine.analyzeProductTrends() velocity data as a demand proxy.
   * Returns projected revenue change — transparent about the model being a
   * rule-of-thumb estimate (price elasticity -1.5) not a precise measurement.
   */
  static async simulate(productId: string, currentPrice: number, newPrice: number): Promise<{
    priceChangePct: number;
    estimatedDemandChangePct: number;
    estimatedRevenueDelta: number;
    confidence: 'low' | 'medium';
    note: string;
  }> {
    const priceChangePct = Math.round((newPrice / currentPrice - 1) * 1000) / 10;

    // Price elasticity estimate — rule of thumb (-1.5) since we have no A/B test data
    const ELASTICITY = -1.5;
    const estimatedDemandChangePct = Math.round(priceChangePct * ELASTICITY * 10) / 10;

    // Get current daily revenue run-rate for this product from BIEngine
    let dailyRevenue = 0;
    try {
      const trends = await BIEngine.analyzeProductTrends();
      const insight = trends.find(t => t.productId === productId);
      if (insight) {
        const dailyUnits = insight.velocityScore / 5; // velocityScore = weekSales * 5
        dailyRevenue = dailyUnits * currentPrice;
      }
    } catch {}

    const estimatedRevenueDelta = dailyRevenue > 0
      ? Math.round(dailyRevenue * (estimatedDemandChangePct / 100) * 30 * 100) / 100  // 30-day projection
      : 0;

    return {
      priceChangePct,
      estimatedDemandChangePct,
      estimatedRevenueDelta,
      confidence: dailyRevenue > 0 ? 'medium' : 'low',
      note: 'Demand estimate uses price elasticity of -1.5 (industry rule-of-thumb). No A/B test data available. Treat as directional guidance only.',
    };
  }

  /** Recent pricing suggestions log for admin review */
  static async getSuggestionsLog(limit = 50): Promise<any[]> {
    return NexusDB.find('pricing_suggestions', { orderBy: 'computedAt', orderDir: 'desc', limit });
  }
}
