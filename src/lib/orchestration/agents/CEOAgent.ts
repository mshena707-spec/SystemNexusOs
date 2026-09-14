/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  CEO AGENT — Phase X                                                     ║
 * ║                                                                           ║
 * ║  Synthesizes multiple data engines into a CEO-level daily brief:        ║
 * ║    - BIEngine.generateDailyReport() — revenue, customers, products      ║
 * ║    - DemandForecastingEngine.forecastAll() — 14-day demand outlook       ║
 * ║    - StockAlertEngine.runAlerts() — critical inventory risks             ║
 * ║    - LoyaltyEngine summary — customer loyalty health                     ║
 * ║    - AutomationRuleEngine summary — active rules & last run results      ║
 * ║                                                                           ║
 * ║  Then passes a structured data context to the AI (NexusUnifiedCore)     ║
 * ║  asking for strategic insights. The AI is given REAL numbers — it does  ║
 * ║  not fabricate metrics. The AI's role is interpretation + suggestion,   ║
 * ║  not data generation.                                                    ║
 * ║                                                                           ║
 * ║  Output is persisted in NexusDB `ceo_reports` collection and served     ║
 * ║  via GET /api/admin/ceo/report — same pattern as BIEngine daily report. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { NexusUnifiedCore } from '../../core/NexusUnifiedCore';
import { NexusDB } from '../../database/NexusDB';
import { AuditLog } from '../../security/audit/ImmutableAuditLog';

export interface CEOSection {
  title: string;
  summary: string;
  keyNumbers: Array<{ label: string; value: string; delta?: string; status: 'good' | 'warn' | 'critical' | 'neutral' }>;
}

export interface CEOReport {
  date: string;
  overallHealth: 'excellent' | 'good' | 'warning' | 'critical';
  executiveSummary: string;       // 2-3 sentence AI summary
  sections: CEOSection[];
  topRisks: Array<{ risk: string; severity: 'high' | 'medium' | 'low'; action: string }>;
  growthOpportunities: string[];
  todaysPriorities: string[];     // Top 3 things CEO should do today
  generatedAt: string;
  dataSourcesUsed: string[];
}

export class CEOAgent {

  static async generateDailyBrief(): Promise<CEOReport> {
    const t = Date.now();
    const dataSourcesUsed: string[] = [];
    const sections: CEOSection[] = [];
    const topRisks: CEOReport['topRisks'] = [];

    // ── 1. Revenue & Commerce ─────────────────────────────────────────────
    let revenueSection: CEOSection = { title: 'Revenue & Commerce', summary: '', keyNumbers: [] };
    try {
      const { BIEngine } = await import('../../business-intelligence/analytics/BIEngine');
      const report = await BIEngine.generateDailyReport();
      dataSourcesUsed.push('BIEngine');

      const rev = report.revenue;
      revenueSection = {
        title: 'Revenue & Commerce',
        summary: report.aiInsights || 'No AI insights generated.',
        keyNumbers: [
          { label: 'Revenue Today', value: `$${rev.today?.toFixed(2) ?? '0'}`, delta: rev.growth?.daily != null ? `${rev.growth.daily > 0 ? '+' : ''}${rev.growth.daily.toFixed(1)}%` : undefined, status: (rev.growth?.daily ?? 0) >= 0 ? 'good' : 'warn' },
          { label: 'Revenue This Month', value: `$${rev.thisMonth?.toFixed(2) ?? '0'}`, status: 'neutral' },
          { label: 'Avg Order Value', value: `$${rev.avgOrderValue?.toFixed(2) ?? '0'}`, status: 'neutral' },
          { label: 'Orders Today', value: `${rev.totalOrders ?? 0}`, status: (rev.totalOrders ?? 0) > 0 ? 'good' : 'warn' },
        ],
      };

      if (report.alerts) {
        for (const alert of report.alerts) {
          topRisks.push({
            risk: alert.message,
            severity: alert.type === 'critical' ? 'high' : alert.type === 'warning' ? 'medium' : 'low',
            action: 'Review in BI Dashboard',
          });
        }
      }
    } catch { revenueSection.summary = 'Revenue data unavailable.'; }
    sections.push(revenueSection);

    // ── 2. Inventory & Supply Chain ───────────────────────────────────────
    let inventorySection: CEOSection = { title: 'Inventory & Supply Chain', summary: '', keyNumbers: [] };
    try {
      const { StockAlertEngine } = await import('../../procurement/StockAlertEngine');
      const alerts = await StockAlertEngine.runAlerts(200);
      dataSourcesUsed.push('StockAlertEngine');

      const critical = alerts.filter((a: any) => a.severity === 'critical');
      const warning = alerts.filter((a: any) => a.severity === 'warning');
      inventorySection = {
        title: 'Inventory & Supply Chain',
        summary: critical.length > 0
          ? `CRITICAL: ${critical.length} product(s) have ≤3 days of stock remaining.`
          : warning.length > 0 ? `${warning.length} product(s) need reordering soon.`
          : 'Stock levels are healthy.',
        keyNumbers: [
          { label: 'Critical Stock Alerts', value: `${critical.length}`, status: critical.length > 0 ? 'critical' : 'good' },
          { label: 'Warning Alerts', value: `${warning.length}`, status: warning.length > 3 ? 'warn' : 'neutral' },
          { label: 'Products Monitored', value: `${alerts.length}`, status: 'neutral' },
        ],
      };
      for (const c of critical.slice(0, 3) as any[]) {
        topRisks.push({ risk: `"${c.productName}" has ${c.daysOfStockRemaining} days of stock left`, severity: 'high', action: 'Place reorder immediately' });
      }
    } catch { inventorySection.summary = 'Inventory data unavailable.'; }
    sections.push(inventorySection);

    // ── 3. Demand Forecast ────────────────────────────────────────────────
    let forecastSection: CEOSection = { title: '14-Day Demand Forecast', summary: '', keyNumbers: [] };
    try {
      const { DemandForecastingEngine } = await import('../../business-intelligence/forecasting/DemandForecastingEngine');
      const summary = await DemandForecastingEngine.forecastAll(14, 30);
      const restockAlerts = await DemandForecastingEngine.getRestockAlerts(14);
      dataSourcesUsed.push('DemandForecastingEngine');

      const risingProducts = summary.products.filter((p: any) => p.trend === 'rising' && p.forecastMethod === 'wma_trend');
      const decliningProducts = summary.products.filter((p: any) => p.trend === 'declining' && p.forecastMethod === 'wma_trend');

      forecastSection = {
        title: '14-Day Demand Forecast',
        summary: `${summary.productsWithData} products forecasted. ${risingProducts.length} rising, ${decliningProducts.length} declining. ${restockAlerts.length} restock alert(s).`,
        keyNumbers: [
          { label: 'Products Forecasted', value: `${summary.productsWithData}`, status: 'neutral' },
          { label: 'Rising Demand', value: `${risingProducts.length} products`, status: risingProducts.length > 0 ? 'good' : 'neutral' },
          { label: 'Declining Demand', value: `${decliningProducts.length} products`, status: decliningProducts.length > 3 ? 'warn' : 'neutral' },
          { label: 'Restock Alerts (14d)', value: `${restockAlerts.length}`, status: restockAlerts.filter((r: any) => r.severity === 'critical').length > 0 ? 'critical' : restockAlerts.length > 0 ? 'warn' : 'good' },
        ],
      };
    } catch { forecastSection.summary = 'Demand forecast unavailable.'; }
    sections.push(forecastSection);

    // ── 4. Customer Loyalty ───────────────────────────────────────────────
    let loyaltySection: CEOSection = { title: 'Customer Loyalty', summary: '', keyNumbers: [] };
    try {
      const loyaltyTxns = await NexusDB.find('loyalty_transactions', {
        where: [{ field: 'createdAt', op: '>=', value: new Date(Date.now() - 7 * 86400000).toISOString() }],
        limit: 5000,
      }) as unknown as Array<{ type: string; points: number; customerId: string }>;
      dataSourcesUsed.push('LoyaltyEngine');

      const earned = loyaltyTxns.filter(t => t.points > 0).reduce((s, t) => s + t.points, 0);
      const redeemed = loyaltyTxns.filter(t => t.points < 0).reduce((s, t) => s + Math.abs(t.points), 0);
      const uniqueCustomers = new Set(loyaltyTxns.map(t => t.customerId)).size;

      loyaltySection = {
        title: 'Customer Loyalty (Last 7 Days)',
        summary: `${uniqueCustomers} customers engaged with loyalty program.`,
        keyNumbers: [
          { label: 'Points Earned', value: `${earned.toLocaleString()} pts`, status: earned > 0 ? 'good' : 'neutral' },
          { label: 'Points Redeemed', value: `${redeemed.toLocaleString()} pts`, status: 'neutral' },
          { label: 'Active Customers', value: `${uniqueCustomers}`, status: uniqueCustomers > 10 ? 'good' : 'warn' },
          { label: 'Redemption Rate', value: earned > 0 ? `${Math.round(redeemed / earned * 100)}%` : '0%', status: 'neutral' },
        ],
      };
    } catch { loyaltySection.summary = 'Loyalty data unavailable.'; }
    sections.push(loyaltySection);

    // ── 5. Active Automation ──────────────────────────────────────────────
    try {
      const { AutomationRuleEngine } = await import('../../automation/AutomationRuleEngine');
      const rules = await AutomationRuleEngine.listRules();
      dataSourcesUsed.push('AutomationRuleEngine');
      const activeRules = rules.filter((r: any) => r.active);
      const lastRunErrors = rules.filter((r: any) => r.lastRunResult?.error).length;
      sections.push({
        title: 'Owner Automation',
        summary: `${activeRules.length} active automation rules. ${lastRunErrors > 0 ? `${lastRunErrors} rule(s) had errors on last run.` : 'All rules running cleanly.'}`,
        keyNumbers: [
          { label: 'Active Rules', value: `${activeRules.length}`, status: 'neutral' },
          { label: 'Rules With Errors', value: `${lastRunErrors}`, status: lastRunErrors > 0 ? 'warn' : 'good' },
        ],
      });
    } catch { /* non-fatal */ }

    // ── AI strategic synthesis ────────────────────────────────────────────
    const sectionsText = sections.map(s =>
      `### ${s.title}\n${s.summary}\nKey metrics: ${s.keyNumbers.map(k => `${k.label}: ${k.value}`).join(', ')}`
    ).join('\n\n');
    const risksText = topRisks.map(r => `- [${r.severity.toUpperCase()}] ${r.risk}`).join('\n') || 'None identified.';

    const aiPrompt = `You are the AI business advisor for an e-commerce company. Here is today's business data:

${sectionsText}

Top risks identified by automated systems:
${risksText}

Based ONLY on the data above, provide:
1. "executiveSummary": 2-3 sentence summary of today's business health
2. "growthOpportunities": array of 2-3 specific opportunities based on the data
3. "todaysPriorities": array of exactly 3 actions the CEO should take today
4. "overallHealth": one of "excellent"|"good"|"warning"|"critical"

Respond ONLY in JSON with those 4 keys. Be specific — reference actual numbers from the data.`;

    let executiveSummary = 'Business intelligence report generated. Review individual sections for details.';
    let growthOpportunities: string[] = [];
    let todaysPriorities: string[] = ['Review critical stock alerts', 'Check revenue performance', 'Monitor automation rules'];
    let overallHealth: CEOReport['overallHealth'] = 'good';

    try {
      const aiRes = await NexusUnifiedCore.process(aiPrompt, { agentRole: 'master_analytics', userId: 'ceo_agent' });
      const parsed = JSON.parse(aiRes.text.replace(/```json|```/g, '').trim());
      executiveSummary = parsed.executiveSummary ?? executiveSummary;
      growthOpportunities = Array.isArray(parsed.growthOpportunities) ? parsed.growthOpportunities : [];
      todaysPriorities = Array.isArray(parsed.todaysPriorities) ? parsed.todaysPriorities.slice(0, 3) : todaysPriorities;
      overallHealth = ['excellent', 'good', 'warning', 'critical'].includes(parsed.overallHealth) ? parsed.overallHealth : 'good';
    } catch { /* keep defaults */ }

    const report: CEOReport = {
      date: new Date().toISOString().split('T')[0],
      overallHealth, executiveSummary, sections, topRisks,
      growthOpportunities, todaysPriorities,
      generatedAt: new Date().toISOString(),
      dataSourcesUsed,
    };

    // Persist for history
    await NexusDB.add('ceo_reports', report as unknown as Record<string, any>);

    await AuditLog.record(
      'admin.action', { id: 'ceo_agent', type: 'system' },
      { date: report.date, overallHealth, sectionsCount: sections.length, risksCount: topRisks.length, durationMs: Date.now() - t },
      { action: 'ceo_report.generated', resource: 'ceo_agent', outcome: 'success' },
    );

    return report;
  }

  static async getLatestReport(): Promise<CEOReport | null> {
    const reports = await NexusDB.find('ceo_reports', {
      orderBy: 'generatedAt', orderDir: 'desc', limit: 1,
    }) as unknown as CEOReport[];
    return reports[0] ?? null;
  }

  static async getReportHistory(limit = 7): Promise<CEOReport[]> {
    return NexusDB.find('ceo_reports', {
      orderBy: 'generatedAt', orderDir: 'desc', limit,
    }) as unknown as CEOReport[];
  }
}
