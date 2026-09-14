/**
 * FINANCIAL OS APP — Phase K
 * Admin UI for real Revenue / Profit / Cash Flow reporting.
 * All data from real server endpoints. No mocks, no assumed margins.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, RefreshCw,
  PlusCircle, PieChart, Wallet, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

interface ProfitReport {
  periodLabel: string; revenue: number; cogs: number; grossProfit: number; grossMarginPct: number;
  operatingExpenses: number; operatingExpensesByCategory: Record<string, number>;
  netProfit: number; netMarginPct: number; ordersWithMissingCostPrice: number;
}
interface CashFlowReport {
  periodLabel: string; cashIn: number; cashOut: number; netCashFlow: number;
  pendingCashIn: number; refundsOut: number; expensesOut: number;
  byProvider: Record<string, { settled: number; pending: number }>;
}
interface ProductProfitability { productId: string; name: string; unitsSold: number; revenue: number; cogs: number; grossProfit: number; marginPct: number; }
interface RiskFlag { severity: 'low'|'medium'|'high'; message: string; }

const EXPENSE_CATEGORIES = ['cogs','rider_payout','marketing','software','rent','salaries','payment_processing_fees','refunds','utilities','other'];

export const FinancialOSApp: React.FC = () => {
  const [tab, setTab] = useState<'profit'|'cashflow'|'products'|'expenses'>('profit');
  const [profitMoM, setProfitMoM] = useState<{ current: ProfitReport; previous: ProfitReport } | null>(null);
  const [cashflowMoM, setCashflowMoM] = useState<{ current: CashFlowReport; previous: CashFlowReport } | null>(null);
  const [products, setProducts] = useState<ProductProfitability[]>([]);
  const [riskFlags, setRiskFlags] = useState<RiskFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: 'marketing', amount: '', description: '', currency: 'BDT' });
  const [msg, setMsg] = useState('');

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, prodRes, riskRes] = await Promise.all([
        fetch('/api/admin/finance/profit/month-over-month', { headers: auth }),
        fetch('/api/admin/finance/cashflow/month-over-month', { headers: auth }),
        fetch('/api/admin/finance/products/profitability', { headers: auth }),
        fetch('/api/admin/finance/cashflow/risk', { headers: auth }),
      ]);
      if (pRes.ok) setProfitMoM(await pRes.json());
      if (cRes.ok) setCashflowMoM(await cRes.json());
      if (prodRes.ok) { const d = await prodRes.json(); setProducts(d.products ?? []); }
      if (riskRes.ok) { const d = await riskRes.json(); setRiskFlags(d.flags ?? []); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submitExpense = async () => {
    if (!expenseForm.amount || !expenseForm.description) return;
    try {
      const r = await fetch('/api/admin/finance/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          category: expenseForm.category, amount: parseFloat(expenseForm.amount),
          currency: expenseForm.currency, description: expenseForm.description,
          recordedBy: 'admin', incurredAt: new Date().toISOString(),
        }),
      });
      if (r.ok) {
        setMsg('✅ Expense recorded'); setExpenseForm({ category: 'marketing', amount: '', description: '', currency: 'BDT' });
        setShowExpenseForm(false); await refresh();
      }
    } catch { setMsg('❌ Failed to record expense'); }
  };

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const pctColor = (n: number) => n >= 0 ? 'text-green-400' : 'text-red-400';
  const severityColor = (s: string) => s === 'high' ? 'bg-red-950 border-red-700 text-red-300' : s === 'medium' ? 'bg-yellow-950 border-yellow-700 text-yellow-300' : 'bg-blue-950 border-blue-700 text-blue-300';

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">

      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <DollarSign className="text-emerald-400" size={22}/> Financial OS
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">Real revenue, profit (COGS-based), and cash flow — not assumed margins</p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {riskFlags.length > 0 && (
        <div className="p-3 space-y-2 border-b border-nexus-border">
          {riskFlags.map((f, i) => (
            <div key={i} className={`rounded-lg p-2 border text-xs flex items-center gap-2 ${severityColor(f.severity)}`}>
              <AlertTriangle size={14}/> {f.message}
            </div>
          ))}
        </div>
      )}

      {msg && <div className="mx-4 mt-2 p-2 rounded text-xs bg-green-900/40 text-green-300">{msg}</div>}

      <div className="flex border-b border-nexus-border">
        {(['profit','cashflow','products','expenses'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm capitalize border-b-2 transition-colors ${tab===t ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
            {t === 'cashflow' ? 'Cash Flow' : t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* PROFIT TAB */}
        {tab === 'profit' && profitMoM && (
          <div className="space-y-4">
            {profitMoM.current.ordersWithMissingCostPrice > 0 && (
              <div className="bg-yellow-950/30 border border-yellow-800 rounded-xl p-3 text-xs text-yellow-300 flex items-center gap-2">
                <AlertTriangle size={14}/> {profitMoM.current.ordersWithMissingCostPrice} order(s) this month reference products with no cost price set — their COGS contribution is $0, understating true cost. Set <code>costPrice</code> on those products for accurate margins.
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-nexus-void rounded-xl p-4">
                <div className="text-xs text-nexus-text-muted mb-1">Revenue</div>
                <div className="text-2xl font-bold">{fmt(profitMoM.current.revenue)}</div>
                <div className="text-xs text-nexus-text-muted mt-1">vs {fmt(profitMoM.previous.revenue)} last month</div>
              </div>
              <div className="bg-nexus-void rounded-xl p-4">
                <div className="text-xs text-nexus-text-muted mb-1">Gross Profit</div>
                <div className="text-2xl font-bold">{fmt(profitMoM.current.grossProfit)}</div>
                <div className="text-xs text-nexus-text-muted mt-1">{profitMoM.current.grossMarginPct.toFixed(1)}% margin</div>
              </div>
              <div className="bg-nexus-void rounded-xl p-4">
                <div className="text-xs text-nexus-text-muted mb-1">Net Profit</div>
                <div className={`text-2xl font-bold ${pctColor(profitMoM.current.netProfit)}`}>{fmt(profitMoM.current.netProfit)}</div>
                <div className="text-xs text-nexus-text-muted mt-1">{profitMoM.current.netMarginPct.toFixed(1)}% margin</div>
              </div>
            </div>

            <div className="bg-nexus-void rounded-xl p-4">
              <h3 className="text-sm font-bold text-nexus-text mb-3">Cost Breakdown</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-nexus-text-muted">Cost of Goods Sold</span><span>{fmt(profitMoM.current.cogs)}</span></div>
                {(Object.entries(profitMoM.current.operatingExpensesByCategory) as [string, number][]).filter(([c]) => c !== 'cogs').map(([cat, amt]) => (
                  <div key={cat} className="flex justify-between text-sm"><span className="text-nexus-text-muted capitalize">{cat.replace(/_/g,' ')}</span><span>{fmt(amt)}</span></div>
                ))}
                <div className="flex justify-between text-sm font-bold border-t border-nexus-border pt-2"><span>Total Operating Expenses</span><span>{fmt(profitMoM.current.operatingExpenses)}</span></div>
              </div>
            </div>
          </div>
        )}

        {/* CASH FLOW TAB */}
        {tab === 'cashflow' && cashflowMoM && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-nexus-void rounded-xl p-4">
                <div className="flex items-center gap-2 text-green-400 mb-1"><ArrowUpRight size={14}/><span className="text-xs">Cash In (settled)</span></div>
                <div className="text-2xl font-bold">{fmt(cashflowMoM.current.cashIn)}</div>
              </div>
              <div className="bg-nexus-void rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-400 mb-1"><ArrowDownRight size={14}/><span className="text-xs">Cash Out</span></div>
                <div className="text-2xl font-bold">{fmt(cashflowMoM.current.cashOut)}</div>
              </div>
            </div>

            <div className="bg-nexus-void rounded-xl p-4">
              <div className="flex items-center gap-2 text-nexus-text-muted mb-1"><Wallet size={14}/><span className="text-xs">Net Cash Flow</span></div>
              <div className={`text-2xl font-bold ${pctColor(cashflowMoM.current.netCashFlow)}`}>{fmt(cashflowMoM.current.netCashFlow)}</div>
            </div>

            {cashflowMoM.current.pendingCashIn > 0 && (
              <div className="bg-blue-950/30 border border-blue-800 rounded-xl p-4">
                <div className="text-xs text-blue-300 mb-1">Pending Settlement (owed, not yet in hand)</div>
                <div className="text-xl font-bold text-blue-200">{fmt(cashflowMoM.current.pendingCashIn)}</div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-bold text-nexus-text mb-2">By Provider</h3>
              <div className="space-y-2">
                {(Object.entries(cashflowMoM.current.byProvider) as [string, { settled: number; pending: number }][]).map(([p, d]) => (
                  <div key={p} className="bg-nexus-void rounded-lg p-3 flex justify-between text-sm">
                    <span className="capitalize">{p}</span>
                    <span><span className="text-green-400">{fmt(d.settled)} settled</span> · <span className="text-yellow-400">{fmt(d.pending)} pending</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PRODUCTS TAB */}
        {tab === 'products' && (
          <div className="space-y-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-nexus-text-muted border-b border-nexus-border">
                  <th className="pb-2">Product</th><th className="pb-2 text-right">Units</th>
                  <th className="pb-2 text-right">Revenue</th><th className="pb-2 text-right">COGS</th>
                  <th className="pb-2 text-right">Profit</th><th className="pb-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.productId} className="border-b border-nexus-border/50">
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 text-right">{p.unitsSold}</td>
                    <td className="py-2 text-right">{fmt(p.revenue)}</td>
                    <td className="py-2 text-right text-nexus-text-muted">{fmt(p.cogs)}</td>
                    <td className={`py-2 text-right ${pctColor(p.grossProfit)}`}>{fmt(p.grossProfit)}</td>
                    <td className="py-2 text-right">{p.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
                {products.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-nexus-text-muted">No product sales data yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* EXPENSES TAB */}
        {tab === 'expenses' && (
          <div className="space-y-4">
            <button onClick={() => setShowExpenseForm(!showExpenseForm)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm flex items-center gap-2">
              <PlusCircle size={14}/> Record Expense
            </button>

            {showExpenseForm && (
              <div className="bg-nexus-void rounded-xl p-4 space-y-3">
                <select value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})}
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm">
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
                </select>
                <input type="number" placeholder="Amount" value={expenseForm.amount}
                  onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})}
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                <input type="text" placeholder="Description" value={expenseForm.description}
                  onChange={e => setExpenseForm({...expenseForm, description: e.target.value})}
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                <button onClick={submitExpense} className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm">Save Expense</button>
              </div>
            )}

            <div className="bg-blue-950/30 border border-blue-800 rounded-xl p-4 text-xs text-blue-200">
              Expenses recorded here feed directly into the Profit and Cash Flow tabs. Set product cost prices in the catalog for accurate COGS — without them, gross margin will be overstated.
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
