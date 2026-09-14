import React, { useState } from 'react';
import { Triangle, Link, Map, Brain, Rocket, ShieldAlert, Key, Globe, EyeOff, Zap } from 'lucide-react';
import { motion } from 'motion/react';

export const NexusPyramidProtocolApp = () => {
  const [activeTab, setActiveTab] = useState<'ledger' | 'genesis_map' | 'drone' | 'sentient'>('ledger');
  const [showOwnerOverride, setShowOwnerOverride] = useState(false);

  return (
    <div className="h-full flex flex-col bg-nexus-void text-nexus-text">
      <div className="p-6 border-b border-nexus-border">
        <h2 className="text-2xl font-black text-nexus-text flex items-center gap-3">
          <Triangle className="text-amber-500" /> Phase 5: Pyramid Protocol
        </h2>
        <p className="text-nexus-text-muted text-sm max-w-3xl mt-1">
          The 7-Wonders protocol. Systems designed for absolute permanence, self-sustainability, and supreme control. 
        </p>
      </div>

      <div className="flex px-6 border-b border-nexus-border bg-nexus-void overflow-x-auto no-scrollbar">
        {[
          { id: 'ledger', label: 'Shadow Ledger', icon: Link },
          { id: 'genesis_map', label: 'Genesis Cartography', icon: Map },
          { id: 'drone', label: 'Autonomous Fleet', icon: Rocket },
          { id: 'sentient', label: 'Sentient Core', icon: Brain },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 py-4 px-6 text-sm font-medium transition-colors relative whitespace-nowrap ${
              activeTab === tab.id ? 'text-amber-500' : 'text-nexus-text-muted hover:text-nexus-text'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
            {activeTab === tab.id && (
              <motion.div layoutId="pyramidTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        
        {/* Shadow Ledger */}
        {activeTab === 'ledger' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-void border border-nexus-border rounded-xl p-6 relative overflow-hidden">
              <div className="flex justify-between items-start mb-6 relative z-10">
                <div>
                  <h3 className="text-lg font-bold text-nexus-text flex items-center gap-2">
                    <Link className="text-amber-500" /> Immutable Ledger (With Owner Exemption)
                  </h3>
                  <p className="text-sm text-nexus-text-muted mt-1 max-w-2xl">
                    Cryptographic locking of all transactions. To auditors, admins, and the system itself, the records are mathematically permanent and immutable. However, an undetectable master-key architecture exists for the Founder.
                  </p>
                </div>
                <button 
                  onDoubleClick={() => setShowOwnerOverride(!showOwnerOverride)}
                  className="px-3 py-1 bg-nexus-surface-raised rounded text-xs text-nexus-text-faint border border-nexus-border-strong hover:text-nexus-text-muted transition-colors"
                  title="Double click to reveal Founder controls"
                >
                  <EyeOff size={14} />
                </button>
              </div>

              <div className="space-y-4 relative z-10">
                {[
                  { id: 'TXN-9901A', amount: '$4,200', type: 'Payout', status: 'Locked (Hash: 0x8f...2a)', date: '2 Mins Ago' },
                  { id: 'TXN-9902B', amount: '$850', type: 'Refund', status: 'Locked (Hash: 0x1b...9c)', date: '1 Hour Ago' },
                  { id: 'TXN-9903C', amount: '$12,400', type: 'Settlement', status: 'Locked (Hash: 0xc4...5f)', date: '5 Hours Ago' },
                ].map((txn, i) => (
                  <div key={i} className="bg-nexus-surface border border-nexus-border rounded-lg p-4 flex items-center justify-between group">
                    <div>
                      <div className="font-bold text-nexus-text font-mono text-sm">{txn.id}</div>
                      <div className="text-xs text-nexus-text-muted mt-1">{txn.date} • {txn.type}</div>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div>
                        <div className="text-lg font-bold text-nexus-text">{txn.amount}</div>
                        <div className="text-xs text-amber-500/70">{txn.status}</div>
                      </div>
                      
                      {/* Hidden Founder Controls */}
                      {showOwnerOverride && (
                        <div className="flex flex-col gap-1 ml-4 border-l border-nexus-border-strong pl-4 animate-in fade-in slide-in-from-right-4">
                           <button className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded hover:bg-blue-500/20">EDIT</button>
                           <button className="text-[10px] bg-red-500/10 text-red-400 px-2 py-1 rounded hover:bg-red-500/20">ERASE</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Watermark */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[150px] font-black text-nexus-text/[0.02] pointer-events-none">
                LEDGER
              </div>
            </div>
          </div>
        )}

        {/* Genesis Map */}
        {activeTab === 'genesis_map' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-void border border-nexus-border rounded-xl p-6">
              <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
                <Globe className="text-blue-500" /> Nexus Genesis Cartography
              </h3>
              <p className="text-sm text-nexus-text-muted mb-6">
                Instead of relying solely on Google Maps, Nexus ingests third-party data and merges it with our own riders' exact GPS movements. Over time, the system draws its own highly precise, independent map.
              </p>

              <div className="h-64 bg-nexus-surface border border-nexus-border-strong rounded-xl relative overflow-hidden flex items-center justify-center">
                {/* Simulated Map Generation */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,1)_100%)] z-10 pointer-events-none" />
                
                {/* Base Grid */}
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE5IDE5SDBWMGgxOXYxOXoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzIyMiIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9zdmc+')] opacity-50" />
                
                {/* Simulated Generated Roads */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d="M 10,50 Q 30,30 50,50 T 90,50" fill="none" stroke="#2563eb" strokeWidth="0.5" className="animate-pulse" />
                  <path d="M 20,20 Q 40,80 80,80" fill="none" stroke="#3b82f6" strokeWidth="0.5" className="animate-pulse" style={{ animationDelay: '500ms' }} />
                  <path d="M 50,10 L 50,90" fill="none" stroke="#60a5fa" strokeWidth="0.2" />
                </svg>

                {/* Rider Data Points forming the map */}
                <div className="absolute top-1/4 left-1/3 w-2 h-2 bg-green-500 rounded-full animate-ping" />
                <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-green-500 rounded-full animate-ping" style={{ animationDelay: '200ms' }} />
                <div className="absolute bottom-1/3 right-1/4 w-2 h-2 bg-green-500 rounded-full animate-ping" style={{ animationDelay: '400ms' }} />

                <div className="absolute bottom-4 left-4 z-20 bg-nexus-void/80 p-3 rounded text-xs border border-nexus-border-strong font-mono">
                  <div className="text-blue-400 mb-1">Status: Generating Proprietary Map Tracks</div>
                  <div className="text-nexus-text-muted">Rider Trajectories Processed: 1,402,941</div>
                  <div className="text-nexus-text-muted">Third-Party API Dependency: <span className="text-red-400">Decreasing (-14%)</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Autonomous Fleet */}
        {activeTab === 'drone' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-void border border-nexus-border rounded-xl p-6">
              <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
                <Rocket className="text-orange-500" /> Autonomous Hardware & Physics-Engine Routing
              </h3>
              <p className="text-sm text-nexus-text-muted mb-6">
                Preparing the system to command non-human delivery fleets (Drones & Automated Ground Vehicles). Calculates physics constraints (battery weight, wind resistance, payload drops).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-nexus-surface border border-nexus-border-strong rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-nexus-text text-sm">UAV-01 (Air Fleet)</h4>
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded border border-green-500/30">Airborne</span>
                  </div>
                  <div className="space-y-2 text-xs font-mono text-nexus-text-muted">
                    <div className="flex justify-between"><span>Payload:</span> <span className="text-nexus-text">2.4 kg</span></div>
                    <div className="flex justify-between"><span>Battery:</span> <span className="text-nexus-text">68%</span></div>
                    <div className="flex justify-between"><span>Wind Resist:</span> <span className="text-nexus-text">12 knots (Optimal)</span></div>
                    <div className="flex justify-between"><span>ETA:</span> <span className="text-nexus-text">4m 12s</span></div>
                  </div>
                  <div className="mt-4 h-1.5 w-full bg-nexus-surface-raised rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500 w-[70%]" />
                  </div>
                </div>
                
                <div className="bg-nexus-surface border border-nexus-border-strong rounded-xl p-4 flex items-center justify-center text-center">
                   <div>
                     <Rocket size={40} className="text-nexus-text-faint mx-auto mb-3" />
                     <h4 className="font-bold text-nexus-text-muted">Awaiting Hardware Sync</h4>
                     <p className="text-xs text-nexus-text-faint mt-1 max-w-[200px] mx-auto">Connect DJI or custom drone SDKs via the Developer Hub to initiate live tracking.</p>
                   </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sentient Core */}
        {activeTab === 'sentient' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-void border border-nexus-border rounded-xl p-6 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 opacity-5">
                <Brain size={250} />
              </div>
              
              <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2 relative z-10">
                <Brain className="text-purple-500" /> Sentient Core (Self-Mutating Codebase)
              </h3>
              <p className="text-sm text-nexus-text-muted mb-6 relative z-10 max-w-3xl">
                The ultimate evolution. The system continuously runs profiling on its own database queries and UI bottlenecks, autonomously proposing structure changes and pushing safe code updates to its own repository.
              </p>

              <div className="bg-nexus-surface border border-nexus-border-strong rounded-xl p-0 overflow-hidden relative z-10">
                <div className="bg-nexus-surface-raised px-4 py-2 border-b border-nexus-border-strong flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-xs font-mono ml-2 text-nexus-text-muted">Core Evolution Thread</span>
                </div>
                <div className="p-4 font-mono text-xs">
                  <div className="text-green-400 mb-2">&gt; Initiating deep system trace...</div>
                  <div className="text-nexus-text-muted mb-2">&gt; Analyzing "Order Manager" component load times.</div>
                  <div className="text-yellow-400 mb-2">&gt; WARNING: Query latency increasing on indexed field `createdAt`.</div>
                  <div className="text-blue-400 mb-2">&gt; Generating composite index proposal...</div>
                  <div className="text-nexus-text mb-2 bg-nexus-surface-raised p-2 rounded">
                    <span className="text-purple-400">Proposal:</span> Implement React.lazy() on OrderDetails modal and add dynamic composite index on `[status, createdAt]`
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button className="bg-purple-600 hover:bg-purple-500 text-nexus-text px-3 py-1.5 rounded disabled:opacity-50 transition-colors">
                      Authorize Auto-Patch
                    </button>
                    <button className="bg-nexus-surface-raised text-nexus-text-muted px-3 py-1.5 rounded hover:bg-nexus-surface-raised transition-colors">
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
