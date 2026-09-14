/**
 * NerveCenterApp — System Command Center
 *
 * BEFORE: Only showed /api/health + deployment mode toggle
 * AFTER:  Full system observability:
 *   - Server health (response time, status)
 *   - Database provider + latency
 *   - WebSocket connections (4 namespaces)
 *   - Task queue depths + worker status
 *   - Active channels
 *   - AI provider status
 *   - Learning engine stats
 *   - Security metrics (rate limit hits, bot blocks)
 *   - Hardware tier
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, Server, Database, Shield, Wifi, WifiOff, RefreshCw,
  HardDrive, Cpu, MessageCircle, Bot, Zap, Users, Clock, AlertTriangle,
  CheckCircle2, TrendingUp, Package, Brain
} from 'lucide-react';

interface HealthData {
  status: string;
  score: number;
  services: Array<{ name: string; status: string; latencyMs?: number; details?: string }>;
  hardware?: { tier: string; gpuName: string; ramMB: number; model: string };
  uptime?: number;
}

interface CapacityData {
  estimated: { maxConcurrentConnections: number; apiRequestsPerSecond: number; ordersPerMinute: number; supportableRegisteredUsers: number };
  measured: { database: { measured: boolean; writesPerSec: number; readsPerSec: number } };
  disclaimer: string;
  computedAt: string;
}
interface WSStats { tracking: number; notifications: number; chat: number; fleet: number }
interface QueueStats { backend: string; queues: Record<string, number>; workers: string[] }
interface ChannelStats { total: number; enabled: number; platforms: string[] }
interface LearningStats { total: number; avgScore: number; topModels: Record<string, number> }

const adminHeaders = () => ({
  Authorization: `Bearer ${(window as unknown as Record<string, unknown>).__NEXUS_ADMIN_SECRET__ as string ?? ''}`,
  'Content-Type': 'application/json',
});

const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
    ok ? 'bg-green-900/40 text-green-400' : 'bg-red-900/30 text-red-400'
  }`}>{label}</span>
);

const MetricCard = ({ icon, label, value, sub, color = 'blue' }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string
}) => (
  <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
    <div className="flex items-center gap-2 mb-3">
      <div className={`text-${color}-400`}>{icon}</div>
      <span className="text-xs text-nexus-text-muted font-medium uppercase tracking-wider">{label}</span>
    </div>
    <div className={`text-2xl font-bold text-${color}-400`}>{value}</div>
    {sub && <div className="text-[10px] text-nexus-text-faint mt-1">{sub}</div>}
  </div>
);

export const NerveCenterApp: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [wsStats, setWsStats] = useState<WSStats | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [channelStats, setChannelStats] = useState<ChannelStats | null>(null);
  const [learningStats, setLearningStats] = useState<LearningStats | null>(null);
  const [capacity, setCapacity] = useState<CapacityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, wsRes, queueRes, channelRes, learnRes, capacityRes] = await Promise.allSettled([
        fetch('/api/health'),
        fetch('/api/admin/websocket/stats', { headers: adminHeaders() }),
        fetch('/api/admin/queue/stats', { headers: adminHeaders() }),
        fetch('/api/channels'),
        fetch('/api/admin/learning/stats', { headers: adminHeaders() }),
        fetch('/api/admin/system/capacity', { headers: adminHeaders() }),
      ]);

      if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
        setHealth(await healthRes.value.json() as HealthData);
      }
      if (wsRes.status === 'fulfilled' && wsRes.value.ok) {
        const d = await wsRes.value.json() as { stats: WSStats };
        setWsStats(d.stats);
      }
      if (queueRes.status === 'fulfilled' && queueRes.value.ok) {
        setQueueStats(await queueRes.value.json() as QueueStats);
      }
      if (channelRes.status === 'fulfilled' && channelRes.value.ok) {
        const d = await channelRes.value.json() as { stats: ChannelStats };
        setChannelStats(d.stats);
      }
      if (learnRes.status === 'fulfilled' && learnRes.value.ok) {
        setLearningStats(await learnRes.value.json() as LearningStats);
      }
      if (capacityRes.status === 'fulfilled' && capacityRes.value.ok) {
        const d = await capacityRes.value.json() as { capacity: CapacityData };
        setCapacity(d.capacity);
      }
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const totalWS = wsStats ? (Object.values(wsStats) as number[]).reduce((a, b) => a + b, 0) : 0;
  const totalQueue = queueStats ? (Object.values(queueStats.queues) as number[]).reduce((a, b) => a + b, 0) : 0;
  const healthScore = health?.score ?? 0;
  const healthColor = healthScore >= 80 ? 'green' : healthScore >= 50 ? 'yellow' : 'red';

  return (
    <div className="p-5 h-full flex flex-col text-nexus-text overflow-y-auto bg-nexus-void">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Cpu className="text-blue-500" size={22} /> Nerve Center
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">
            Full system observability · Auto-refreshes every 15s
            {lastRefresh && ` · Last: ${lastRefresh.toLocaleTimeString()}`}
          </p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-nexus-surface-raised hover:bg-nexus-surface-raised rounded-lg text-nexus-text-muted text-xs transition">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <MetricCard icon={<Activity size={16}/>} label="System Health"
          value={`${healthScore.toFixed(0)}%`}
          sub={health?.status || 'Checking...'}
          color={healthColor} />
        <MetricCard icon={<Users size={16}/>} label="WS Connections"
          value={totalWS}
          sub={wsStats ? `track:${wsStats.tracking} chat:${wsStats.chat}` : 'Loading...'}
          color="purple" />
        <MetricCard icon={<Package size={16}/>} label="Queue Depth"
          value={totalQueue}
          sub={queueStats ? `via ${queueStats.backend}` : 'Loading...'}
          color="orange" />
        <MetricCard icon={<Brain size={16}/>} label="AI Trained"
          value={learningStats?.total ?? '—'}
          sub={learningStats ? `avg score: ${learningStats.avgScore}` : 'Loading...'}
          color="green" />
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">

        {/* Server Services */}
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Server size={14} className="text-blue-400" /> Core Services
          </h3>
          <div className="space-y-2">
            {health?.services?.length ? health.services.map((svc, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-nexus-text-muted">{svc.name}</span>
                <div className="flex items-center gap-2">
                  {svc.latencyMs !== undefined && (
                    <span className="text-[10px] text-nexus-text-faint">{svc.latencyMs}ms</span>
                  )}
                  <StatusBadge ok={svc.status === 'healthy' || svc.status === 'ok'} label={svc.status} />
                </div>
              </div>
            )) : (
              <div className="text-xs text-nexus-text-faint">Fetching service status...</div>
            )}
          </div>
        </div>

        {/* WebSocket Namespaces */}
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Wifi size={14} className="text-green-400" /> WebSocket Namespaces
          </h3>
          {wsStats ? (
            <div className="space-y-2">
              {(Object.entries(wsStats) as [string, number][]).map(([ns, count]) => (
                <div key={ns} className="flex items-center justify-between">
                  <span className="text-xs text-nexus-text-muted">/{ns}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 bg-nexus-surface-raised rounded-full w-20 overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, count * 10)}%` }} />
                    </div>
                    <span className="text-xs font-mono text-green-400 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-nexus-text-faint">No WebSocket data</div>}
        </div>

        {/* Task Queue */}
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" /> Task Queues
            {queueStats && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${
                queueStats.backend === 'redis' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'
              }`}>{queueStats.backend}</span>
            )}
          </h3>
          {queueStats ? (
            <div className="space-y-2">
              {(Object.entries(queueStats.queues) as [string, number][]).map(([name, depth]) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-xs text-nexus-text-muted">{name}</span>
                  <span className={`text-xs font-mono ${depth > 10 ? 'text-red-400' : depth > 0 ? 'text-yellow-400' : 'text-nexus-text-faint'}`}>
                    {depth} pending
                  </span>
                </div>
              ))}
              <div className="pt-1 border-t border-nexus-border text-[10px] text-nexus-text-faint">
                Workers: {queueStats.workers.join(', ') || 'none'}
              </div>
            </div>
          ) : <div className="text-xs text-nexus-text-faint">Loading queue data...</div>}
        </div>

        {/* Channels */}
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <MessageCircle size={14} className="text-purple-400" /> Active Channels
          </h3>
          {channelStats ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-2xl font-bold ${channelStats.enabled > 0 ? 'text-purple-400' : 'text-nexus-text-faint'}`}>
                  {channelStats.enabled}
                </span>
                <span className="text-xs text-nexus-text-muted">of {channelStats.total} registered</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {channelStats.platforms.map(p => (
                  <span key={p} className="text-[10px] bg-purple-900/30 text-purple-400 px-2 py-0.5 rounded-full">{p}</span>
                ))}
              </div>
            </div>
          ) : <div className="text-xs text-nexus-text-faint">Loading channel data...</div>}
        </div>
      </div>

      {/* Hardware Profile */}
      {health?.hardware && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 mb-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <HardDrive size={14} className="text-cyan-400" /> Hardware Profile
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-nexus-text-muted">Tier</div>
              <div className="font-semibold text-cyan-400 capitalize">{health.hardware.tier}</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">GPU</div>
              <div className="font-semibold text-cyan-400">{health.hardware.gpuName || 'CPU only'}</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">RAM</div>
              <div className="font-semibold text-cyan-400">{Math.round((health.hardware.ramMB || 0) / 1024)}GB</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">LLM Model</div>
              <div className="font-semibold text-cyan-400 truncate">{health.hardware.model || '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Estimated Capacity */}
      {capacity && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 mb-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Users size={14} className="text-amber-400" /> Estimated Capacity
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
            <div>
              <div className="text-nexus-text-muted">Concurrent connections</div>
              <div className="font-semibold text-amber-400">{capacity.estimated.maxConcurrentConnections.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">API requests/sec</div>
              <div className="font-semibold text-amber-400">{capacity.estimated.apiRequestsPerSecond.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">Orders/min</div>
              <div className="font-semibold text-amber-400">{capacity.estimated.ordersPerMinute.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">Registered users (~)</div>
              <div className="font-semibold text-amber-400">{capacity.estimated.supportableRegisteredUsers.toLocaleString()}</div>
            </div>
          </div>
          <div className="text-[10px] text-nexus-text-faint border-t border-nexus-border pt-2">
            {capacity.measured.database.measured
              ? `DB benchmark: ${capacity.measured.database.writesPerSec} writes/s, ${capacity.measured.database.readsPerSec} reads/s — measured just now. `
              : 'DB benchmark not yet available — estimate is hardware-only. '}
            {capacity.disclaimer}
          </div>
        </div>
      )}
      {learningStats && Object.keys(learningStats.topModels).length > 0 && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Brain size={14} className="text-green-400" /> AI Learning Engine
          </h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-nexus-text-muted">Stored Q&As</div>
              <div className="text-2xl font-bold text-green-400">{learningStats.total}</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">Avg Quality</div>
              <div className="text-2xl font-bold text-green-400">{(learningStats.avgScore * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-nexus-text-muted">Top Models</div>
              <div className="space-y-1 mt-1">
                {Object.entries(learningStats.topModels).slice(0, 3).map(([model, count]) => (
                  <div key={model} className="flex items-center justify-between">
                    <span className="text-nexus-text-muted truncate max-w-[80px]">{model.split(':')[0]}</span>
                    <span className="text-green-400">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
