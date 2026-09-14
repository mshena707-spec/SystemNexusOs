/**
 * OWNER CONTROL PANEL — Phase H (rewritten)
 *
 * Previously: hardcoded "ONLINE" status for 4 fake agent names that don't
 * correspond to anything in the real AgentRegistry/SupervisorAgent
 * architecture, a static fabricated "live intercept stream" with made-up
 * log lines that never changed, an unwired "View Full Trace" button, and
 * a fake "AI Decision Trace" panel with a hardcoded confidence score.
 * The Emergency Kill Switch toggled an in-process boolean nothing read.
 *
 * Now: the kill switch actually engages OwnerControlEngine's persisted,
 * NexusDB-backed shutdown state (enforced by shutdownGuard middleware on
 * /api/chat and payment-creation routes). The command-center summary
 * pulls real data from Phase K (profit), Phase F (settlement), Phase M
 * (security events), and Phase B (live riders) — no fabricated panels.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, Power, DollarSign, Truck, Shield, Clock, RefreshCw,
  Download, AlertTriangle, CheckCircle,
} from 'lucide-react';

interface CommandCenterData {
  profit: { revenue: number; netProfit: number; netMarginPct: number } | null;
  settlement: { pending: number; settled: number; overdue: number; totalPendingAmount: number } | null;
  security: { total: number; bySeverity: Record<string, number> } | null;
  ridersOnline: number;
  ridersTotal: number;
  shutdown: { engaged: boolean; engagedBy?: string; engagedAt?: string; reason?: string };
  generatedAt: string;
}

export const OwnerControlPanel: React.FC = () => {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [shutdownReason, setShutdownReason] = useState('');
  const [exportTenantId, setExportTenantId] = useState('');

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/control/command-center', { headers: auth });
      if (r.ok) setData(await r.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 20_000); return () => clearInterval(t); }, [refresh]);

  const engageShutdown = async () => {
    try {
      const r = await fetch('/api/admin/control/shutdown/engage', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ reason: shutdownReason || undefined }),
      });
      if (r.ok) { setShowShutdownConfirm(false); setShutdownReason(''); await refresh(); }
    } catch { /* silent */ }
  };

  const disengageShutdown = async () => {
    try {
      const r = await fetch('/api/admin/control/shutdown/disengage', { method: 'POST', headers: auth });
      if (r.ok) await refresh();
    } catch { /* silent */ }
  };

  const exportData = async () => {
    if (!exportTenantId.trim()) return;
    window.open(`/api/admin/control/export/${encodeURIComponent(exportTenantId)}`, '_blank');
  };

  const engaged = data?.shutdown?.engaged ?? false;

  return (
    <div className="h-full flex flex-col bg-slate-900 text-nexus-text overflow-y-auto w-full">

      <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="text-red-500" /> Business Command Center
          </h2>
          <p className="text-sm text-slate-400 mt-1">Real-time cross-system summary &amp; emergency controls</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={refresh} disabled={loading} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''}/>
          </button>
          {engaged ? (
            <button onClick={disengageShutdown}
              className="px-6 py-3 rounded-lg font-bold flex items-center gap-2 bg-amber-500 hover:bg-amber-400 transition-all shadow-lg">
              <Power size={20} /> RESUME OPERATIONS
            </button>
          ) : (
            <button onClick={() => setShowShutdownConfirm(true)}
              className="px-6 py-3 rounded-lg font-bold flex items-center gap-2 bg-red-600 hover:bg-red-500 animate-pulse transition-all shadow-lg">
              <Power size={20} /> EMERGENCY KILL SWITCH
            </button>
          )}
        </div>
      </div>

      {engaged && (
        <div className="m-4 p-4 bg-red-950/40 border border-red-700 rounded-xl">
          <div className="flex items-center gap-2 text-red-300 font-bold mb-1"><AlertTriangle size={16}/> System is in Emergency Shutdown</div>
          <p className="text-xs text-red-200">
            New AI chat requests and new payment initiations are blocked. Orders and deliveries already in progress are NOT affected.
            Engaged by {data?.shutdown.engagedBy} at {data?.shutdown.engagedAt ? new Date(data.shutdown.engagedAt).toLocaleString() : '—'}
            {data?.shutdown.reason ? ` — "${data.shutdown.reason}"` : ''}.
          </p>
        </div>
      )}

      {showShutdownConfirm && (
        <div className="fixed inset-0 bg-nexus-void/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-red-700 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-red-400 mb-2 flex items-center gap-2"><AlertTriangle size={20}/> Confirm Emergency Shutdown</h3>
            <p className="text-sm text-slate-300 mb-4">
              This will block new AI chat requests and new payment initiations across the entire system, immediately, on every server instance.
              Orders/deliveries already in progress will NOT be interrupted.
            </p>
            <input type="text" placeholder="Reason (optional, for audit log)" value={shutdownReason}
              onChange={e => setShutdownReason(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm mb-4"/>
            <div className="flex gap-2">
              <button onClick={() => setShowShutdownConfirm(false)} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">Cancel</button>
              <button onClick={engageShutdown} className="flex-1 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold">Engage Shutdown</button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

        <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700">
          <h3 className="font-bold flex items-center gap-2 text-emerald-400 mb-3"><DollarSign size={18}/> Profit (This Month)</h3>
          {data?.profit ? (
            <>
              <div className="text-2xl font-bold">${data.profit.netProfit.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              <div className="text-xs text-slate-400 mt-1">{data.profit.netMarginPct.toFixed(1)}% net margin on ${data.profit.revenue.toLocaleString(undefined,{maximumFractionDigits:0})} revenue</div>
            </>
          ) : <div className="text-sm text-slate-500">Loading…</div>}
        </div>

        <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700">
          <h3 className="font-bold flex items-center gap-2 text-blue-400 mb-3"><Clock size={18}/> Settlement</h3>
          {data?.settlement ? (
            <>
              <div className="text-2xl font-bold">{data.settlement.settled}</div>
              <div className="text-xs text-slate-400 mt-1">
                settled · {data.settlement.pending} pending · {data.settlement.overdue > 0 && <span className="text-red-400">{data.settlement.overdue} overdue</span>}
                {data.settlement.overdue === 0 && 'none overdue'}
              </div>
            </>
          ) : <div className="text-sm text-slate-500">Loading…</div>}
        </div>

        <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700">
          <h3 className="font-bold flex items-center gap-2 text-orange-400 mb-3"><Truck size={18}/> Riders Online</h3>
          <div className="text-2xl font-bold">{data?.ridersOnline ?? '—'} / {data?.ridersTotal ?? '—'}</div>
          <div className="text-xs text-slate-400 mt-1">available for delivery right now</div>
        </div>

        <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700">
          <h3 className="font-bold flex items-center gap-2 text-red-400 mb-3"><Shield size={18}/> Security (24h)</h3>
          {data?.security ? (
            <>
              <div className="text-2xl font-bold">{data.security.total}</div>
              <div className="text-xs text-slate-400 mt-1">
                {(data.security.bySeverity.critical ?? 0) > 0 && <span className="text-red-400">{data.security.bySeverity.critical} critical · </span>}
                {(data.security.bySeverity.high ?? 0) > 0 && <span className="text-orange-400">{data.security.bySeverity.high} high</span>}
                {!(data.security.bySeverity.critical || data.security.bySeverity.high) && <span className="text-green-400 flex items-center gap-1"><CheckCircle size={11}/> nothing critical</span>}
              </div>
            </>
          ) : <div className="text-sm text-slate-500">Loading…</div>}
        </div>
      </div>

      <div className="p-6 pt-0">
        <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700">
          <h3 className="font-bold flex items-center gap-2 text-slate-300 mb-3"><Download size={18}/> Data Export — Zero Vendor Lock-in</h3>
          <p className="text-xs text-slate-400 mb-3">Export a customer's full data (orders, conversations, preferences) as portable JSON.</p>
          <div className="flex gap-2">
            <input type="text" placeholder="Customer/tenant ID" value={exportTenantId}
              onChange={e => setExportTenantId(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm"/>
            <button onClick={exportData} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">Export</button>
          </div>
        </div>
      </div>

      <div className="px-6 pb-6 text-xs text-slate-600">
        Last updated: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'}
      </div>
    </div>
  );
};
