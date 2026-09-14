/**
 * DATABASE PROVIDER APP — Phase E
 * Admin UI for database abstraction layer: status, migration, verification.
 * All data from real server endpoints. No mocks.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Database, CheckCircle, XCircle, RefreshCw, ArrowRight,
  AlertTriangle, Shield, Server,
} from 'lucide-react';

interface DBStatus { configuredProvider: string; activeProvider: string; healthy: boolean; latencyMs: number; }
interface DBProvider { id: string; name: string; configured: boolean; isDefault?: boolean; }
interface MigrationResult { collection: string; documentsCopied: number; errors: string[]; }
interface MigrationReport { source: string; destination: string; totalDocuments: number; results: MigrationResult[]; }
interface VerifyResult { collection: string; sourceCount: number; destCount: number; match: boolean; }

export const DatabaseProviderApp: React.FC = () => {
  const [status, setStatus]       = useState<DBStatus | null>(null);
  const [providers, setProviders] = useState<DBProvider[]>([]);
  const [loading, setLoading]     = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [migrationReport, setMigrationReport] = useState<MigrationReport | null>(null);
  const [verifyResults, setVerifyResults] = useState<VerifyResult[] | null>(null);
  const [srcProvider, setSrc] = useState('firestore');
  const [dstProvider, setDst] = useState('postgres');
  const [msg, setMsg] = useState('');

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/admin/db/status', { headers: auth }),
        fetch('/api/admin/db/providers', { headers: auth }),
      ]);
      if (sRes.ok) setStatus(await sRes.json());
      if (pRes.ok) { const d = await pRes.json(); setProviders(d.providers ?? []); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runMigration = async () => {
    if (srcProvider === dstProvider) { setMsg('❌ Source and destination must differ'); return; }
    setMigrating(true); setMsg(''); setMigrationReport(null);
    try {
      const r = await fetch('/api/admin/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ source: srcProvider, destination: dstProvider }),
      });
      const d = await r.json();
      if (d.success) {
        setMigrationReport(d.report);
        setMsg(`✅ Migrated ${d.report.totalDocuments} documents from ${srcProvider} → ${dstProvider}`);
      } else {
        setMsg(`❌ ${d.error}`);
      }
    } catch (e: any) { setMsg(`❌ Migration failed: ${e.message}`); }
    setMigrating(false);
  };

  const runVerify = async () => {
    setVerifying(true); setMsg(''); setVerifyResults(null);
    try {
      const r = await fetch('/api/admin/db/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ source: srcProvider, destination: dstProvider }),
      });
      const d = await r.json();
      setVerifyResults(d.results ?? []);
      const mismatches = (d.results ?? []).filter((r: VerifyResult) => !r.match).length;
      setMsg(mismatches === 0 ? '✅ All collections match' : `⚠️ ${mismatches} collection(s) have count mismatches`);
    } catch (e: any) { setMsg(`❌ Verify failed: ${e.message}`); }
    setVerifying(false);
  };

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">

      {/* Header */}
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Database className="text-cyan-400" size={22}/> Database Independence
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">
            Firestore · PostgreSQL · Supabase · MongoDB — pluggable via NexusDB abstraction
          </p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Current status */}
        {status && (
          <div className={`rounded-xl p-4 border ${status.healthy ? 'bg-nexus-void border-nexus-border' : 'bg-red-950/30 border-red-800'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {status.healthy ? <CheckCircle size={18} className="text-green-400"/> : <XCircle size={18} className="text-red-400"/>}
                <div>
                  <div className="font-bold text-sm">Active: {status.activeProvider}</div>
                  <div className="text-xs text-nexus-text-muted">Configured: {status.configuredProvider} · {status.latencyMs}ms</div>
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${status.healthy ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                {status.healthy ? 'Healthy' : 'Unhealthy'}
              </span>
            </div>
          </div>
        )}

        {/* Available providers */}
        <div>
          <h3 className="text-sm font-bold text-nexus-text mb-2 flex items-center gap-2"><Server size={14}/> Available Providers</h3>
          <div className="grid grid-cols-2 gap-2">
            {providers.map(p => (
              <div key={p.id} className={`rounded-lg p-3 border flex items-center justify-between ${p.configured ? 'bg-nexus-void border-nexus-border' : 'bg-nexus-void/50 border-nexus-border/50'}`}>
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    {p.name}
                    {p.id === status?.activeProvider.split(' ')[0]?.toLowerCase() && (
                      <span className="text-xs bg-cyan-900 text-cyan-300 px-1.5 rounded">active</span>
                    )}
                  </div>
                  <div className="text-xs text-nexus-text-muted mt-0.5">{p.id}</div>
                </div>
                {p.configured
                  ? <CheckCircle size={14} className="text-green-400"/>
                  : <AlertTriangle size={14} className="text-nexus-text-faint"/>}
              </div>
            ))}
          </div>
        </div>

        {msg && (
          <div className={`p-2 rounded text-xs ${msg.startsWith('✅') ? 'bg-green-900/40 text-green-300' : msg.startsWith('⚠️') ? 'bg-yellow-900/40 text-yellow-300' : 'bg-red-900/40 text-red-300'}`}>
            {msg}
          </div>
        )}

        {/* Migration tool */}
        <div className="bg-nexus-void rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-nexus-text flex items-center gap-2"><Shield size={14}/> Migration Tool</h3>
          <p className="text-xs text-nexus-text-muted">
            Copy all data from one provider to another. Source data is not deleted — this is a copy operation.
            Run "Verify" after migration to confirm document counts match.
          </p>
          <div className="flex items-center gap-2">
            <select value={srcProvider} onChange={e => setSrc(e.target.value)}
              className="flex-1 bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500">
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ArrowRight size={16} className="text-nexus-text-muted flex-shrink-0"/>
            <select value={dstProvider} onChange={e => setDst(e.target.value)}
              className="flex-1 bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500">
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={runMigration} disabled={migrating}
              className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm disabled:opacity-50">
              {migrating ? 'Migrating…' : 'Run Migration'}
            </button>
            <button onClick={runVerify} disabled={verifying}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50">
              {verifying ? 'Verifying…' : 'Verify Parity'}
            </button>
          </div>
          {!providers.find(p => p.id === dstProvider)?.configured && (
            <div className="text-xs text-yellow-400 flex items-center gap-1">
              <AlertTriangle size={12}/> Destination "{dstProvider}" is not configured — set its env vars first
            </div>
          )}
        </div>

        {/* Migration results */}
        {migrationReport && (
          <div className="bg-nexus-void rounded-xl p-4">
            <h3 className="text-sm font-bold text-nexus-text mb-2">
              Migration Report: {migrationReport.source} → {migrationReport.destination}
            </h3>
            <div className="text-xs text-nexus-text-muted mb-2">Total documents copied: <strong className="text-nexus-text">{migrationReport.totalDocuments}</strong></div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-nexus-text-muted border-b border-nexus-border">
                  <th className="pb-1">Collection</th>
                  <th className="pb-1 text-right">Copied</th>
                  <th className="pb-1 text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {migrationReport.results.filter(r => r.documentsCopied > 0 || r.errors.length > 0).map(r => (
                  <tr key={r.collection} className="border-b border-nexus-border/50">
                    <td className="py-1">{r.collection}</td>
                    <td className="py-1 text-right text-green-400">{r.documentsCopied}</td>
                    <td className="py-1 text-right">{r.errors.length > 0 ? <span className="text-red-400">{r.errors.length}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Verify results */}
        {verifyResults && (
          <div className="bg-nexus-void rounded-xl p-4">
            <h3 className="text-sm font-bold text-nexus-text mb-2">Parity Check: {srcProvider} vs {dstProvider}</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-nexus-text-muted border-b border-nexus-border">
                  <th className="pb-1">Collection</th>
                  <th className="pb-1 text-right">{srcProvider}</th>
                  <th className="pb-1 text-right">{dstProvider}</th>
                  <th className="pb-1 text-right">Match</th>
                </tr>
              </thead>
              <tbody>
                {verifyResults.filter(r => r.sourceCount > 0 || r.destCount > 0).map(r => (
                  <tr key={r.collection} className="border-b border-nexus-border/50">
                    <td className="py-1">{r.collection}</td>
                    <td className="py-1 text-right">{r.sourceCount}</td>
                    <td className="py-1 text-right">{r.destCount}</td>
                    <td className="py-1 text-right">
                      {r.match ? <CheckCircle size={12} className="text-green-400 inline"/> : <XCircle size={12} className="text-red-400 inline"/>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Architecture note */}
        <div className="bg-blue-950/30 border border-blue-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-blue-300 mb-2 flex items-center gap-2"><Database size={14}/> How it works</h3>
          <p className="text-xs text-blue-200">
            All business logic accesses data through <code className="bg-blue-900/50 px-1 rounded">NexusDB</code> —
            never directly via Firestore SDK. Switching <code className="bg-blue-900/50 px-1 rounded">DB_PROVIDER</code>
            in environment variables changes the backend with zero code changes. New databases can be added by
            implementing the <code className="bg-blue-900/50 px-1 rounded">INexusDBAdapter</code> interface.
          </p>
        </div>

      </div>
    </div>
  );
};
