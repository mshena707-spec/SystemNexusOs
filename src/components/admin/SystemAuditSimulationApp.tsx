import React, { useState, useEffect } from 'react';
import { Activity, Server, Zap, Database, Shield, Bot, CheckCircle, AlertCircle, RefreshCw, Play, Terminal } from 'lucide-react';
import { NexusCompressionEngine } from '../../lib/core/storage/CompressionEngine';

export const SystemAuditSimulationApp = () => {
  const [isAuditing, setIsAuditing] = useState(false);
  const [logs, setLogs] = useState<{ id: number, message: string, type: 'info' | 'success' | 'warn' | 'error', time: string }[]>([]);
  const [metrics, setMetrics] = useState({
    apiLatency: 0,
    dbLatency: 0,
    compressionRatio: '0%',
    fraudBlockRate: 0,
  });

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const addLog = (message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    setLogs(prev => [{ id: Date.now() + Math.random(), message, type, time: new Date().toLocaleTimeString() }, ...prev]);
  };

  const runAudit = async () => {
    setIsAuditing(true);
    setLogs([]);
    
    // 1. Initializing
    addLog("Initiating Global System Audit & Load Simulation (Phase 1/4) 🚀", 'info');
    await new Promise(r => setTimeout(r, 1000));

    // 2. Database Load Test & Compression
    addLog("Running Stress Test on Data Vault...", 'info');
    const mockData = Array.from({length: 10000}).map((_, i) => ({ text: "Simulated chat history load testing sequence " + i }));
    const rawSize = new TextEncoder().encode(JSON.stringify(mockData)).length;
    
    const startComp = performance.now();
    const compressed = await NexusCompressionEngine.compress(mockData);
    const endComp = performance.now();
    const ratio = NexusCompressionEngine.getCompressionRatio(rawSize, compressed.length);
    
    setMetrics(m => ({ ...m, compressionRatio: ratio }));
    addLog(`Quantum Compression Result: ${(rawSize / 1024).toFixed(0)}KB to ${(compressed.length / 1024).toFixed(2)}KB (Saved ${ratio}) in ${(endComp - startComp).toFixed(0)}ms`, 'success');
    await new Promise(r => setTimeout(r, 800));

    // 3. AI NLP Routing & Latency Check — runs SERVER-SIDE via /api/admin/audit/ai-ping.
    // Previously this called `new GoogleGenAI()` directly from this client-side
    // component, reading `process.env.GEMINI_API_KEY` — unsafe in a browser
    // bundle (undefined at best, a real key-leak risk at worst if a build
    // tool ever inlined it). Phase P moved this server-side where env vars
    // belong; this component only ever sees the resulting latency number.
    addLog("Pinging Autonomous Agent Swarm (NLP Latency test)...", 'info');
    try {
      const pingRes = await fetch('/api/admin/audit/ai-ping', { method: 'POST', headers: auth });
      const pingData = await pingRes.json();
      if (pingData.ok) {
        setMetrics(m => ({ ...m, apiLatency: pingData.latencyMs }));
        addLog(`NLP Core verified. Swarm latency: ${pingData.latencyMs}ms. Agent response normal.`, 'success');
      } else {
        addLog(`Agent Ping Failed: ${pingData.error ?? 'unknown error'}. System will use offline fuzzy-logic routing.`, 'error');
      }
    } catch {
      addLog("Could not reach AI ping endpoint — server may be down.", 'error');
    }

    await new Promise(r => setTimeout(r, 800));

    // 4. Real fraud stats + DB latency from server
    addLog("Fetching real fraud detection statistics and DB health...", 'info');
    try {
      const [fraudRes, healthRes] = await Promise.all([
        fetch('/api/admin/audit/fraud-summary?hours=24', { headers: auth }),
        fetch('/api/health'),
      ]);
      if (fraudRes.ok) {
        const fraud = await fraudRes.json();
        setMetrics(m => ({ ...m, fraudBlockRate: fraud.blockRate }));
        addLog(`Fraud Engine: ${fraud.blockedLast24h} orders blocked (24h), ${fraud.flaggedUsers} users flagged, ${fraud.reviewLast24h} held for review.`, 'success');
      } else {
        addLog("Fraud summary endpoint returned an error.", 'warn');
      }
      if (healthRes.ok) {
        // HealthMonitor returns { overall, score, services: ServiceHealth[] }
        const health = await healthRes.json();
        const dbService = (health.services ?? []).find((s: any) => s.name?.includes('Database') || s.name?.includes('NexusDB'));
        if (dbService?.latencyMs != null) {
          setMetrics(m => ({ ...m, dbLatency: Math.round(dbService.latencyMs) }));
          addLog(`Database health: ${dbService.status} (${Math.round(dbService.latencyMs)}ms)`, dbService.status === 'healthy' ? 'success' : 'warn');
        }
      }
    } catch {
      addLog("Could not reach audit endpoints — server may be down.", 'error');
    }

    // 5. Completion
    addLog("Audit sequence complete. Review metrics panel for current system status.", 'success');
    setIsAuditing(false);
  };

  return (
    <div className="h-full flex flex-col bg-nexus-void text-nexus-text">
      <div className="p-6 border-b border-nexus-border flex justify-between items-center">
         <div>
          <h2 className="text-2xl font-black text-nexus-text flex items-center gap-3">
            <Activity className="text-green-500" /> Auto-Audit & Simulation Engine
          </h2>
          <p className="text-nexus-text-muted text-sm max-w-3xl mt-1">
            Replicates real-world multi-agent traffic, tests database resilience, and audits the system architecture automatically.
          </p>
         </div>
         <button 
           onClick={runAudit} 
           disabled={isAuditing}
           className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-nexus-text px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-colors"
         >
           {isAuditing ? <RefreshCw className="animate-spin" size={18} /> : <Play size={18} />}
           {isAuditing ? 'Running Diagnostic...' : 'Execute Deep Audit'}
         </button>
      </div>

      <div className="flex-1 p-6 flex flex-col lg:flex-row gap-6 overflow-hidden">
        {/* Real-time Logistics Log */}
        <div className="flex-1 bg-nexus-void border border-nexus-border rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-nexus-border bg-nexus-surface flex items-center gap-2">
            <Terminal size={18} className="text-nexus-text-muted" />
            <h3 className="font-bold text-nexus-text text-sm">Diagnostic Terminal</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
            {logs.map(log => (
              <div key={log.id} className={`flex items-start gap-3 p-2 rounded border ${
                log.type === 'info' ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' :
                log.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-300' :
                log.type === 'warn' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300' :
                'bg-red-500/10 border-red-500/20 text-red-300'
              }`}>
                <span className="text-nexus-text-muted opacity-70 shrink-0">[{log.time}]</span>
                {log.type === 'info' && <Activity size={14} className="shrink-0 mt-0.5" />}
                {log.type === 'success' && <CheckCircle size={14} className="shrink-0 mt-0.5" />}
                {log.type === 'warn' && <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                {log.type === 'error' && <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                <span className="break-words">{log.message}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-nexus-text-faint h-full flex items-center justify-center">
                Awaiting audit sequence...
              </div>
            )}
          </div>
        </div>

        {/* Metrics Dashboard */}
        <div className="w-full lg:w-80 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-nexus-void border border-nexus-border rounded-xl p-5">
             <div className="text-nexus-text-muted text-xs mb-1 flex items-center gap-2"><Bot size={14} /> AI Swarm Latency</div>
             <div className="text-3xl font-black text-nexus-text">{metrics.apiLatency} <span className="text-sm font-normal text-nexus-text-muted">ms</span></div>
          </div>
          
          <div className="bg-nexus-void border border-nexus-border rounded-xl p-5">
             <div className="text-nexus-text-muted text-xs mb-1 flex items-center gap-2"><Database size={14} /> Deep-Vault Compression</div>
             <div className="text-3xl font-black text-blue-400">{metrics.compressionRatio}</div>
          </div>

          <div className="bg-nexus-void border border-nexus-border rounded-xl p-5">
             <div className="text-nexus-text-muted text-xs mb-1 flex items-center gap-2"><Server size={14} /> Database Latency</div>
             <div className="text-3xl font-black text-purple-400">{metrics.dbLatency} <span className="text-sm font-normal text-nexus-text-muted">ms</span></div>
          </div>

          <div className="bg-nexus-void border border-nexus-border rounded-xl p-5">
             <div className="text-nexus-text-muted text-xs mb-1 flex items-center gap-2"><Shield size={14} /> Fraud Deflection</div>
             <div className="text-3xl font-black text-green-400">{metrics.fraudBlockRate}%</div>
          </div>
        </div>

      </div>
    </div>
  );
};


