/**
 * CEO COMMAND CENTER — Phase X
 * Three tabs:
 *  1. CEO Daily Brief — AI-synthesized executive report
 *  2. Demand Forecast — 14-day product demand forecasts
 *  3. Competitor Intel — Real web-search backed pricing analysis
 */
import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Search, BarChart3, Brain, Zap } from 'lucide-react';

function adminH(): Record<string, string> {
  const t = localStorage.getItem('owner_secret') || localStorage.getItem('admin_token') || '';
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
}

const STATUS_COLORS = {
  good: 'text-green-700 bg-green-50 border-green-200',
  warn: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  critical: 'text-red-700 bg-red-50 border-red-200',
  neutral: 'text-nexus-text-faint bg-gray-50 border-gray-200',
};

const HEALTH_CONFIG = {
  excellent: { color: 'bg-green-500', label: '🚀 Excellent' },
  good: { color: 'bg-blue-500', label: '✅ Good' },
  warning: { color: 'bg-yellow-500', label: '⚠️ Warning' },
  critical: { color: 'bg-red-500', label: '🚨 Critical' },
};

// ── Tab 1: CEO Daily Brief ────────────────────────────────────────────────────
const CEOBriefTab: React.FC = () => {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ceo/report', { headers: adminH() });
      const data = await res.json();
      if (data.date) setReport(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/admin/ceo/report/generate', { method: 'POST', headers: adminH() });
      const data = await res.json();
      if (data.date) setReport(data);
    } finally { setGenerating(false); }
  };

  const health = report?.overallHealth ? HEALTH_CONFIG[report.overallHealth as keyof typeof HEALTH_CONFIG] : null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={generate} disabled={generating}
          className="flex items-center gap-2 bg-indigo-700 text-nexus-text rounded-lg px-5 py-2 text-sm font-semibold hover:bg-indigo-800 disabled:opacity-40">
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {generating ? 'Generating (~20s)…' : 'Generate Today\'s Brief'}
        </button>
        <button onClick={load} disabled={loading} className="text-nexus-text-muted hover:text-nexus-text-faint p-1">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
        {report?.date && <p className="text-xs text-nexus-text-muted ml-auto">Report for {report.date}</p>}
      </div>

      {!report && !loading && !generating && (
        <div className="text-center py-12 text-nexus-text-muted">
          <Brain size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No report yet. Click "Generate Today's Brief" to create one.</p>
          <p className="text-xs mt-1 text-nexus-text">Takes ~20 seconds — synthesizes revenue, inventory, forecasts, loyalty, automation.</p>
        </div>
      )}

      {report?.date && (
        <div className="space-y-4">
          {/* Health banner */}
          {health && (
            <div className={`rounded-xl p-4 text-nexus-text ${health.color}`}>
              <p className="text-lg font-bold">{health.label}</p>
              <p className="text-sm mt-1 opacity-90">{report.executiveSummary}</p>
            </div>
          )}

          {/* Today's priorities */}
          {report.todaysPriorities?.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider mb-3">Today's Top 3 Priorities</p>
              {report.todaysPriorities.map((p: string, i: number) => (
                <div key={i} className="flex items-start gap-3 mb-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <p className="text-sm text-nexus-text-faint">{p}</p>
                </div>
              ))}
            </div>
          )}

          {/* Risks */}
          {report.topRisks?.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider mb-3">Top Risks</p>
              {report.topRisks.map((r: any, i: number) => (
                <div key={i} className={`flex items-start gap-2 p-2 rounded-lg mb-2 border text-sm ${r.severity === 'high' ? 'bg-red-50 border-red-200 text-red-800' : r.severity === 'medium' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-gray-50 border-gray-200 text-nexus-text-faint'}`}>
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div><p className="font-medium">{r.risk}</p><p className="text-xs opacity-70 mt-0.5">Action: {r.action}</p></div>
                </div>
              ))}
            </div>
          )}

          {/* Sections */}
          {report.sections?.map((section: any, i: number) => (
            <div key={i} className="bg-white rounded-xl border p-4">
              <p className="font-semibold text-nexus-text-faint mb-2">{section.title}</p>
              <p className="text-sm text-nexus-text-faint mb-3">{section.summary}</p>
              <div className="grid grid-cols-2 gap-2">
                {section.keyNumbers?.map((kn: any, j: number) => (
                  <div key={j} className={`rounded-lg border p-2.5 text-xs ${STATUS_COLORS[kn.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.neutral}`}>
                    <p className="opacity-70 mb-0.5">{kn.label}</p>
                    <p className="text-base font-bold">{kn.value}</p>
                    {kn.delta && <p className="text-xs font-medium">{kn.delta}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Growth opportunities */}
          {report.growthOpportunities?.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider mb-3">Growth Opportunities</p>
              {report.growthOpportunities.map((g: string, i: number) => (
                <div key={i} className="flex items-start gap-2 mb-2 text-sm text-nexus-text-faint">
                  <CheckCircle2 size={14} className="text-green-500 mt-0.5 shrink-0" />
                  <p>{g}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Tab 2: Demand Forecast ────────────────────────────────────────────────────
const DemandForecastTab: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [sumRes, alertRes] = await Promise.all([
        fetch('/api/admin/forecast/products?days=14&limit=50', { headers: adminH() }),
        fetch('/api/admin/forecast/restock-alerts', { headers: adminH() }),
      ]);
      const sumData = await sumRes.json();
      const alertData = await alertRes.json();
      setSummary(sumData);
      setAlerts(alertData.alerts ?? []);
    } finally { setLoading(false); }
  };

  const TrendIcon = ({ t }: { t: string }) =>
    t === 'rising' ? <TrendingUp size={14} className="text-green-500" />
    : t === 'declining' ? <TrendingDown size={14} className="text-red-500" />
    : <Minus size={14} className="text-nexus-text-muted" />;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 bg-blue-600 text-nexus-text rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
          {loading ? 'Computing…' : 'Run 14-Day Forecast'}
        </button>
        {summary && <p className="text-xs text-nexus-text-muted">{summary.productsWithData} products · {summary.productsInsufficient} insufficient data</p>}
      </div>

      {alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-xs font-bold text-red-700 uppercase tracking-wider mb-2">⚠️ Restock Alerts (14-day horizon)</p>
          {alerts.slice(0, 5).map((a: any, i: number) => (
            <div key={i} className={`text-xs mb-1 flex items-center gap-2 ${a.severity === 'critical' ? 'text-red-700' : 'text-yellow-700'}`}>
              <span className={`px-1.5 rounded text-nexus-text text-[10px] font-bold ${a.severity === 'critical' ? 'bg-red-500' : 'bg-yellow-500'}`}>{a.severity.toUpperCase()}</span>
              <span>{a.productName} — stockout in ~{a.daysUntilStockout}d, forecast {a.forecastDemand.toFixed(0)} units needed</span>
            </div>
          ))}
        </div>
      )}

      {summary?.products?.length > 0 && (
        <div className="space-y-2">
          {summary.products.filter((p: any) => p.forecastMethod === 'wma_trend').map((p: any) => (
            <div key={p.productId}
              className={`bg-white rounded-xl border p-3 cursor-pointer transition-colors ${selected?.productId === p.productId ? 'border-blue-400 bg-blue-50' : 'hover:border-gray-300'}`}
              onClick={() => setSelected(selected?.productId === p.productId ? null : p)}>
              <div className="flex items-center gap-2">
                <TrendIcon t={p.trend} />
                <span className="text-sm font-semibold text-nexus-text-faint flex-1 truncate">{p.productName}</span>
                <span className="text-sm font-bold text-blue-700">{p.totalForecastUnits.toFixed(0)} units</span>
                <span className="text-xs text-nexus-text-muted">14d</span>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-nexus-text-muted">
                <span>Avg/day: <strong>{p.avgDailyUnits}</strong></span>
                <span>Trend: <strong className={p.trend === 'rising' ? 'text-green-600' : p.trend === 'declining' ? 'text-red-500' : ''}>{p.trend}</strong></span>
                <span>Data: {p.dataPointsUsed}d</span>
              </div>

              {selected?.productId === p.productId && p.dailyForecasts?.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-bold text-nexus-text-muted mb-2">Daily Forecast</p>
                  <div className="grid grid-cols-7 gap-1">
                    {p.dailyForecasts.slice(0, 14).map((d: any, i: number) => (
                      <div key={i} className="text-center">
                        <div className="text-[10px] text-nexus-text-muted">{d.dayLabel.split(' ')[0]}</div>
                        <div className="text-xs font-bold text-blue-700">{d.forecastUnits.toFixed(1)}</div>
                        <div className="text-[9px] text-nexus-text">{Math.round(d.confidence * 100)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Tab 3: Competitor Intel ───────────────────────────────────────────────────
const CompetitorIntelTab: React.FC = () => {
  const [productName, setProductName] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [productId, setProductId] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const analyse = async () => {
    if (!productName || !currentPrice) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/admin/competitor/analyse', {
        method: 'POST', headers: adminH(),
        body: JSON.stringify({ productName, currentPrice: Number(currentPrice), productId: productId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const CONF_COLORS: Record<string, string> = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-blue-100 text-blue-800',
    low: 'bg-yellow-100 text-yellow-800',
    no_data: 'bg-gray-100 text-nexus-text-faint',
  };

  return (
    <div className="p-4 space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
        <strong>Real web search backed.</strong> Requires SERPAPI_KEY or GOOGLE_CSE_KEY + GOOGLE_CSE_CX env vars. Falls back to AI-only analysis (clearly labelled) if no search key configured.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-nexus-text-muted">Product Name *</label>
          <input value={productName} onChange={e => setProductName(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            placeholder="e.g. Samsung Galaxy A54" />
        </div>
        <div>
          <label className="text-xs text-nexus-text-muted">Current Price *</label>
          <input type="number" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 35000" />
        </div>
        <div>
          <label className="text-xs text-nexus-text-muted">Product ID (optional)</label>
          <input value={productId} onChange={e => setProductId(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="for history tracking" />
        </div>
      </div>

      <button onClick={analyse} disabled={!productName || !currentPrice || loading}
        className="flex items-center gap-2 bg-purple-700 text-nexus-text rounded-lg px-5 py-2 text-sm font-semibold hover:bg-purple-800 disabled:opacity-40">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        {loading ? 'Analysing market…' : 'Run Competitor Analysis'}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-nexus-text-faint">{result.productName}</p>
              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${CONF_COLORS[result.confidenceLevel] ?? CONF_COLORS.no_data}`}>
                {result.confidenceLevel} confidence
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-nexus-text-muted">Current Price</p>
                <p className="text-xl font-bold text-nexus-text-faint">{result.currentPrice}</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-nexus-text-muted">Market Median</p>
                <p className="text-xl font-bold text-blue-700">{result.marketMedianPrice ?? 'N/A'}</p>
              </div>
              <div className={`rounded-lg p-3 ${result.suggestedPrice < result.currentPrice ? 'bg-red-50' : result.suggestedPrice > result.currentPrice ? 'bg-green-50' : 'bg-gray-50'}`}>
                <p className="text-xs text-nexus-text-muted">Suggested Price</p>
                <p className={`text-xl font-bold ${result.suggestedPrice < result.currentPrice ? 'text-red-700' : result.suggestedPrice > result.currentPrice ? 'text-green-700' : 'text-nexus-text-faint'}`}>
                  {result.suggestedPrice}
                </p>
              </div>
            </div>
            <p className="text-sm text-nexus-text-faint bg-gray-50 rounded-lg p-3">{result.recommendation}</p>
            {result.searchPerformed && result.pricePoints?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider mb-2">Price Points Found ({result.pricePoints.length})</p>
                {result.pricePoints.slice(0, 6).map((pp: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-nexus-text-faint mb-1">
                    <span className="bg-gray-100 rounded px-1.5 py-0.5 font-mono">{pp.parsedPrice}</span>
                    <span className="text-nexus-text-muted truncate">{pp.source}</span>
                  </div>
                ))}
              </div>
            )}
            {!result.searchPerformed && (
              <p className="text-xs text-yellow-700 bg-yellow-50 rounded p-2">⚠️ No web search was performed (no search API key configured). Analysis is AI-only without real market data.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const CEOCommandCenter: React.FC = () => {
  const [tab, setTab] = useState<'brief' | 'forecast' | 'competitor'>('brief');
  const tabs = [
    { id: 'brief' as const, label: '🧠 CEO Brief' },
    { id: 'forecast' as const, label: '📈 Demand Forecast' },
    { id: 'competitor' as const, label: '🔍 Competitor Intel' },
  ];
  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-gradient-to-r from-indigo-700 to-purple-700 text-nexus-text px-5 py-4 shrink-0">
        <h2 className="text-base font-bold flex items-center gap-2"><Brain size={16} /> CEO Command Center</h2>
        <p className="text-xs text-indigo-200 mt-0.5">AI-synthesized daily brief · Demand forecasting · Competitor intelligence</p>
      </div>
      <div className="flex border-b bg-white shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-nexus-text-muted hover:text-nexus-text-faint'
            }`}>{t.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'brief' && <CEOBriefTab />}
        {tab === 'forecast' && <DemandForecastTab />}
        {tab === 'competitor' && <CompetitorIntelTab />}
      </div>
    </div>
  );
};
