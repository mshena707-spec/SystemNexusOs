/**
 * DYNAMIC PRICING DASHBOARD — Phase V
 * Admin UI for DynamicPricingEngine (Phase S backend).
 * Tabs: Suggestions (compute + apply), What-If Simulator, Applied Price Log.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, CheckCircle2, AlertCircle, Calculator, History } from 'lucide-react';

function adminH(): Record<string, string> {
  const t = localStorage.getItem('owner_secret') || localStorage.getItem('admin_token') || '';
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
}

interface PricingSignal {
  velocityScore: number;
  trend: 'rising' | 'stable' | 'declining';
  stockDaysLeft: number;
  stockAlertSeverity: string;
  demandLevel: 'high' | 'normal' | 'low';
}

interface PricingSuggestion {
  productId: string;
  productName: string;
  basePrice: number;
  suggestedPrice: number;
  changePercent: number;
  signals: PricingSignal;
  rationale: string;
  aiAdjustedPrice?: number;
  computedAt: string;
  applied: boolean;
}

interface SimResult {
  priceChangePct: number;
  estimatedDemandChangePct: number;
  estimatedRevenueDelta: number;
  confidence: 'low' | 'medium';
  note: string;
}

const TrendIcon = ({ trend }: { trend: string }) =>
  trend === 'rising' ? <TrendingUp size={14} className="text-green-500" />
  : trend === 'declining' ? <TrendingDown size={14} className="text-red-500" />
  : <Minus size={14} className="text-nexus-text-muted" />;

const DemandBadge = ({ d }: { d: string }) => (
  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
    d === 'high' ? 'bg-green-100 text-green-700' : d === 'low' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-nexus-text-faint'
  }`}>{d}</span>
);

// ── Tab 1: Suggestions ────────────────────────────────────────────────────────
const SuggestionsTab: React.FC = () => {
  const [suggestions, setSuggestions] = useState<PricingSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/pricing/suggestions?limit=50', { headers: adminH() });
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } finally { setLoading(false); }
  }, []);

  const apply = async (s: PricingSuggestion, useAI: boolean) => {
    const price = useAI && s.aiAdjustedPrice ? s.aiAdjustedPrice : s.suggestedPrice;
    if (!confirm(`Apply price ${price.toFixed(2)} to "${s.productName}"? This writes to the products collection.`)) return;
    setApplying(s.productId);
    try {
      const res = await fetch('/api/admin/pricing/apply', {
        method: 'POST', headers: adminH(),
        body: JSON.stringify({ productId: s.productId, newPrice: price, suggestion: s }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ id: s.productId, text: `✅ Applied ${price.toFixed(2)}`, ok: true });
        setSuggestions(prev => prev.map(x => x.productId === s.productId ? { ...x, applied: true } : x));
      } else throw new Error(data.error);
    } catch (e: any) {
      setMsg({ id: s.productId, text: `❌ ${e.message}`, ok: false });
    } finally { setApplying(null); }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 bg-blue-600 text-nexus-text rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {loading ? 'Computing…' : 'Compute Suggestions'}
        </button>
        {suggestions.length > 0 && <p className="text-xs text-nexus-text-muted">{suggestions.length} products · last computed just now</p>}
      </div>

      {suggestions.length === 0 && !loading && (
        <div className="text-center py-10 text-nexus-text-muted">
          <TrendingUp size={36} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Click "Compute Suggestions" to analyse live demand signals.</p>
        </div>
      )}

      {suggestions.map(s => (
        <div key={s.productId} className={`rounded-xl border bg-white p-4 space-y-3 ${s.applied ? 'opacity-60' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-900 text-sm">{s.productName}</p>
              <p className="text-xs text-nexus-text-muted">{s.productId}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-nexus-text-muted line-through">${s.basePrice.toFixed(2)}</p>
              <p className={`text-lg font-bold ${s.changePercent > 0 ? 'text-green-700' : s.changePercent < 0 ? 'text-red-600' : 'text-nexus-text-faint'}`}>
                ${s.suggestedPrice.toFixed(2)}
                <span className="text-xs ml-1">({s.changePercent > 0 ? '+' : ''}{s.changePercent}%)</span>
              </p>
              {s.aiAdjustedPrice && s.aiAdjustedPrice !== s.suggestedPrice && (
                <p className="text-xs text-purple-600">AI rounded: ${s.aiAdjustedPrice.toFixed(2)}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-gray-50 rounded p-2">
              <p className="text-nexus-text-muted mb-0.5">Demand</p>
              <DemandBadge d={s.signals.demandLevel} />
              <p className="text-nexus-text-muted mt-0.5">velocity {s.signals.velocityScore}</p>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <p className="text-nexus-text-muted mb-0.5">Trend</p>
              <div className="flex items-center gap-1"><TrendIcon trend={s.signals.trend} />{s.signals.trend}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <p className="text-nexus-text-muted mb-0.5">Stock</p>
              <p className={s.signals.stockDaysLeft < 5 ? 'text-red-600 font-bold' : 'text-nexus-text-faint'}>
                {s.signals.stockDaysLeft === 999 ? 'n/a' : `${s.signals.stockDaysLeft}d`}
              </p>
            </div>
          </div>

          <p className="text-xs text-nexus-text-muted italic">Rationale: {s.rationale}</p>

          {msg?.id === s.productId && (
            <p className={`text-xs font-medium ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>
          )}

          {!s.applied && s.changePercent !== 0 && (
            <div className="flex gap-2">
              <button onClick={() => apply(s, false)} disabled={applying === s.productId}
                className="flex items-center gap-1.5 text-xs bg-green-700 text-nexus-text rounded px-3 py-1.5 font-semibold hover:bg-green-800 disabled:opacity-40">
                {applying === s.productId ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                Apply ${s.suggestedPrice.toFixed(2)}
              </button>
              {s.aiAdjustedPrice && s.aiAdjustedPrice !== s.suggestedPrice && (
                <button onClick={() => apply(s, true)} disabled={applying === s.productId}
                  className="text-xs bg-purple-600 text-nexus-text rounded px-3 py-1.5 font-semibold hover:bg-purple-700 disabled:opacity-40">
                  Apply AI ${s.aiAdjustedPrice.toFixed(2)}
                </button>
              )}
            </div>
          )}
          {s.applied && <p className="text-xs text-green-600 font-semibold">✅ Price applied</p>}
        </div>
      ))}
    </div>
  );
};

// ── Tab 2: What-If Simulator ──────────────────────────────────────────────────
const SimulatorTab: React.FC = () => {
  const [productId, setProductId] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const simulate = async () => {
    if (!productId || !currentPrice || !newPrice) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/admin/pricing/simulate', {
        method: 'POST', headers: adminH(),
        body: JSON.stringify({ productId, currentPrice: Number(currentPrice), newPrice: Number(newPrice) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-nexus-text-muted">Ask: "What happens to revenue if I change this product's price?" Uses demand data from BIEngine + price elasticity model.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-nexus-text-muted">Product ID</label>
          <input value={productId} onChange={e => setProductId(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="e.g. prod_abc123" />
        </div>
        <div>
          <label className="text-xs text-nexus-text-muted">Current Price</label>
          <input type="number" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 500" />
        </div>
        <div>
          <label className="text-xs text-nexus-text-muted">New Price</label>
          <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 475" />
        </div>
      </div>
      <button onClick={simulate} disabled={!productId || !currentPrice || !newPrice || loading}
        className="flex items-center gap-2 bg-blue-600 text-nexus-text rounded-lg px-5 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
        {loading ? 'Simulating…' : 'Run Simulation'}
      </button>
      {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{error}</p>}
      {result && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
          <p className="font-bold text-blue-800 text-sm">Simulation Results</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-white rounded p-3 border border-blue-100">
              <p className="text-xs text-nexus-text-muted">Price Change</p>
              <p className={`text-xl font-bold ${result.priceChangePct < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {result.priceChangePct > 0 ? '+' : ''}{result.priceChangePct}%
              </p>
            </div>
            <div className="bg-white rounded p-3 border border-blue-100">
              <p className="text-xs text-nexus-text-muted">Est. Demand Change</p>
              <p className={`text-xl font-bold ${result.estimatedDemandChangePct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {result.estimatedDemandChangePct > 0 ? '+' : ''}{result.estimatedDemandChangePct}%
              </p>
            </div>
            <div className="bg-white rounded p-3 border border-blue-100 col-span-2">
              <p className="text-xs text-nexus-text-muted">Estimated 30-day Revenue Delta</p>
              <p className={`text-2xl font-bold ${result.estimatedRevenueDelta >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {result.estimatedRevenueDelta >= 0 ? '+' : ''}${result.estimatedRevenueDelta.toFixed(2)}
              </p>
              <p className="text-xs text-nexus-text-muted mt-1">Confidence: <strong>{result.confidence}</strong></p>
            </div>
          </div>
          <p className="text-xs text-nexus-text-muted italic">{result.note}</p>
        </div>
      )}
    </div>
  );
};

// ── Tab 3: Applied Price Log ──────────────────────────────────────────────────
const PriceLogTab: React.FC = () => {
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/pricing/log', { headers: adminH() })
      .then(r => r.json()).then(d => setLog(d.log ?? [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 space-y-2">
      {loading && <div className="text-nexus-text-muted text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading…</div>}
      {!loading && log.length === 0 && <p className="text-sm text-nexus-text-muted text-center py-8">No prices applied yet.</p>}
      {log.map((entry, i) => (
        <div key={i} className="bg-white rounded-lg border p-3 text-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-nexus-text-faint">{entry.productName ?? entry.productId}</p>
              <p className="text-xs text-nexus-text-muted">{entry.productId}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-nexus-text-muted line-through">${entry.basePrice?.toFixed(2)}</p>
              <p className="font-bold text-green-700">${entry.appliedPrice?.toFixed(2) ?? entry.suggestedPrice?.toFixed(2)}</p>
            </div>
          </div>
          <p className="text-xs text-nexus-text-muted mt-1 italic">{entry.rationale}</p>
          <p className="text-xs text-nexus-text-muted">{new Date(entry.computedAt).toLocaleString()} · by {entry.appliedBy ?? 'owner'}</p>
        </div>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const DynamicPricingApp: React.FC = () => {
  const [tab, setTab] = useState<'suggest' | 'simulate' | 'log'>('suggest');
  const tabs = [
    { id: 'suggest' as const, label: '📊 Suggestions' },
    { id: 'simulate' as const, label: '🧮 What-If' },
    { id: 'log' as const, label: '📋 History' },
  ];
  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-gradient-to-r from-green-700 to-teal-700 text-nexus-text px-5 py-4 shrink-0">
        <h2 className="text-base font-bold">Dynamic Pricing Engine</h2>
        <p className="text-xs text-green-200 mt-0.5">Real demand signals — velocity, trend, stock pressure</p>
      </div>
      <div className="flex border-b bg-white shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-nexus-text-muted hover:text-nexus-text-faint'
            }`}>{t.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'suggest' && <SuggestionsTab />}
        {tab === 'simulate' && <SimulatorTab />}
        {tab === 'log' && <PriceLogTab />}
      </div>
    </div>
  );
};
