/**
 * MEMORY DASHBOARD
 * Answers CTO Audit Part 7, section 8 — confirmed completely absent (no
 * memory-specific dashboard component existed anywhere in src/components).
 *
 * All data from real server endpoints (/api/admin/memory/overview, new this
 * round; /api/memory/stats, pre-existing) — no mocks, matching the standard
 * AIProviderDashboard.tsx's own header comment sets for this codebase.
 *
 * Surfaces real backend capability built across CTO Audit Parts 5-6
 * (8-type memory taxonomy, version history, Immutable-memory signatures,
 * the Learning Approval Gate's pending queue) that had no UI until now —
 * this dashboard doesn't invent new backend logic, it exposes what already
 * exists in src/lib/memory/.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, Database, ShieldCheck, ShieldAlert, History, Clock,
  RefreshCw, CheckCircle2, AlertTriangle, Layers, Zap,
} from 'lucide-react';

interface TypeCount { type: string; count: number; cappedAt500: boolean; }
interface PendingLearningItem { id: string; source: string; confidence: number; submittedAt: string; content: string; }
interface MemoryOverview {
  byType: TypeCount[];
  versionedEntries: number;
  signedImmutable: number;
  unsignedImmutable: number;
  pendingLearningCount: number;
  pendingLearningSample: PendingLearningItem[];
}
interface BrainStats {
  totalEntries: number; stmHits: number; ltmHits: number; kbHits: number;
  totalMisses: number; hitRate: number; estimatedApiSavingsUsd: number; avgConfidenceOnHit: number;
}

// Matches the 8-type taxonomy in src/lib/memory/interfaces/MemoryTypes.ts —
// display labels only, the type keys themselves come from the API response.
const TYPE_LABELS: Record<string, string> = {
  personal: 'Personal', shared: 'Shared', immutable: 'Immutable', owner: 'Owner',
  restricted: 'Restricted', episodic: 'Episodic', semantic: 'Semantic', learning: 'Learning',
};

export const MemoryDashboard: React.FC = () => {
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [brainStats, setBrainStats] = useState<BrainStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'types' | 'integrity' | 'learning'>('types');

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [oRes, bRes] = await Promise.all([
        fetch('/api/admin/memory/overview', { headers: auth }),
        fetch('/api/memory/stats', { headers: auth }),
      ]);
      if (oRes.ok) setOverview(await oRes.json());
      else setError(`Overview fetch failed (${oRes.status})`);
      if (bRes.ok) setBrainStats(await bRes.json());
    } catch {
      setError('Could not reach the server — check your connection and try again.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const totalEntries = overview?.byType.reduce((sum, t) => sum + t.count, 0) ?? 0;

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Brain className="text-purple-400" size={22} /> Memory Dashboard
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">
            Working, Personal, Shared, Owner, Restricted, Episodic, Semantic &amp; Learning memory — one screen.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 rounded-lg flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-red-950 border border-red-800 rounded-lg text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Top strip — the "one screen" summary the audit asked for */}
      <div className="grid grid-cols-4 gap-3 p-4 pb-0">
        <SummaryCard icon={<Database size={16} className="text-purple-400" />} label="Total entries" value={totalEntries.toLocaleString()} />
        <SummaryCard icon={<History size={16} className="text-blue-400" />} label="Versioned entries" value={(overview?.versionedEntries ?? 0).toLocaleString()} />
        <SummaryCard icon={<ShieldCheck size={16} className="text-green-400" />} label="Signed immutable" value={(overview?.signedImmutable ?? 0).toLocaleString()} sublabel={overview && overview.unsignedImmutable > 0 ? `${overview.unsignedImmutable} unsigned` : undefined} />
        <SummaryCard icon={<Clock size={16} className="text-yellow-400" />} label="Pending learning" value={(overview?.pendingLearningCount ?? 0).toLocaleString()} warn={(overview?.pendingLearningCount ?? 0) > 0} />
      </div>

      <div className="flex border-b border-nexus-border mt-4">
        {(['types', 'integrity', 'learning'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
              tab === t ? 'border-purple-500 text-purple-300' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'
            }`}
          >
            {t === 'types' ? 'Memory Types' : t === 'integrity' ? 'Integrity & Versioning' : 'Learning Queue'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'types' && (
          <div className="space-y-2">
            {!overview && !loading && <EmptyState text="No data yet — click Refresh." />}
            {overview?.byType.map((t) => (
              <div key={t.type} className="bg-nexus-void border border-nexus-border rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Layers size={16} className="text-nexus-text-muted flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{TYPE_LABELS[t.type] ?? t.type}</div>
                    <div className="text-xs text-nexus-text-muted">memory_{t.type}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono">{t.count.toLocaleString()}{t.cappedAt500 ? '+' : ''}</div>
                  {t.cappedAt500 && <div className="text-[10px] text-nexus-text-muted">capped for display</div>}
                </div>
              </div>
            ))}
            {brainStats && (
              <div className="mt-4 bg-nexus-void border border-nexus-border rounded-lg p-3">
                <div className="text-xs text-nexus-text-muted mb-2 flex items-center gap-1"><Zap size={12} /> Working memory (cache) — from MemoryBrain</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>Hit rate: <span className="font-mono">{brainStats.hitRate}%</span></div>
                  <div>Avg confidence: <span className="font-mono">{brainStats.avgConfidenceOnHit}</span></div>
                  <div>Est. API savings: <span className="font-mono">${brainStats.estimatedApiSavingsUsd}</span></div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'integrity' && (
          <div className="space-y-3">
            <InfoCard
              icon={<ShieldCheck size={16} className="text-green-400" />}
              title="Digital signatures (Immutable memory)"
              body={
                overview
                  ? `${overview.signedImmutable} of ${overview.signedImmutable + overview.unsignedImmutable} immutable records are HMAC-signed. Unsigned records were written before signing was added, or IMMUTABLE_MEMORY_SIGNING_KEY wasn't configured at write time.`
                  : 'Loading…'
              }
            />
            <InfoCard
              icon={<History size={16} className="text-blue-400" />}
              title="Version history"
              body={
                overview
                  ? `${overview.versionedEntries} memory entries have at least one prior version on record and can be rolled back.`
                  : 'Loading…'
              }
            />
          </div>
        )}

        {tab === 'learning' && (
          <div className="space-y-2">
            {overview && overview.pendingLearningCount === 0 && (
              <EmptyState text="Nothing pending — every recent learning submission was high-confidence enough to auto-commit." />
            )}
            {overview?.pendingLearningSample.map((item) => (
              <div key={item.id} className="bg-nexus-void border border-nexus-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-nexus-text-muted">{item.source}</span>
                  <span className="text-xs font-mono text-yellow-400">{Math.round(item.confidence * 100)}% confidence</span>
                </div>
                <div className="text-sm text-nexus-text line-clamp-2">{item.content}</div>
                <div className="text-[10px] text-nexus-text-muted mt-1">{new Date(item.submittedAt).toLocaleString()}</div>
              </div>
            ))}
            {overview && overview.pendingLearningCount > overview.pendingLearningSample.length && (
              <div className="text-xs text-nexus-text-muted text-center py-2">
                +{overview.pendingLearningCount - overview.pendingLearningSample.length} more pending — showing the first {overview.pendingLearningSample.length}.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryCard: React.FC<{ icon: React.ReactNode; label: string; value: string; sublabel?: string; warn?: boolean }> = ({ icon, label, value, sublabel, warn }) => (
  <div className={`bg-nexus-void border rounded-lg p-3 ${warn ? 'border-yellow-800' : 'border-nexus-border'}`}>
    <div className="flex items-center gap-1.5 text-xs text-nexus-text-muted mb-1">{icon} {label}</div>
    <div className="text-lg font-bold">{value}</div>
    {sublabel && <div className="text-[10px] text-yellow-500 mt-0.5">{sublabel}</div>}
  </div>
);

const InfoCard: React.FC<{ icon: React.ReactNode; title: string; body: string }> = ({ icon, title, body }) => (
  <div className="bg-nexus-void border border-nexus-border rounded-lg p-3">
    <div className="flex items-center gap-2 text-sm font-medium mb-1">{icon} {title}</div>
    <div className="text-xs text-nexus-text-muted leading-relaxed">{body}</div>
  </div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-center py-8 text-nexus-text-muted text-sm flex flex-col items-center gap-2">
    <CheckCircle2 size={20} className="text-nexus-text-faint" />
    {text}
  </div>
);

export default MemoryDashboard;
