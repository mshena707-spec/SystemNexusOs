import React, { useEffect, useState, useRef } from 'react';
import { Terminal as TerminalIcon, AlertTriangle, Info, CheckCircle } from 'lucide-react';

interface LogEntry {
  id: number;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'success';
  message: string;
  source: string;
}

export const SystemLogsPanel = () => {
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, timestamp: new Date(Date.now() - 50000).toISOString(), type: 'info', message: 'System Initialized. Boot sequence complete.', source: 'SystemBoot' },
    { id: 2, timestamp: new Date(Date.now() - 45000).toISOString(), type: 'success', message: 'Metrics Engine Online and attached to GlobalMetrics.', source: 'MetricsEngine' },
    { id: 3, timestamp: new Date(Date.now() - 40000).toISOString(), type: 'info', message: 'Omnichannel Gateway Listening on port 3000...', source: 'OmniConnector' },
    { id: 4, timestamp: new Date(Date.now() - 35000).toISOString(), type: 'info', message: 'RedisCacheAdapter connected successfully.', source: 'StorageRegistry' },
    { id: 5, timestamp: new Date(Date.now() - 10000).toISOString(), type: 'warn', message: 'High memory volatility detected, engaging garbage collection hints.', source: 'EnvironmentManager' }
  ]);
  
  const endOfLogsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto scroll to bottom
    endOfLogsRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const adminSecret = (window as any).__NEXUS_ADMIN_SECRET__ || '';
        const res = await fetch('/api/admin/logs?limit=50', {
          headers: adminSecret ? { Authorization: `Bearer ${adminSecret}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const mapped = (Array.isArray(data) ? data : data.logs ?? []).map((entry: any) => ({
            id: entry.id ?? Date.now() + Math.random(),
            timestamp: entry.timestamp ?? new Date().toISOString(),
            type: (entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : entry.level === 'info' ? 'info' : 'info') as 'info' | 'warn' | 'error' | 'success',
            message: entry.message ?? JSON.stringify(entry),
            source: entry.service ?? 'Server',
          }));
          if (mapped.length > 0) setLogs(mapped.slice(-50));
        }
      } catch { /* endpoint unavailable */ }
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 10_000);
    return () => clearInterval(interval);
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case 'warn': return <AlertTriangle size={14} className="text-amber-500" />;
      case 'error': return <AlertTriangle size={14} className="text-rose-500" />;
      case 'success': return <CheckCircle size={14} className="text-emerald-500" />;
      default: return <Info size={14} className="text-blue-500" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 font-mono text-xs text-slate-300">
      <div className="flex items-center gap-2 p-2 bg-slate-900 border-b border-slate-800 text-slate-400 shrink-0 select-none">
        <TerminalIcon size={16} /> Nexus System Console 
        <div className="flex-1" />
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Tailing</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {logs.map(log => (
          <div key={log.id} className="flex gap-3 hover:bg-slate-900/50 p-1 rounded">
            <span className="text-slate-600 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className="shrink-0 pt-0.5">{getIcon(log.type)}</span>
            <span className="text-indigo-400 shrink-0 w-32 truncate">[{log.source}]</span>
            <span className={`${log.type === 'error' ? 'text-rose-400' : log.type === 'warn' ? 'text-amber-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'} break-all`}>
              {log.message}
            </span>
          </div>
        ))}
        <div ref={endOfLogsRef} />
      </div>
    </div>
  );
};
