/**
 * SECURITY OPS APP — Phase M
 * Admin UI for JWT sessions, security events, anomaly summary.
 * All data from real server endpoints. No mocks.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, ShieldAlert, AlertTriangle, CheckCircle, RefreshCw,
  Smartphone, Globe, Ban, Activity, Clock,
} from 'lucide-react';

interface SecurityEvent { id?: string; type: string; severity: 'low'|'medium'|'high'|'critical'; uid?: string; ipAddress?: string; detail: string; createdAt?: string; }
interface Summary { total: number; bySeverity: Record<string, number>; byType: Record<string, number>; }
interface Session { uid: string; role: string; issuedAt: string; expiresAt: string; ipAddress?: string; deviceFingerprint?: string; revoked: boolean; }

export const SecurityOpsApp: React.FC = () => {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tab, setTab] = useState<'events'|'sessions'>('events');
  const [loading, setLoading] = useState(false);

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, sRes, sessRes] = await Promise.all([
        fetch('/api/admin/security/events?limit=100', { headers: auth }),
        fetch('/api/admin/security/summary?days=7', { headers: auth }),
        fetch('/api/admin/security/sessions', { headers: auth }),
      ]);
      if (eRes.ok) { const d = await eRes.json(); setEvents(d.events ?? []); }
      if (sRes.ok) setSummary(await sRes.json());
      if (sessRes.ok) { const d = await sessRes.json(); setSessions(d.sessions ?? []); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [refresh]);

  const severityColor = (s: string) =>
    s === 'critical' ? 'bg-red-950 border-red-700 text-red-300' :
    s === 'high'      ? 'bg-orange-950 border-orange-700 text-orange-300' :
    s === 'medium'    ? 'bg-yellow-950 border-yellow-700 text-yellow-300' :
    'bg-blue-950 border-blue-700 text-blue-300';

  const typeIcon = (t: string) =>
    t === 'brute_force' ? <Ban size={13}/> :
    t === 'bot_traffic' ? <Activity size={13}/> :
    t === 'new_device_login' || t === 'token_device_mismatch' ? <Smartphone size={13}/> :
    t === 'impossible_travel' ? <Globe size={13}/> :
    <ShieldAlert size={13}/>;

  const revokeAll = async (uid: string) => {
    if (!confirm(`Revoke ALL sessions for ${uid}?`)) return;
    try {
      const r = await fetch(`/api/admin/auth/revoke-all/${uid}`, { method: 'POST', headers: auth });
      const d = await r.json();
      if (d.success) await refresh();
    } catch { /* silent */ }
  };

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">

      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="text-red-400" size={22}/> Security Operations
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">JWT sessions · Anomaly detection · Bot &amp; brute-force monitoring</p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3 p-4 border-b border-nexus-border">
          {[
            { label: 'Critical', value: summary.bySeverity.critical ?? 0, color: 'text-red-400' },
            { label: 'High',     value: summary.bySeverity.high ?? 0,     color: 'text-orange-400' },
            { label: 'Medium',   value: summary.bySeverity.medium ?? 0,   color: 'text-yellow-400' },
            { label: 'Total (7d)', value: summary.total,                  color: 'text-nexus-text' },
          ].map((s,i) => (
            <div key={i} className="bg-nexus-void rounded-xl p-3">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-nexus-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex border-b border-nexus-border">
        {(['events','sessions'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm capitalize border-b-2 transition-colors ${tab===t ? 'border-red-500 text-red-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
            {t === 'sessions' ? `Active Sessions (${sessions.length})` : `Security Events`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">

        {tab === 'events' && (
          events.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle size={32} className="mx-auto mb-2 text-green-500 opacity-60"/>
              <p className="text-sm text-nexus-text-muted">No security events recorded</p>
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((e, i) => (
                <div key={e.id ?? i} className={`rounded-xl p-3 border ${severityColor(e.severity)}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm flex items-center gap-1.5">{typeIcon(e.type)} {e.type.replace(/_/g,' ')}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-nexus-void/30 uppercase">{e.severity}</span>
                  </div>
                  <div className="text-xs">{e.detail}</div>
                  <div className="text-xs opacity-60 mt-1 flex gap-3">
                    {e.uid && <span>uid: {e.uid}</span>}
                    {e.ipAddress && <span>ip: {e.ipAddress}</span>}
                    {e.createdAt && <span>{new Date(e.createdAt).toLocaleString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'sessions' && (
          sessions.length === 0 ? (
            <div className="text-center py-12 text-nexus-text-muted text-sm">No active sessions</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-nexus-text-muted border-b border-nexus-border">
                  <th className="pb-2">User</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Issued</th>
                  <th className="pb-2">Expires</th>
                  <th className="pb-2">IP</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s, i) => (
                  <tr key={i} className="border-b border-nexus-border/50">
                    <td className="py-2">{s.uid}</td>
                    <td className="py-2 capitalize">{s.role}</td>
                    <td className="py-2 text-nexus-text-muted">{new Date(s.issuedAt).toLocaleString()}</td>
                    <td className="py-2 text-nexus-text-muted">{new Date(s.expiresAt).toLocaleDateString()}</td>
                    <td className="py-2 text-nexus-text-muted">{s.ipAddress ?? '—'}</td>
                    <td className="py-2">
                      <button onClick={() => revokeAll(s.uid)} className="text-red-400 hover:text-red-300 flex items-center gap-1">
                        <Ban size={12}/> Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

      </div>

      <div className="p-4 border-t border-nexus-border bg-blue-950/20">
        <p className="text-xs text-blue-300 flex items-center gap-2">
          <Clock size={12}/> Access tokens expire in 15 minutes · Refresh tokens last 30 days and are revocable
        </p>
      </div>
    </div>
  );
};
