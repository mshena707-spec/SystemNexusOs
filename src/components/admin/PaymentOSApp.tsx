/**
 * PAYMENT OS APP — Phase F
 * Admin UI for unified Payment Operating System:
 * providers, settlement, reconciliation, refunds, audit log.
 * All data from real server endpoints. No mocks.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, CheckCircle, XCircle, RefreshCw, AlertTriangle,
  DollarSign, Clock, Shield, FileText, ArrowRightLeft,
} from 'lucide-react';

interface Provider { providerId: string; configured: boolean; currencies: string[]; settlementDelayDays: number; }
interface SettlementSummary {
  pending: number; settled: number; overdue: number; partial: number;
  totalPendingAmount: number; byProvider: Record<string, { pending: number; settled: number; amount: number }>;
}
interface Discrepancy { orderId: string; provider: string; type: string; detail: string; severity: 'low'|'medium'|'high'; internalStatus: string; providerStatus?: string; }
interface AuditEntry { id?: string; orderId: string; provider: string; action: string; status: string; detail?: string; amount?: number; currency?: string; timestamp: string; }

export const PaymentOSApp: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settlement, setSettlement] = useState<SettlementSummary | null>(null);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [chainValid, setChainValid] = useState<{ valid: boolean; checkedCount: number } | null>(null);
  const [pendingRefunds, setPendingRefunds] = useState<any[]>([]);
  const [tab, setTab] = useState<'providers'|'settlement'|'reconciliation'|'audit'>('providers');
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [msg, setMsg] = useState('');

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes, dRes, aRes, cRes, rRes] = await Promise.all([
        fetch('/api/admin/payments/providers', { headers: auth }),
        fetch('/api/admin/payments/settlement', { headers: auth }),
        fetch('/api/admin/payments/discrepancies', { headers: auth }),
        fetch('/api/admin/payments/audit?limit=50', { headers: auth }),
        fetch('/api/admin/payments/audit/verify', { headers: auth }),
        fetch('/api/admin/payments/refunds/pending', { headers: auth }),
      ]);
      if (pRes.ok) { const d = await pRes.json(); setProviders(d.providers ?? []); }
      if (sRes.ok) setSettlement(await sRes.json());
      if (dRes.ok) { const d = await dRes.json(); setDiscrepancies(d.discrepancies ?? []); }
      if (aRes.ok) { const d = await aRes.json(); setAuditEntries(d.entries ?? []); }
      if (cRes.ok) setChainValid(await cRes.json());
      if (rRes.ok) { const d = await rRes.json(); setPendingRefunds(d.pending ?? []); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runReconciliation = async () => {
    setReconciling(true); setMsg('');
    try {
      const r = await fetch('/api/admin/payments/reconcile', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ lookbackDays: 7 }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg(`✅ Checked ${d.report.checkedCount} payments — ${d.report.discrepancyCount} discrepancies found`);
        await refresh();
      } else setMsg(`❌ ${d.error}`);
    } catch (e: any) { setMsg(`❌ ${e.message}`); }
    setReconciling(false);
  };

  const buildSettlement = async () => {
    setLoading(true); setMsg('');
    try {
      const r = await fetch('/api/admin/payments/settlement/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d.success) { setMsg(`✅ Built ${d.batches.length} settlement batch(es)`); await refresh(); }
    } catch (e: any) { setMsg(`❌ ${e.message}`); }
    setLoading(false);
  };

  const severityColor = (s: string) =>
    s === 'high' ? 'bg-red-900 text-red-300 border-red-800' :
    s === 'medium' ? 'bg-yellow-900 text-yellow-300 border-yellow-800' :
    'bg-blue-900 text-blue-300 border-blue-800';

  const providerLogo = (p: string) =>
    p === 'stripe' ? '💳' : p === 'bkash' ? '🅱️' : p === 'nagad' ? '🟠' : p === 'rocket' ? '🚀' : '💰';

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">

      {/* Header */}
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <CreditCard className="text-green-400" size={22}/> Payment Operating System
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">
            Stripe · bKash · Nagad · Rocket — Settlement · Reconciliation · Refunds · Audit
          </p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {msg && (
        <div className={`mx-4 mt-2 p-2 rounded text-xs ${msg.startsWith('✅') ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
          {msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-nexus-border">
        {(['providers','settlement','reconciliation','audit'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm capitalize border-b-2 transition-colors ${tab===t ? 'border-green-500 text-green-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
            {t === 'reconciliation' ? `Reconciliation ${discrepancies.length > 0 ? `(${discrepancies.length})` : ''}` : t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* PROVIDERS TAB */}
        {tab === 'providers' && (
          <div className="space-y-2">
            {providers.map(p => (
              <div key={p.providerId} className={`rounded-xl p-4 border flex items-center justify-between ${p.configured ? 'bg-nexus-void border-nexus-border' : 'bg-nexus-void/50 border-nexus-border/50'}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{providerLogo(p.providerId)}</span>
                  <div>
                    <div className="font-bold text-sm capitalize">{p.providerId}</div>
                    <div className="text-xs text-nexus-text-muted">
                      Currencies: {p.currencies.join(', ')} · Settlement: T+{p.settlementDelayDays}
                    </div>
                  </div>
                </div>
                {p.configured
                  ? <span className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded-full flex items-center gap-1"><CheckCircle size={11}/> Configured</span>
                  : <span className="text-xs bg-nexus-surface text-nexus-text-muted px-2 py-1 rounded-full flex items-center gap-1"><XCircle size={11}/> Not configured</span>}
              </div>
            ))}
            <div className="bg-blue-950/30 border border-blue-800 rounded-xl p-4 mt-2">
              <h3 className="text-sm font-bold text-blue-300 mb-2 flex items-center gap-2"><Shield size={14}/> Adding a new provider</h3>
              <p className="text-xs text-blue-200">
                Implement <code className="bg-blue-900/50 px-1 rounded">IPaymentAdapter</code> and register it in{' '}
                <code className="bg-blue-900/50 px-1 rounded">PaymentRegistry</code>. No other code changes needed —
                refunds, settlement, reconciliation, and audit logging work automatically.
              </p>
            </div>
          </div>
        )}

        {/* SETTLEMENT TAB */}
        {tab === 'settlement' && settlement && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Settled', value: settlement.settled, color: 'text-green-400', icon: <CheckCircle size={16}/> },
                { label: 'Pending', value: settlement.pending, color: 'text-yellow-400', icon: <Clock size={16}/> },
                { label: 'Partial',  value: settlement.partial, color: 'text-blue-400',  icon: <ArrowRightLeft size={16}/> },
                { label: 'Overdue',  value: settlement.overdue, color: 'text-red-400',   icon: <AlertTriangle size={16}/> },
              ].map((s,i) => (
                <div key={i} className="bg-nexus-void rounded-xl p-4">
                  <div className={`flex items-center gap-2 ${s.color}`}>{s.icon}<span className="text-xs text-nexus-text-muted">{s.label}</span></div>
                  <div className="text-2xl font-bold mt-1">{s.value}</div>
                </div>
              ))}
            </div>

            <div className="bg-nexus-void rounded-xl p-4">
              <div className="flex items-center gap-2 text-nexus-text-muted mb-1"><DollarSign size={14}/><span className="text-xs">Total Pending Settlement</span></div>
              <div className="text-2xl font-bold">${settlement.totalPendingAmount.toFixed(2)}</div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-nexus-text mb-2">By Provider</h3>
              <div className="space-y-2">
                {(Object.entries(settlement.byProvider) as [string, { pending: number; settled: number; amount: number }][]).map(([provider, data]) => (
                  <div key={provider} className="bg-nexus-void rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{providerLogo(provider)}</span>
                      <span className="text-sm font-medium capitalize">{provider}</span>
                    </div>
                    <div className="text-xs text-nexus-text-muted">
                      <span className="text-green-400">{data.settled} settled</span> · <span className="text-yellow-400">{data.pending} pending</span> · ${data.amount.toFixed(2)}
                    </div>
                  </div>
                ))}
                {Object.keys(settlement.byProvider).length === 0 && (
                  <div className="text-center py-6 text-nexus-text-muted text-sm">No settlement batches yet — click "Build Today's Batches"</div>
                )}
              </div>
            </div>

            <button onClick={buildSettlement} disabled={loading}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm disabled:opacity-50">
              Build Today's Settlement Batches
            </button>
            <p className="text-xs text-nexus-text-muted">Runs automatically daily at 01:00. Manual trigger above for testing.</p>
          </div>
        )}

        {/* RECONCILIATION TAB */}
        {tab === 'reconciliation' && (
          <div className="space-y-4">
            <button onClick={runReconciliation} disabled={reconciling}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              <RefreshCw size={14} className={reconciling ? 'animate-spin' : ''}/> {reconciling ? 'Reconciling…' : 'Run Reconciliation Now'}
            </button>
            <p className="text-xs text-nexus-text-muted">Runs automatically daily at 02:00. Checks last 7 days of payments against provider records.</p>

            {/* Pending refunds */}
            {pendingRefunds.length > 0 && (
              <div className="bg-yellow-950/30 border border-yellow-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-yellow-300 mb-2 flex items-center gap-2"><Clock size={14}/> Pending Async Refunds ({pendingRefunds.length})</h3>
                <div className="space-y-1">
                  {pendingRefunds.slice(0,10).map((r,i) => (
                    <div key={i} className="text-xs text-yellow-200 flex justify-between">
                      <span>Order #{r.orderId?.slice(0,8)} ({r.provider})</span>
                      <span>{r.refundAmount} {r.currency}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-yellow-400 mt-2">bKash/Nagad/Rocket refunds settle via back-office — typically 1-3 business days.</p>
              </div>
            )}

            {/* Discrepancies */}
            {discrepancies.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle size={32} className="mx-auto mb-2 text-green-500 opacity-60"/>
                <p className="text-sm text-nexus-text-muted">No discrepancies in the last 7 days</p>
              </div>
            ) : (
              <div className="space-y-2">
                {discrepancies.map((d, i) => (
                  <div key={i} className={`rounded-xl p-3 border ${severityColor(d.severity)}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">Order #{d.orderId?.slice(0,8)} ({d.provider})</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-nexus-void/30">{d.type.replace('_',' ')}</span>
                    </div>
                    <div className="text-xs">{d.detail}</div>
                    {d.providerStatus && (
                      <div className="text-xs mt-1 opacity-75">internal: {d.internalStatus} → provider: {d.providerStatus}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AUDIT TAB */}
        {tab === 'audit' && (
          <div className="space-y-4">
            {chainValid && (
              <div className={`rounded-xl p-4 border flex items-center gap-3 ${chainValid.valid ? 'bg-green-950/30 border-green-800' : 'bg-red-950/30 border-red-800'}`}>
                {chainValid.valid ? <CheckCircle size={18} className="text-green-400"/> : <XCircle size={18} className="text-red-400"/>}
                <div>
                  <div className="text-sm font-bold">{chainValid.valid ? 'Audit chain integrity verified' : 'AUDIT CHAIN BROKEN — possible tampering'}</div>
                  <div className="text-xs text-nexus-text-muted">{chainValid.checkedCount} entries checked (hash-chained)</div>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-bold text-nexus-text mb-2 flex items-center gap-2"><FileText size={14}/> Recent Payment Events</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-nexus-text-muted border-b border-nexus-border">
                    <th className="pb-1">Time</th>
                    <th className="pb-1">Order</th>
                    <th className="pb-1">Provider</th>
                    <th className="pb-1">Action</th>
                    <th className="pb-1">Status</th>
                    <th className="pb-1">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((e, i) => (
                    <tr key={i} className="border-b border-nexus-border/50">
                      <td className="py-1 text-nexus-text-muted">{new Date(e.timestamp).toLocaleString()}</td>
                      <td className="py-1">{e.orderId?.slice(0,8)}</td>
                      <td className="py-1 capitalize">{providerLogo(e.provider)} {e.provider}</td>
                      <td className="py-1 capitalize">{e.action}</td>
                      <td className={`py-1 ${e.status==='success'?'text-green-400':e.status==='failed'?'text-red-400':'text-yellow-400'}`}>{e.status}</td>
                      <td className="py-1 text-nexus-text-muted max-w-xs truncate">{e.detail}</td>
                    </tr>
                  ))}
                  {auditEntries.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-nexus-text-muted">No audit entries yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
