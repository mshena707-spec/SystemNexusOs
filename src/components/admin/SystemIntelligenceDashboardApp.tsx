import React, { useEffect, useState } from 'react';
import { Activity, ShieldCheck, Zap, Coins, TrendingUp, AlertTriangle, BrainCircuit, Loader2 } from 'lucide-react';

interface Overview {
  recentActivity: Array<{ id: string; eventType: string; severity: string; timestamp: number; outcome: string; subject: { id: string; type: string } }>;
  queue: { pending: number; processing: number; completed: number; dlq: number; metrics: { enqueued: number; completed: number; failed: number; totalProcessingMs: number } };
  cache: { size: number; keys: string[] };
  learningBacklog: number;
  activeModes: string[];
}

const adminHeaders = () => ({
  Authorization: `Bearer ${(window as unknown as Record<string, unknown>).__NEXUS_ADMIN_SECRET__ as string ?? ''}`,
});

export const SystemIntelligenceDashboardApp = () => {
  const [capacity, setCapacity] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [spend, setSpend] = useState<any>(null);
  const [aiHealth, setAiHealth] = useState<any>(null);
  const [security, setSecurity] = useState<any>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [capRes, healthRes, spendRes, aiRes, secRes, ovRes] = await Promise.allSettled([
        fetch('/api/admin/system/capacity', { headers: adminHeaders() }),
        fetch('/api/health'),
        fetch('/api/admin/ai/spend', { headers: adminHeaders() }),
        fetch('/api/admin/ai/health', { headers: adminHeaders() }),
        fetch('/api/admin/security/summary', { headers: adminHeaders() }),
        fetch('/api/admin/system/intelligence-overview', { headers: adminHeaders() }),
      ]);
      if (capRes.status === 'fulfilled' && capRes.value.ok) setCapacity(await capRes.value.json());
      if (healthRes.status === 'fulfilled' && healthRes.value.ok) setHealth(await healthRes.value.json());
      if (spendRes.status === 'fulfilled' && spendRes.value.ok) setSpend(await spendRes.value.json());
      if (aiRes.status === 'fulfilled' && aiRes.value.ok) setAiHealth(await aiRes.value.json());
      if (secRes.status === 'fulfilled' && secRes.value.ok) setSecurity(await secRes.value.json());
      if (ovRes.status === 'fulfilled' && ovRes.value.ok) setOverview(await ovRes.value.json());
      setLoading(false);
    })();
  }, []);

  const fmtUptime = (seconds?: number) => {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const fmtMs = (ms?: number) => ms == null ? '—' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  const fmtAgo = (ts: number) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };

  const avgProcessingMs = overview?.queue.metrics.completed
    ? overview.queue.metrics.totalProcessingMs / overview.queue.metrics.completed
    : undefined;

  return (
    <div className="h-full flex flex-col bg-nexus-surface text-nexus-text overflow-y-auto">
      <div className="p-6 border-b border-nexus-border">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="text-nexus-warning" /> System Intelligence & Business Core
        </h2>
        <p className="text-sm text-nexus-text-muted mt-1">Real-time observability, cost, and automation telemetry — every number below is live, not illustrative.</p>
      </div>

      {loading ? (
        <div className="p-8 flex items-center gap-2 text-nexus-text-muted text-sm"><Loader2 size={16} className="animate-spin" /> Loading system telemetry…</div>
      ) : (
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Performance */}
        <div className="bg-nexus-surface-raised p-5 rounded-2xl border border-nexus-border">
          <h3 className="font-bold flex items-center gap-2 text-nexus-success mb-4"><Activity size={18}/> Performance Report</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">DB Write Latency (measured)</span>
              <span className="font-mono">{capacity?.capacity?.measured?.database?.measured ? `${(1000 / capacity.capacity.measured.database.writesPerSec).toFixed(0)}ms` : '—'}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Avg Job Processing</span>
              <span className="font-mono">{fmtMs(avgProcessingMs)}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Server Uptime</span>
              <span className="font-mono">{fmtUptime(health?.uptime)}</span>
            </div>
          </div>
        </div>

        {/* Cost Analysis */}
        <div className="bg-nexus-surface-raised p-5 rounded-2xl border border-nexus-border">
          <h3 className="font-bold flex items-center gap-2 text-nexus-info mb-4"><Coins size={18}/> AI Cost (Today)</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Spent Today</span>
              <span className="font-mono">${spend?.totalUsd?.toFixed(2) ?? '0.00'}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Daily Budget</span>
              <span className="font-mono">${spend?.budget?.toFixed(2) ?? '—'}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Remaining</span>
              <span className={`font-mono ${spend?.remaining < spend?.budget * 0.2 ? 'text-nexus-warning' : 'text-nexus-success'}`}>${spend?.remaining?.toFixed(2) ?? '—'}</span>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="bg-nexus-surface-raised p-5 rounded-2xl border border-nexus-border">
          <h3 className="font-bold flex items-center gap-2 text-nexus-danger mb-4"><ShieldCheck size={18}/> Security Status (24h)</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Total Events</span>
              <span className="font-mono">{security?.total ?? 0}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Critical</span>
              <span className={`font-mono ${security?.bySeverity?.critical ? 'text-nexus-danger' : 'text-nexus-success'}`}>{security?.bySeverity?.critical ?? 0}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Warnings</span>
              <span className="font-mono text-nexus-warning">{security?.bySeverity?.warn ?? 0}</span>
            </div>
          </div>
        </div>

        {/* AI Effectiveness */}
        <div className="bg-nexus-surface-raised p-5 rounded-2xl border border-nexus-border lg:col-span-2">
          <h3 className="font-bold flex items-center gap-2 text-nexus-primary mb-4"><BrainCircuit size={18}/> AI Provider Health & Learning</h3>
          <div className="grid grid-cols-3 gap-4">
             <div className="bg-nexus-void p-3 rounded-lg text-center">
                 <div className="text-nexus-text-muted text-xs uppercase mb-1">Healthy Providers</div>
                 <div className="text-2xl font-bold text-nexus-text tracking-tight">{aiHealth?.healthy ?? 0}/{aiHealth?.total ?? 0}</div>
             </div>
             <div className="bg-nexus-void p-3 rounded-lg text-center border border-nexus-danger/20">
                 <div className="text-nexus-text-muted text-xs uppercase mb-1">Failed Jobs (queue)</div>
                 <div className="text-2xl font-bold text-nexus-danger tracking-tight">{overview?.queue.metrics.failed ?? 0}</div>
             </div>
             <div className="bg-nexus-void p-3 rounded-lg text-center border border-nexus-success/20">
                 <div className="text-nexus-text-muted text-xs uppercase mb-1">Completed Jobs</div>
                 <div className="text-2xl font-bold text-nexus-success tracking-tight">{overview?.queue.metrics.completed ?? 0}</div>
             </div>
          </div>
          <div className="mt-4 text-xs text-nexus-text-faint flex items-center gap-2">
             <AlertTriangle size={14} className="text-nexus-warning"/> {overview?.learningBacklog ?? 0} AI response evaluations queued for the next learning-approval review.
          </div>
        </div>

        {/* Business Automation */}
        <div className="bg-nexus-surface-raised p-5 rounded-2xl border border-nexus-border">
          <h3 className="font-bold flex items-center gap-2 text-nexus-secondary mb-4"><TrendingUp size={18}/> Automation</h3>
           <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Cached Entries (L1)</span>
              <span className="font-mono text-nexus-text">{overview?.cache.size ?? 0}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Jobs Queued (total)</span>
              <span className="font-mono text-nexus-success">{overview?.queue.metrics.enqueued ?? 0}</span>
            </div>
            <div className="flex justify-between items-center bg-nexus-void p-2 rounded">
              <span className="text-nexus-text-muted">Active Mode</span>
              <span className="font-mono text-nexus-text bg-nexus-primary-muted px-2 py-0.5 rounded text-xs capitalize">
                {overview?.activeModes.length ? overview.activeModes.join(' + ') : 'Custom (Feature Manager)'}
              </span>
            </div>
          </div>
        </div>

        {/* Live Control Center & Alerts — real audit trail, not scripted lines */}
        <div className="bg-nexus-surface-raised p-5 rounded-2xl border border-nexus-border lg:col-span-3">
          <h3 className="font-bold flex items-center gap-2 text-nexus-info mb-4"><ShieldCheck size={18}/> Recent System Activity</h3>
          {overview?.recentActivity.length ? (
            <div className="bg-nexus-void/50 p-4 rounded-lg text-sm font-mono space-y-1.5 max-h-64 overflow-y-auto">
              {overview.recentActivity.map((e) => (
                <div key={e.id} className={e.severity === 'critical' ? 'text-nexus-danger' : e.severity === 'warn' ? 'text-nexus-warning' : 'text-nexus-text-muted'}>
                  [{fmtAgo(e.timestamp)}] {e.severity === 'critical' && '⚠️ '}{e.eventType} — {e.subject.type}:{e.subject.id} ({e.outcome})
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-nexus-text-faint">No recent audit activity.</p>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
