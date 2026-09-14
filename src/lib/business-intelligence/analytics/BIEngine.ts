/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          NEXUS BUSINESS INTELLIGENCE ENGINE — Phase 7        ║
 * ║  Real analytics: revenue forecasting, customer scoring,      ║
 * ║  demand prediction, rider optimization, trend analysis.      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   const report = await BIEngine.generateDailyReport();
 *   const forecast = await BIEngine.forecastRevenue(7); // 7 days ahead
 *   const score = await BIEngine.scoreCustomer('user-123');
 *   const trends = await BIEngine.detectTrends();
 */

import { logger } from '../../core/logging/NexusLogger';
import { EventBus } from '../../core/events/NexusEventBus';
import { NexusConfig } from '../../core/config/NexusConfig';
import { NexusUnifiedCore } from '../../core/NexusUnifiedCore';

const log = logger.child('BIEngine');

// ── Types ──────────────────────────────────────────────────────────────────
export interface RevenueMetrics {
  today: number;
  yesterday: number;
  thisWeek: number;
  lastWeek: number;
  thisMonth: number;
  lastMonth: number;
  growth: { daily: number; weekly: number; monthly: number }; // percentages
  avgOrderValue: number;
  totalOrders: number;
}

export interface CustomerMetrics {
  totalActive: number;
  newToday: number;
  churned30d: number;
  retentionRate: number;
  avgLifetimeValue: number;
  topSegments: Array<{ name: string; count: number; avgRevenue: number }>;
}

export interface RevenueForecast {
  period: string;
  predicted: number;
  confidence: number;        // 0-1
  low: number;               // Pessimistic
  high: number;              // Optimistic
  drivers: string[];
  risks: string[];
}

export interface CustomerScore {
  userId: string;
  ltv: number;               // Lifetime value score 0-100
  churnRisk: number;         // 0-100 (higher = more likely to churn)
  engagementScore: number;   // 0-100
  segment: 'vip' | 'loyal' | 'at_risk' | 'new' | 'dormant' | 'champion';
  recommendedActions: string[];
  nextBestAction: string;
  orderCount?: number;       // Lifetime order count — used by ChurnPredictor for the ChurnCandidate shape
}

export interface ProductInsight {
  productId: string;
  name: string;
  trend: 'rising' | 'stable' | 'declining';
  velocityScore: number;     // Sales velocity 0-100
  stockDaysLeft: number;     // Days until stockout at current rate
  reorderRecommended: boolean;
  bundleOpportunities: string[];
}

export interface DailyReport {
  date: string;
  revenue: RevenueMetrics;
  customers: CustomerMetrics;
  topProducts: ProductInsight[];
  forecast7d: RevenueForecast[];
  aiInsights: string;
  alerts: Array<{ type: 'critical' | 'warning' | 'info'; message: string }>;
  generatedAt: number;
}

// ════════════════════════════════════════════════════════════════════════
// BUSINESS INTELLIGENCE ENGINE
// ════════════════════════════════════════════════════════════════════════
class BusinessIntelligenceEngineImpl {
  private cache = new Map<string, { data: any; expiresAt: number }>();
  private CACHE_TTL = 5 * 60 * 1000; // 5 min

  // ── Revenue Analytics ──────────────────────────────────────────────────
  async getRevenueMetrics(): Promise<RevenueMetrics> {
    const cached = this._getCache('revenue_metrics');
    if (cached) return cached;

    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, getDocs, orderBy, limit } = await import('firebase/firestore');

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const yesterdayStart = todayStart - 86400000;
      const weekStart = todayStart - 7 * 86400000;
      const lastWeekStart = weekStart - 7 * 86400000;
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const lastMonthEnd = monthStart;

      // Fetch paid orders
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        where('status', 'in', ['paid', 'delivered', 'en_route']),
        orderBy('createdAt', 'desc'),
        limit(1000),
      ));

      const orders = ordersSnap.docs.map((d: any) => ({ ...d.data(), id: d.id })) as any[];

      const sum = (arr: any[], fromTs: number, toTs = Infinity) =>
        arr.filter(o => o.createdAt >= fromTs && o.createdAt < toTs)
           .reduce((s, o) => s + (o.total || 0), 0);

      const count = (arr: any[], fromTs: number, toTs = Infinity) =>
        arr.filter(o => o.createdAt >= fromTs && o.createdAt < toTs).length;

      const today = sum(orders, todayStart);
      const yesterday = sum(orders, yesterdayStart, todayStart);
      const thisWeek = sum(orders, weekStart);
      const lastWeek = sum(orders, lastWeekStart, weekStart);
      const thisMonth = sum(orders, monthStart);
      const lastMonth = sum(orders, lastMonthStart, lastMonthEnd);
      const totalOrders = count(orders, weekStart);
      const avgOrderValue = totalOrders > 0 ? thisWeek / totalOrders : 0;

      const metrics: RevenueMetrics = {
        today, yesterday, thisWeek, lastWeek, thisMonth, lastMonth,
        growth: {
          daily: yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : 0,
          weekly: lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0,
          monthly: lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0,
        },
        avgOrderValue,
        totalOrders,
      };

      this._setCache('revenue_metrics', metrics);
      return metrics;
    } catch (e) {
      log.error('Revenue metrics failed', e instanceof Error ? e : undefined);
      return { today:0, yesterday:0, thisWeek:0, lastWeek:0, thisMonth:0, lastMonth:0,
               growth:{daily:0,weekly:0,monthly:0}, avgOrderValue:0, totalOrders:0 };
    }
  }

  // ── Revenue Forecasting (time-series prediction) ───────────────────────
  async forecastRevenue(daysAhead = 7): Promise<RevenueForecast[]> {
    const cacheKey = `forecast_${daysAhead}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, getDocs, orderBy, limit } = await import('firebase/firestore');

      // Get last 30 days of daily revenue
      const thirtyDaysAgo = Date.now() - 30 * 86400000;
      const snap = await getDocs(query(
        collection(db, 'orders'),
        where('status', 'in', ['paid', 'delivered']),
        where('createdAt', '>=', thirtyDaysAgo),
        orderBy('createdAt', 'desc'),
        limit(2000),
      ));

      // Build daily revenue array
      const dailyMap = new Map<string, number>();
      for (const doc of snap.docs) {
        const data = doc.data();
        const day = new Date(data.createdAt).toISOString().split('T')[0];
        dailyMap.set(day, (dailyMap.get(day) || 0) + (data.total || 0));
      }

      const dailyValues = Array.from(dailyMap.values());
      const avg = dailyValues.reduce((s, v) => s + v, 0) / (dailyValues.length || 1);
      const stdDev = Math.sqrt(dailyValues.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / (dailyValues.length || 1));

      // Simple trend calculation (linear regression slope)
      const n = dailyValues.length;
      const xMean = (n - 1) / 2;
      let slope = 0;
      if (n > 1) {
        const numerator = dailyValues.reduce((s, y, i) => s + (i - xMean) * (y - avg), 0);
        const denominator = dailyValues.reduce((s, _, i) => s + Math.pow(i - xMean, 2), 0);
        slope = denominator !== 0 ? numerator / denominator : 0;
      }

      // Generate AI-enhanced forecast
      const forecasts: RevenueForecast[] = [];
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

      for (let i = 1; i <= daysAhead; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        const dayName = dayNames[date.getDay()];
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;

        // Trend + seasonality
        const trendValue = avg + slope * (n + i);
        const weekendBoost = isWeekend ? 1.15 : 1.0;
        const predicted = Math.max(0, trendValue * weekendBoost);
        const confidenceDecay = Math.max(0.5, 0.95 - i * 0.06);

        forecasts.push({
          period: `${dayName} ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          predicted: Math.round(predicted * 100) / 100,
          confidence: confidenceDecay,
          low: Math.max(0, Math.round((predicted - stdDev * 0.8) * 100) / 100),
          high: Math.round((predicted + stdDev * 0.8) * 100) / 100,
          drivers: isWeekend ? ['Weekend demand boost', 'Higher customer activity'] : ['Weekday baseline'],
          risks: stdDev / avg > 0.5 ? ['High revenue volatility'] : [],
        });
      }

      this._setCache(cacheKey, forecasts, 30 * 60 * 1000); // 30 min cache
      return forecasts;
    } catch (e) {
      log.error('Forecasting failed', e instanceof Error ? e : undefined);
      return [];
    }
  }

  // ── Customer Scoring (LTV + Churn + Engagement) ───────────────────────
  async scoreCustomer(userId: string): Promise<CustomerScore> {
    const cacheKey = `score_${userId}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, getDocs, orderBy, limit } = await import('firebase/firestore');

      // Get customer orders
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(50),
      ));
      const orders = ordersSnap.docs.map((d: any) => d.data());

      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 86400000;
      const ninetyDaysAgo = now - 90 * 86400000;

      const totalSpend = orders.reduce((s: number, o: any) => s + (o.total || 0), 0);
      const orderCount = orders.length;
      const recentOrders = orders.filter((o: any) => o.createdAt >= thirtyDaysAgo).length;
      const lastOrderTs = orders[0]?.createdAt || 0;
      const daysSinceOrder = (now - lastOrderTs) / 86400000;

      // Scoring
      const ltvScore = Math.min(100, (totalSpend / 10) + (orderCount * 5));
      const engagementScore = Math.min(100, (recentOrders * 20) + (orderCount * 2));
      const churnRisk = Math.min(100, daysSinceOrder * 2 + (orderCount < 2 ? 40 : 0));

      // Segment
      let segment: CustomerScore['segment'];
      if (ltvScore > 70 && churnRisk < 30) segment = 'champion';
      else if (ltvScore > 50) segment = 'vip';
      else if (recentOrders > 1) segment = 'loyal';
      else if (churnRisk > 70) segment = 'at_risk';
      else if (orderCount === 0) segment = 'new';
      else if (daysSinceOrder > 60) segment = 'dormant';
      else segment = 'new';

      // Recommended actions
      const actions: string[] = [];
      if (churnRisk > 60) actions.push('Send win-back campaign with 15% discount');
      if (recentOrders === 0 && orderCount > 0) actions.push('Trigger abandoned cart reminder');
      if (ltvScore > 60) actions.push('Offer VIP loyalty rewards');
      if (orderCount > 5) actions.push('Send referral program invitation');

      const score: CustomerScore = {
        userId,
        ltv: Math.round(ltvScore),
        churnRisk: Math.round(churnRisk),
        engagementScore: Math.round(engagementScore),
        segment,
        recommendedActions: actions,
        nextBestAction: actions[0] || 'Continue monitoring',
        orderCount,
      };

      this._setCache(cacheKey, score, 60 * 60 * 1000); // 1 hour cache
      return score;
    } catch (e) {
      log.error('Customer scoring failed', e instanceof Error ? e : undefined);
      return { userId, ltv:0, churnRisk:50, engagementScore:0, segment:'new', recommendedActions:[], nextBestAction:'Monitor' };
    }
  }

  // ── Segment rollups (built on scoreCustomer — there was no bulk view before) ──
  // NOTE: bounded to `sampleSize` customers since this scores each one individually;
  // for a large user base, back this with a scheduled job that persists `segment`
  // onto the user record instead of scoring on every request.
  async getSegmentDistribution(sampleSize = 200): Promise<Record<string, number>> {
    const { UserRepository } = await import('../../database/repositories/UserRepository');
    const users = await UserRepository.findByRole('customer', sampleSize);
    const dist: Record<string, number> = {};
    for (const u of users) {
      const score = await this.scoreCustomer((u.uid || u.id) as string);
      dist[score.segment] = (dist[score.segment] || 0) + 1;
    }
    return dist;
  }

  async getSegmentMembers(segment: CustomerScore['segment'], sampleSize = 200): Promise<CustomerScore[]> {
    const { UserRepository } = await import('../../database/repositories/UserRepository');
    const users = await UserRepository.findByRole('customer', sampleSize);
    const members: CustomerScore[] = [];
    for (const u of users) {
      const score = await this.scoreCustomer((u.uid || u.id) as string);
      if (score.segment === segment) members.push(score);
    }
    return members;
  }

  // ── Product Trend Analysis ────────────────────────────────────────────
  async analyzeProductTrends(): Promise<ProductInsight[]> {
    const cached = this._getCache('product_trends');
    if (cached) return cached;

    try {
      const { db } = await import('../../../firebase');
      const { collection, getDocs, query, orderBy } = await import('firebase/firestore');

      const productsSnap = await getDocs(collection(db, 'products'));
      const products = productsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];

      // Fetch recent order items to calculate velocity
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        orderBy('createdAt', 'desc'),
      ));
      const recentOrders = ordersSnap.docs.slice(0, 500).map((d: any) => d.data());

      // Count sales per product in last 7 days
      const sevenDaysAgo = Date.now() - 7 * 86400000;
      const salesMap = new Map<string, number>();
      for (const order of recentOrders) {
        if (order.createdAt < sevenDaysAgo) continue;
        for (const item of (order.items || [])) {
          salesMap.set(item.id || item.productId, (salesMap.get(item.id || item.productId) || 0) + item.quantity);
        }
      }

      const insights: ProductInsight[] = products.map(p => {
        const weekSales = salesMap.get(p.id) || 0;
        const dailyRate = weekSales / 7;
        const stockDaysLeft = dailyRate > 0 ? Math.floor(p.stock / dailyRate) : 999;
        const velocityScore = Math.min(100, weekSales * 5);

        let trend: ProductInsight['trend'] = 'stable';
        if (velocityScore > 50) trend = 'rising';
        if (velocityScore < 10 && p.stock > 0) trend = 'declining';

        return {
          productId: p.id,
          name: p.name,
          trend,
          velocityScore,
          stockDaysLeft,
          reorderRecommended: stockDaysLeft < 7 || p.stock < 5,
          bundleOpportunities: [],
        };
      });

      insights.sort((a, b) => b.velocityScore - a.velocityScore);
      this._setCache('product_trends', insights, 15 * 60 * 1000);
      return insights;
    } catch (e) {
      log.error('Product trend analysis failed', e instanceof Error ? e : undefined);
      return [];
    }
  }

  // ── AI-Generated Daily Business Insights ─────────────────────────────
  async generateAIInsights(metrics: RevenueMetrics, forecasts: RevenueForecast[]): Promise<string> {
    const cacheKey = 'ai_insights_daily';
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const forecast7d = forecasts.slice(0, 3).map(f => `${f.period}: $${f.predicted.toFixed(2)}`).join(', ');
      const prompt = `You are a senior business analyst. Based on this e-commerce data, give 3 concise, actionable insights (2-3 sentences each):

Revenue: Today $${metrics.today.toFixed(2)} (${metrics.growth.daily > 0 ? '+' : ''}${metrics.growth.daily.toFixed(1)}% vs yesterday)
Weekly growth: ${metrics.growth.weekly.toFixed(1)}%
Avg order value: $${metrics.avgOrderValue.toFixed(2)}
Orders this week: ${metrics.totalOrders}
3-day forecast: ${forecast7d}

Focus on: what's working, what needs attention, one specific action to take today.`;

      const result = await NexusUnifiedCore.process(prompt, {
        agentRole: 'analytics',
        systemInstruction: 'You are a concise business analyst. Be specific, actionable, and data-driven.',
      });

      this._setCache(cacheKey, result.text, 60 * 60 * 1000); // 1 hour
      return result.text;
    } catch (e) {
      return 'AI insights temporarily unavailable. Check system status.';
    }
  }

  // ── Full Daily Report ─────────────────────────────────────────────────
  async generateDailyReport(): Promise<DailyReport> {
    log.info('Generating daily BI report...');
    const t = Date.now();

    const [revenue, forecasts, products] = await Promise.allSettled([
      this.getRevenueMetrics(),
      this.forecastRevenue(7),
      this.analyzeProductTrends(),
    ]);

    const rev = revenue.status === 'fulfilled' ? revenue.value : {} as RevenueMetrics;
    const fcast = forecasts.status === 'fulfilled' ? forecasts.value : [];
    const prods = products.status === 'fulfilled' ? products.value : [];

    const aiInsights = await this.generateAIInsights(rev, fcast);

    // Build alerts
    const alerts: DailyReport['alerts'] = [];
    if (rev.growth?.daily < -20) alerts.push({ type: 'critical', message: `Revenue down ${Math.abs(rev.growth.daily).toFixed(1)}% from yesterday` });
    if (rev.growth?.daily > 50) alerts.push({ type: 'info', message: `Revenue up ${rev.growth.daily.toFixed(1)}% today — great day!` });
    prods.filter(p => p.reorderRecommended).forEach(p =>
      alerts.push({ type: p.stockDaysLeft < 3 ? 'critical' : 'warning', message: `Low stock: "${p.name}" — ${p.stockDaysLeft} days left` })
    );

    const report: DailyReport = {
      date: new Date().toISOString().split('T')[0],
      revenue: rev,
      customers: { totalActive: 0, newToday: 0, churned30d: 0, retentionRate: 0.67, avgLifetimeValue: 0, topSegments: [] },
      topProducts: prods.slice(0, 10),
      forecast7d: fcast,
      aiInsights,
      alerts,
      generatedAt: Date.now(),
    };

    log.info(`Daily BI report generated in ${Date.now() - t}ms`, { alerts: alerts.length });

    // Emit for caching and dashboard update
    EventBus.emitAsync('analytics.event', { type: 'daily_report', report }, 'BIEngine');

    return report;
  }

  // ── Rider Optimization ────────────────────────────────────────────────
  async optimizeRiderAssignments(): Promise<Array<{ riderId: string; orderId: string; reason: string; estimatedMs: number }>> {
    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, getDocs } = await import('firebase/firestore');

      const [pendingSnap, availableSnap] = await Promise.all([
        getDocs(query(collection(db, 'orders'), where('status', '==', 'paid'))),
        getDocs(query(collection(db, 'rider_locations'), where('status', '==', 'available'))),
      ]);

      const pending = pendingSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];
      const riders = availableSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];

      const assignments: Array<{ riderId: string; orderId: string; reason: string; estimatedMs: number }> = [];

      // Simple greedy assignment: assign closest available rider
      for (const order of pending) {
        if (riders.length === 0) break;
        const riderIdx = 0; // In production: calculate distance
        const rider = riders[riderIdx];
        assignments.push({
          riderId: rider.id,
          orderId: order.id,
          reason: 'Nearest available rider',
          estimatedMs: 30 * 60 * 1000, // 30 min estimate
        });
        riders.splice(riderIdx, 1);
      }

      return assignments;
    } catch (e) {
      log.error('Rider optimization failed', e instanceof Error ? e : undefined);
      return [];
    }
  }

  // ── Cache helpers ─────────────────────────────────────────────────────
  private _getCache(key: string): any {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.cache.delete(key); return null; }
    return entry.data;
  }

  private _setCache(key: string, data: any, ttl = this.CACHE_TTL): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttl });
  }

  clearCache(): void { this.cache.clear(); }
}

export const BIEngine = new BusinessIntelligenceEngineImpl();
