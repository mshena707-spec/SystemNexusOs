import React, { useState } from 'react';
import { Cpu, Server, Database, Globe, Shield, Activity, RefreshCw } from 'lucide-react';
import { GlobalProviderRegistry } from '../../../lib/ai/providers/ProviderRegistry';
import { GlobalStorage } from '../../../lib/storage/StorageRegistry';

export const AIConfigPanel = () => {
    const [activeTab, setActiveTab] = useState<'routers' | 'storage' | 'security'>('routers');
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Mock data for UI presentation based on the new Phase C & Phase E integrations
    const aiEngines = [
        { id: 'gemini-global-1', type: 'High Intelligence', status: 'Online', latency: '420ms', cost: '$0.00' },
        { id: 'local-offline-1', type: 'Eco/Fallback', status: 'Standby', latency: '~10ms', cost: 'Free' },
    ];

    const storageNodes = [
        { id: 'RedisCacheAdapter', type: 'L1 Cache', priority: 1, status: 'Active' },
        { id: 'FirebaseAdapter', type: 'L2 Persistent', priority: 2, status: 'Active' },
        { id: 'IndexedDBAdapter', type: 'L3 Offline Fallback', priority: 3, status: 'Standby' }
    ];

    const simulateTest = () => {
        setIsRefreshing(true);
        setTimeout(() => setIsRefreshing(false), 1200);
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 text-slate-800 font-sans">
            {/* Header / Tabs */}
            <div className="flex bg-white border-b border-slate-200 p-2 gap-2 shrink-0">
                <button onClick={() => setActiveTab('routers')} className={`px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 ${activeTab === 'routers' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}><Cpu size={16} /> Routing Core</button>
                <button onClick={() => setActiveTab('storage')} className={`px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 ${activeTab === 'storage' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}><Database size={16} /> Storage Chain</button>
                <button onClick={() => setActiveTab('security')} className={`px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 ${activeTab === 'security' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}><Shield size={16} /> Security</button>
                <div className="flex-1" />
                <button onClick={simulateTest} className="px-3 py-1.5 bg-slate-900 text-nexus-text text-xs rounded hover:bg-slate-800 flex items-center gap-2">
                    <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> Ping Nodes
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6">
                
                {activeTab === 'routers' && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Globe size={18} className="text-blue-500"/> Adaptive AI Router (Phase K)</h3>
                            <p className="text-sm text-slate-500 mt-1">MultiAIBrain dynamically assigns prompt requests to the most efficient provider.</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {aiEngines.map((engine) => (
                                <div key={engine.id} className="bg-white border text-sm border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="font-semibold text-slate-700">{engine.id}</div>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${engine.status === 'Online' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{engine.status}</span>
                                    </div>
                                    <div className="text-slate-500 mb-4">{engine.type}</div>
                                    <div className="flex justify-between text-slate-600 border-t border-slate-100 pt-3">
                                        <span className="flex items-center gap-1"><Activity size={14}/> {engine.latency}</span>
                                        <span className="font-mono text-xs bg-slate-100 px-2 rounded">{engine.cost}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-6 text-sm text-amber-800">
                            <strong>Note:</strong> ProviderRegistry auto-detects offline mode and routes strictly to 'local-offline-1'.
                        </div>
                    </div>
                )}

                {activeTab === 'storage' && (
                    <div className="space-y-6">
                         <div>
                            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Server size={18} className="text-indigo-500"/> Multi-Tier Storage Abstraction (Phase E)</h3>
                            <p className="text-sm text-slate-500 mt-1">Memory writes automatically cascade down if a higher-priority node fails.</p>
                        </div>

                        <div className="space-y-3">
                            {storageNodes.map(node => (
                                <div key={node.id} className="flex items-center justify-between bg-white border border-slate-200 p-4 rounded-lg shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                                            L{node.priority}
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-800">{node.id}</div>
                                            <div className="text-xs text-slate-500">{node.type}</div>
                                        </div>
                                    </div>
                                    <div className="text-sm font-medium text-emerald-600 flex items-center gap-1">
                                        {node.status === 'Active' ? <Activity size={14} className="animate-pulse"/> : <span className="w-2 h-2 rounded-full bg-slate-300"/>}
                                        {node.status}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'security' && (
                    <div className="flex items-center justify-center h-full text-slate-400 flex-col gap-2">
                        <Shield size={32} />
                        <p>Output Firewall Active. PII Scrubbing Enabled.</p>
                    </div>
                )}

            </div>
        </div>
    );
};
