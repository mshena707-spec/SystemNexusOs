/**
 * AI PROVIDER DASHBOARD — Phase D
 * Admin UI for provider health, benchmarks, cost, and role overrides.
 * All data from real server endpoints. No mocks.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  DollarSign, Clock, BarChart2, Settings, Shield,
} from 'lucide-react';

const TIERS = ['free', 'low', 'medium', 'high', 'enterprise'] as const;
const ROLES = ['customer', 'rider', 'admin', 'marketing', 'support', 'system'];

interface Provider { id: string; providerId: string; isHealthy: boolean; failureCount: number; capabilities: any; addedAt: string; }
interface Benchmark { providerId: string; p50Ms: number; p95Ms: number; successRate: number; avgCostPer1kTokens: number; qualityScore: number; sampleCount: number; }
interface Spend { totalUsd: number; byUser: Record<string,number>; budget: number; remaining: number; }

export const AIProviderDashboard: React.FC = () => {
  const [providers,   setProviders]   = useState<Provider[]>([]);
  const [benchmarks,  setBenchmarks]  = useState<Benchmark[]>([]);
  const [spend,       setSpend]       = useState<Spend | null>(null);
  const [overrides,   setOverrides]   = useState<Record<string,string>>({});
  const [loading,     setLoading]     = useState(false);
  const [benchRunning,setBenchRunning]= useState(false);
  const [tab,         setTab]         = useState<'health'|'bench'|'cost'|'routing'>('health');
  const [newRole,     setNewRole]     = useState('customer');
  const [newProvider, setNewProvider] = useState('');
  const [msg,         setMsg]         = useState('');

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, bRes, sRes] = await Promise.all([
        fetch('/api/admin/ai/providers', { headers: auth }),
        fetch('/api/admin/ai/benchmarks', { headers: auth }),
        fetch('/api/admin/ai/spend',      { headers: auth }),
      ]);
      if (pRes.ok) { const d = await pRes.json(); setProviders(d.providers ?? []); setOverrides(d.roleOverrides ?? {}); }
      if (bRes.ok) { const d = await bRes.json(); setBenchmarks(d.benchmarks ?? []); }
      if (sRes.ok) setSpend(await sRes.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runBenchmark = async () => {
    setBenchRunning(true); setMsg('');
    try {
      const r = await fetch('/api/admin/ai/benchmark', { method: 'POST', headers: auth });
      const d = await r.json();
      if (d.success) { setMsg(`✅ Benchmark complete — ${d.results.length} providers tested`); await refresh(); }
    } catch { setMsg('❌ Benchmark failed'); }
    setBenchRunning(false);
  };

  const setOverride = async () => {
    if (!newRole || !newProvider) return;
    try {
      const r = await fetch('/api/admin/ai/role-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ role: newRole, providerId: newProvider }),
      });
      const d = await r.json();
      setMsg(d.success ? `✅ ${d.message}` : `❌ ${d.error}`);
      if (d.success) await refresh();
    } catch { setMsg('❌ Failed to set override'); }
  };

  const clearOverride = async (role: string) => {
    try {
      await fetch(`/api/admin/ai/role-override/${role}`, { method: 'DELETE', headers: auth });
      setMsg(`✅ Cleared override for "${role}"`);
      await refresh();
    } catch { /* silent */ }
  };

  const getBench = (pid: string) => benchmarks.find(b => b.providerId === pid);
  const tierColor = (t: string) =>
    t === 'free' ? 'bg-green-900 text-green-300' : t === 'low' ? 'bg-blue-900 text-blue-300' :
    t === 'medium' ? 'bg-yellow-900 text-yellow-300' : t === 'high' ? 'bg-orange-900 text-orange-300' :
    'bg-red-900 text-red-300';

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">

      {/* Header */}
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Zap className="text-yellow-400" size={22}/> AI Provider Orchestrator
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">
            {providers.length} providers · {providers.filter(p=>p.isHealthy).length} healthy ·
            Auto-failover · Auto-benchmark · Cost optimization
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={runBenchmark} disabled={benchRunning}
            className="px-3 py-1.5 text-xs bg-yellow-600 hover:bg-yellow-500 rounded-lg flex items-center gap-1 disabled:opacity-50">
            <BarChart2 size={13}/> {benchRunning ? 'Running…' : 'Run Benchmark'}
          </button>
          <button onClick={refresh} disabled={loading}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mx-4 mt-2 p-2 rounded text-xs ${msg.startsWith('✅') ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
          {msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-nexus-border">
        {(['health','bench','cost','routing'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm capitalize border-b-2 transition-colors ${tab===t ? 'border-yellow-500 text-yellow-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
            {t === 'bench' ? 'Benchmarks' : t === 'cost' ? 'Cost & Spend' : t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">

        {/* HEALTH TAB */}
        {tab === 'health' && (
          <div className="space-y-2">
            {providers.length === 0 && (
              <div className="text-center py-8 text-nexus-text-muted text-sm">No providers registered yet — check SystemBoot</div>
            )}
            {providers.map(p => {
              const b = getBench(p.providerId);
              return (
                <div key={p.id} className={`rounded-xl p-4 border ${p.isHealthy ? 'bg-nexus-void border-nexus-border' : 'bg-red-950/30 border-red-800'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {p.isHealthy
                        ? <CheckCircle size={16} className="text-green-400 flex-shrink-0"/>
                        : <XCircle    size={16} className="text-red-400 flex-shrink-0"/>}
                      <div>
                        <span className="font-medium text-sm">{p.id}</span>
                        {overrides[newRole] === p.id && (
                          <span className="ml-2 text-xs bg-yellow-800 text-yellow-200 px-1.5 rounded">role override</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${tierColor(p.capabilities?.costTier ?? 'free')}`}>
                        {p.capabilities?.costTier ?? '?'}
                      </span>
                      <span className="text-xs text-nexus-text-muted">{p.capabilities?.speed}</span>
                      <span className="text-xs text-nexus-text-muted">{p.capabilities?.intelligence}</span>
                    </div>
                  </div>
                  {b && (
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-nexus-text-muted">
                      <span>P50: <strong className="text-nexus-text">{b.p50Ms}ms</strong></span>
                      <span>P95: <strong className="text-nexus-text">{b.p95Ms}ms</strong></span>
                      <span>Success: <strong className="text-nexus-text">{b.successRate}%</strong></span>
                      <span>Quality: <strong className="text-nexus-text">{b.qualityScore}/100</strong></span>
                    </div>
                  )}
                  {p.failureCount > 0 && (
                    <div className="mt-1 text-xs text-red-400 flex items-center gap-1">
                      <AlertTriangle size={11}/> {p.failureCount} recent failure{p.failureCount>1?'s':''}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-nexus-text-faint">{p.capabilities?.description}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* BENCHMARKS TAB */}
        {tab === 'bench' && (
          <div>
            <p className="text-xs text-nexus-text-muted mb-3">
              Benchmarks run daily at 04:00. Providers with &lt;50% success rate auto-marked unhealthy.
              Click "Run Benchmark" to test now.
            </p>
            {benchmarks.length === 0 ? (
              <div className="text-center py-8 text-nexus-text-muted text-sm">No benchmarks yet — click "Run Benchmark" above</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-nexus-text-muted border-b border-nexus-border">
                    <th className="pb-2">Provider</th>
                    <th className="pb-2 text-right">P50</th>
                    <th className="pb-2 text-right">P95</th>
                    <th className="pb-2 text-right">Success</th>
                    <th className="pb-2 text-right">Quality</th>
                    <th className="pb-2 text-right">$/1k tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarks
                    .sort((a,b) => b.successRate - a.successRate || a.p50Ms - b.p50Ms)
                    .map(b => (
                    <tr key={b.providerId} className="border-b border-nexus-border/50 hover:bg-nexus-void/50">
                      <td className="py-2 font-medium">{b.providerId}</td>
                      <td className="py-2 text-right text-nexus-text">{b.p50Ms}ms</td>
                      <td className="py-2 text-right text-nexus-text">{b.p95Ms}ms</td>
                      <td className={`py-2 text-right font-bold ${b.successRate>=80?'text-green-400':b.successRate>=50?'text-yellow-400':'text-red-400'}`}>
                        {b.successRate}%
                      </td>
                      <td className="py-2 text-right text-nexus-text">{b.qualityScore}/100</td>
                      <td className="py-2 text-right text-nexus-text-muted">
                        {b.avgCostPer1kTokens === 0 ? <span className="text-green-400">Free</span> : `$${b.avgCostPer1kTokens.toFixed(5)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* COST TAB */}
        {tab === 'cost' && spend && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Today Spent', value: `$${spend.totalUsd.toFixed(4)}`, icon: <DollarSign size={16} className="text-red-400"/> },
                { label: 'Daily Budget', value: `$${spend.budget.toFixed(2)}`, icon: <Shield size={16} className="text-blue-400"/> },
                { label: 'Remaining', value: `$${spend.remaining.toFixed(4)}`, icon: <CheckCircle size={16} className="text-green-400"/> },
              ].map((s,i) => (
                <div key={i} className="bg-nexus-void rounded-xl p-4 flex items-center gap-3">
                  {s.icon}
                  <div>
                    <div className="text-lg font-bold">{s.value}</div>
                    <div className="text-xs text-nexus-text-muted">{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Budget bar */}
            <div>
              <div className="flex justify-between text-xs text-nexus-text-muted mb-1">
                <span>Budget usage</span>
                <span>{spend.budget > 0 ? Math.round((spend.totalUsd/spend.budget)*100) : 0}%</span>
              </div>
              <div className="h-2 bg-nexus-surface rounded-full">
                <div
                  className={`h-2 rounded-full transition-all ${spend.totalUsd/spend.budget > 0.8 ? 'bg-red-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(100, spend.budget>0 ? (spend.totalUsd/spend.budget)*100 : 0)}%` }}
                />
              </div>
            </div>
            {/* Per-user breakdown */}
            {Object.keys(spend.byUser).length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-nexus-text mb-2">Per-user spend today</h3>
                <div className="space-y-1">
                  {(Object.entries(spend.byUser) as [string, number][])
                    .sort(([,a],[,b]) => b-a)
                    .slice(0,10)
                    .map(([uid, amt]) => (
                    <div key={uid} className="flex justify-between text-xs py-1 border-b border-nexus-border/50">
                      <span className="text-nexus-text-muted truncate max-w-xs">{uid}</span>
                      <span className="font-mono text-nexus-text">${(amt as number).toFixed(6)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-nexus-text-muted">Resets daily at midnight (server time). Set DAILY_COST_LIMIT in .env</p>
          </div>
        )}

        {/* ROUTING TAB */}
        {tab === 'routing' && (
          <div className="space-y-4">
            <p className="text-xs text-nexus-text-muted">
              Pin a role to a specific provider. When set, all requests for that role bypass auto-selection.
              Clear to return to cost-optimized auto-routing.
            </p>

            {/* Set override */}
            <div className="bg-nexus-void rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-nexus-text flex items-center gap-2"><Settings size={14}/> Set Role Override</h3>
              <div className="flex gap-2">
                <select value={newRole} onChange={e => setNewRole(e.target.value)}
                  className="flex-1 bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm text-nexus-text focus:outline-none focus:border-yellow-500">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <span className="text-nexus-text-muted self-center">→</span>
                <select value={newProvider} onChange={e => setNewProvider(e.target.value)}
                  className="flex-1 bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm text-nexus-text focus:outline-none focus:border-yellow-500">
                  <option value="">Auto (cost-optimized)</option>
                  {providers.filter(p=>p.isHealthy).map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
                <button onClick={setOverride}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm">
                  Set
                </button>
              </div>
            </div>

            {/* Current overrides */}
            <div>
              <h3 className="text-sm font-bold text-nexus-text mb-2">Active Role Overrides</h3>
              {Object.keys(overrides).length === 0 ? (
                <div className="text-xs text-nexus-text-muted py-4 text-center">
                  No overrides — all roles using auto cost-optimized routing
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(overrides).map(([role, pid]) => (
                    <div key={role} className="flex items-center justify-between bg-nexus-void rounded-lg p-3">
                      <div className="text-sm">
                        <span className="text-yellow-400 font-medium">{role}</span>
                        <span className="text-nexus-text-muted mx-2">→</span>
                        <span className="text-nexus-text">{pid}</span>
                      </div>
                      <button onClick={() => clearOverride(role)}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-900/20">
                        Clear
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Failover chain info */}
            <div className="bg-blue-950/30 border border-blue-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-blue-300 mb-2 flex items-center gap-2"><Zap size={14}/> Auto-Failover Chain</h3>
              <p className="text-xs text-blue-200">
                When a provider fails, the system automatically cascades to the next healthy provider in cost order:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {providers
                  .filter(p => p.isHealthy)
                  .sort((a,b) => ['free','low','medium','high','enterprise'].indexOf(a.capabilities?.costTier) - ['free','low','medium','high','enterprise'].indexOf(b.capabilities?.costTier))
                  .map((p, i, arr) => (
                  <React.Fragment key={p.id}>
                    <span className={`text-xs px-2 py-0.5 rounded ${tierColor(p.capabilities?.costTier)}`}>{p.id}</span>
                    {i < arr.length-1 && <span className="text-nexus-text-faint self-center">→</span>}
                  </React.Fragment>
                ))}
              </div>
              <p className="text-xs text-blue-300 mt-2">Exponential backoff between attempts (500ms → 1s → 1.5s)</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
