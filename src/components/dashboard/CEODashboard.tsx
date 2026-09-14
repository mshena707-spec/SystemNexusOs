import React, { useState, useEffect } from 'react';
import { useFeatureGate } from '../../lib/core/security/FeatureGate';
import { MemoryCore } from '../../lib/core/MemoryCore';
import { ShieldAlert, Database, BrainCircuit, Activity, Lock, Unlock, FileText, ToggleLeft, ToggleRight } from 'lucide-react';

export function CEODashboard() {
  const { role, features, toggleFeature, toggleAll } = useFeatureGate();
  const [vaultStats, setVaultStats] = useState({ totalEntries: 0, encryptedEntries: 0, signedEntries: 0, oldestEntryAge: 'unknown', vaultIntegrity: 'unknown' as 'healthy' | 'degraded' | 'unknown' });
  const [vaultLogs, setVaultLogs] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  useEffect(() => {
    refreshVault();
  }, []);

  const refreshVault = async () => {
    setVaultStats(MemoryCore.getVaultStats());
    setVaultLogs(await MemoryCore.fetchVaultLogs());
  };

  const handleReadLog = async (log: any) => {
    const data = await MemoryCore.readArchive(log);
    setSelectedLog({ meta: log, data });
  };

  const handleDownloadLog = async (log: any) => {
    const data = await MemoryCore.readArchive(log);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${log.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fireTestCompression = async () => {
      const mockData = Array.from({length: 1000}, (_, i) => ({ 
          id: i, 
          message: "The quick brown fox jumps over the lazy dog. Enterprise grade systems require advanced capabilities.",
          metadata: { timestamp: new Date().toISOString(), path: 'node_A_to_node_B', complexity: (i % 10) / 10 }
      }));
      await MemoryCore.packAndArchive({
        userId: 'ceo_manual_test', role: 'system',
        prompt: 'Manual compression test', response: JSON.stringify(mockData),
      }, { source: 'CEO_Manual_Test' });
      refreshVault();
  };

  if (role !== 'ceo' && role !== 'admin') {
     return (
       <div className="flex flex-col items-center justify-center p-12 text-red-500 bg-red-50/50 rounded-2xl border border-red-100">
          <ShieldAlert className="w-16 h-16 mb-4" />
          <h2 className="text-2xl font-bold tracking-tight">Access Denied</h2>
          <p className="mt-2 text-red-400">Classified Enterprise Dashboard. Owner/CEO clearance required.</p>
       </div>
     );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
            <Lock className="w-6 h-6 text-indigo-600" />
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Enterprise Command Center</h1>
        </div>
        <p className="text-slate-500 text-sm">Welcome, Executive. Master override and deep system analytics are active.</p>
      </header>

      {/* Global Features Matrix */}
      <section className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
        <div className="flex justify-between items-end mb-6">
            <div>
                <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-emerald-500" />
                    Global Feature Matrix
                </h2>
                <p className="text-slate-500 text-sm mt-1">Activate or suspend enterprise modules globally.</p>
            </div>
            <div className="flex gap-4">
               <button onClick={() => toggleAll(true)} className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors">Enable All</button>
               <button onClick={() => toggleAll(false)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors">Suspend All</button>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(features).map(([key, isEnabled]) => (
                <div key={key} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                   <div>
                       <p className="font-medium text-slate-700 font-mono text-sm">{key}</p>
                       <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                           {isEnabled ? 'ACTIVE' : 'SUSPENDED'}
                       </span>
                   </div>
                   <button onClick={() => toggleFeature(key as any, !isEnabled)} className="text-slate-400 hover:text-indigo-600 transition-colors">
                       {isEnabled ? <ToggleRight className="w-8 h-8 text-emerald-500" /> : <ToggleLeft className="w-8 h-8" />}
                   </button>
                </div>
            ))}
        </div>
      </section>

      {/* Cognitive Vault (Hyper Compression) */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
        <div className="lg:col-span-1 bg-indigo-900 rounded-3xl p-8 text-white shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
                <Database className="w-32 h-32" />
            </div>
            <h2 className="text-2xl font-bold relative z-10">Cognitive Vault</h2>
            <p className="text-indigo-200 text-sm mt-2 relative z-10">90% Hyper-Compression Engine</p>
            
            <div className="mt-8 space-y-4 relative z-10">
                <div className="bg-indigo-950/50 p-4 rounded-xl border border-indigo-800/50">
                    <p className="text-indigo-300 text-xs uppercase tracking-wider">Total Vault Entries</p>
                    <p className="text-3xl font-mono mt-1">{vaultStats.totalEntries}</p>
                </div>
                <div className="bg-emerald-950/50 p-4 rounded-xl border border-emerald-800/50">
                    <p className="text-emerald-300 text-xs uppercase tracking-wider">Encrypted / Signed</p>
                    <p className="text-3xl font-mono mt-1 text-emerald-400">{vaultStats.encryptedEntries} / {vaultStats.signedEntries}</p>
                </div>
                <div className="bg-indigo-950/50 p-4 rounded-xl border border-indigo-800/50 flex justify-between items-center">
                    <div>
                        <p className="text-indigo-300 text-xs uppercase tracking-wider">Vault Integrity · Oldest Entry</p>
                        <p className="text-xl font-mono mt-1 capitalize">{vaultStats.vaultIntegrity} · {vaultStats.oldestEntryAge}</p>
                    </div>
                    <BrainCircuit className="w-8 h-8 text-indigo-400" />
                </div>
            </div>

            <button onClick={fireTestCompression} className="w-full mt-6 bg-white text-indigo-900 py-3 rounded-xl font-semibold hover:bg-indigo-50 transition-colors">
                Run Compression Test
            </button>
        </div>

        <div className="lg:col-span-2 bg-white rounded-3xl p-8 border border-slate-200 flex flex-col">
            <h2 className="text-xl font-semibold text-slate-800 mb-6 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-500" />
                Vault Access (One-Click Read)
            </h2>

            {selectedLog ? (
                <div className="flex-1 border bg-slate-900 rounded-2xl p-4 overflow-auto relative max-h-[400px]">
                    <div className="absolute top-4 right-4 flex gap-2">
                        <button onClick={() => handleDownloadLog(selectedLog.meta)} className="text-slate-400 hover:text-white bg-slate-800 px-3 py-1 rounded-lg text-sm">Download</button>
                        <button onClick={() => setSelectedLog(null)} className="text-slate-400 hover:text-white bg-slate-800 px-3 py-1 rounded-lg text-sm">Close</button>
                    </div>
                    <p className="text-emerald-400 font-mono text-xs mb-4 mt-8">Decrypted payload from: {selectedLog.meta.timestamp}</p>
                    <pre className="text-slate-300 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(selectedLog.data, null, 2)}</pre>
                </div>
            ) : (
                <div className="flex-1 overflow-auto">
                    <div className="grid grid-cols-5 gap-4 px-4 py-3 bg-slate-50 border-y border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <div className="col-span-2">Archive ID</div>
                        <div>Original</div>
                        <div>Compressed</div>
                        <div>Action</div>
                    </div>
                    {vaultLogs.length === 0 ? (
                        <div className="text-center py-12 text-slate-400 text-sm">No archives found. Run a test.</div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {vaultLogs.map((log) => (
                                <div key={log.id} className="grid grid-cols-5 gap-4 px-4 py-4 items-center text-sm font-mono hover:bg-slate-50">
                                    <div className="col-span-2 text-slate-600 truncate pr-4" title={log.id}>{log.id}</div>
                                    <div className="text-slate-500">{log.originalSizeKB.toFixed(1)} KB</div>
                                    <div className="text-emerald-600 font-medium">{log.compressedSizeKB.toFixed(1)} KB</div>
                                    <div className="flex gap-2">
                                        <button onClick={() => handleReadLog(log)} className="text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 font-sans font-medium text-xs transition-colors">
                                           Read
                                        </button>
                                        <button onClick={() => handleDownloadLog(log)} className="text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 font-sans font-medium text-xs transition-colors">
                                           Download
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
      </section>
    </div>
  );
}
