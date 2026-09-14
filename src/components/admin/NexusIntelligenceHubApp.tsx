import React, { useState } from 'react';
import { Cpu, Activity, ShieldAlert, TrendingUp, Zap, Sparkles, Bot, Package, Users, Truck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

export const NexusIntelligenceHubApp = () => {
  const [activeTab, setActiveTab] = useState<'swarm' | 'fraud' | 'supply' | 'surge' | 'ltv'>('swarm');

  return (
    <div className="h-full flex flex-col bg-nexus-void text-nexus-text">
      <div className="p-6 border-b border-nexus-border">
        <h2 className="text-2xl font-black text-nexus-text flex items-center gap-3">
          <Sparkles className="text-purple-500" /> Nexus Core Intelligence
        </h2>
        <p className="text-nexus-text-muted text-sm max-w-3xl mt-1">
          Phase 4 Advanced Capabilities. Manage your Autonomous Swarm, Predictive Supply Chain, Fraud Prevention, and Dynamic Economics.
        </p>
      </div>

      <div className="flex px-6 border-b border-nexus-border bg-nexus-void overflow-x-auto no-scrollbar">
        {[
          { id: 'swarm', label: 'Agent Swarm', icon: Bot },
          { id: 'fraud', label: 'Fraud Shield', icon: ShieldAlert },
          { id: 'supply', label: 'Zero-Touch Supply', icon: Package },
          { id: 'surge', label: 'Dynamic Surge', icon: Zap },
          { id: 'ltv', label: 'VIP & LTV Prediction', icon: Users },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 py-4 px-6 text-sm font-medium transition-colors relative whitespace-nowrap ${
              activeTab === tab.id ? 'text-purple-400' : 'text-nexus-text-muted hover:text-nexus-text'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
            {activeTab === tab.id && (
              <motion.div layoutId="intelTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        {/* Swarm Intelligence */ }
        {activeTab === 'swarm' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-surface border border-nexus-border rounded-xl p-6">
              <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
                <Bot className="text-blue-400" /> Autonomous Agent Swarm (Multi-Agent Cooperation)
              </h3>
              <p className="text-sm text-nexus-text-muted mb-6">
                Instead of one monolithic AI, Nexus deploys specialized micro-agents that negotiate and solve problems internally before presenting solutions.
              </p>

              <div className="relative h-64 bg-nexus-void rounded-xl border border-nexus-border-strong overflow-hidden flex items-center justify-center">
                 {/* Visual Representation of Swarm */}
                 <div className="absolute top-8 left-1/4 flex flex-col items-center">
                   <div className="w-12 h-12 rounded-full bg-blue-500/20 border border-blue-500 flex items-center justify-center z-10">
                     <Users size={20} className="text-blue-400" />
                   </div>
                   <span className="text-xs mt-2 text-nexus-text-muted font-mono">Customer Agent</span>
                 </div>

                 <div className="absolute top-8 right-1/4 flex flex-col items-center">
                   <div className="w-12 h-12 rounded-full bg-green-500/20 border border-green-500 flex items-center justify-center z-10">
                     <Truck size={20} className="text-green-400" />
                   </div>
                   <span className="text-xs mt-2 text-nexus-text-muted font-mono">Fleet Agent</span>
                 </div>

                 <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center">
                   <div className="w-12 h-12 rounded-full bg-yellow-500/20 border border-yellow-500 flex items-center justify-center z-10">
                     <Package size={20} className="text-yellow-400" />
                   </div>
                   <span className="text-xs mt-2 text-nexus-text-muted font-mono">Inventory Agent</span>
                 </div>
                 
                 <svg className="absolute inset-0 w-full h-full opacity-30" preserveAspectRatio="none">
                   <line x1="25%" y1="60px" x2="75%" y2="60px" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" />
                   <line x1="25%" y1="60px" x2="50%" y2="calc(100% - 60px)" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" style={{ animationDelay: '500ms' }} />
                   <line x1="75%" y1="60px" x2="50%" y2="calc(100% - 60px)" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" style={{ animationDelay: '250ms' }} />
                 </svg>

                 <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-purple-500/10 border border-purple-500/50 p-3 rounded-lg backdrop-blur-md max-w-sm text-center">
                   <p className="text-xs text-purple-200 font-mono">"Customer wants faster delivery. Fleet Agent confirms rider 2km away for $2 extra. Offering to customer."</p>
                 </div>
              </div>
            </div>
          </div>
        )}

        {/* Predictive Fraud Prevention */}
        {activeTab === 'fraud' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-surface border border-red-500/30 rounded-xl p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-nexus-text flex items-center gap-2">
                    <ShieldAlert className="text-red-400" /> Predictive Fraud & Fake COD Prevention
                  </h3>
                  <p className="text-sm text-nexus-text-muted mt-1">
                    AI analyzes typing speed, IP jumps, and order history to assign a Fraud Risk Score before a rider is dispatched.
                  </p>
                </div>
                <div className="bg-red-500/10 text-red-500 px-3 py-1 rounded-full text-xs font-bold border border-red-500/20 px-3 flex items-center gap-2">
                   <Activity size={14} /> Active Blocking
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { order: '#ORD-9921', user: 'Guest_992', risk: 94, reason: 'Rapid copy-paste address, 3rd failed delivery in area', action: 'Auto-Blocked COD' },
                  { order: '#ORD-9922', user: 'Kamal Hasan', risk: 12, reason: 'Consistent purchase history, verified IP', action: 'Cleared' },
                ].map((item, i) => (
                  <div key={i} className="bg-nexus-surface-raised border border-nexus-border-strong rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-nexus-text">{item.order} <span className="text-nexus-text-muted font-normal text-sm ml-2">{item.user}</span></div>
                      <div className="text-xs text-nexus-text-muted mt-1">{item.reason}</div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <div className={`text-xl font-black ${item.risk > 80 ? 'text-red-500' : 'text-green-500'}`}>{item.risk}% Risk</div>
                      <div className={`text-xs px-2 py-0.5 rounded mt-1 bg-nexus-surface-raised ${item.risk > 80 ? 'text-red-400' : 'text-green-400'}`}>{item.action}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Zero-Touch Supply Chain */}
        {activeTab === 'supply' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-surface border border-yellow-500/30 rounded-xl p-6">
              <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
                <Package className="text-yellow-400" /> Zero-Touch Supply Chain (Predictive Healing)
              </h3>
              <p className="text-sm text-nexus-text-muted mb-6">
                Nexus anticipates demand spikes using external data (weather, holidays, trends) and auto-generates Purchase Orders (POs) early.
              </p>

              <div className="bg-nexus-surface-raised border border-nexus-border-strong rounded-lg p-5">
                <div className="flex items-center gap-3 mb-4 text-blue-400">
                  <Sparkles size={20} />
                  <span className="font-bold">AI Restock Prediction Alert</span>
                </div>
                <p className="text-sm text-nexus-text mb-4">
                  "Weather API forecasts severe heatwave in Dhaka in 72 hours. Cold Beverage inventory is currently at 40%. Predicting a 300% sales spike."
                </p>
                <div className="bg-nexus-surface-raised p-4 rounded border border-nexus-border-strong flex justify-between items-center">
                  <div>
                    <div className="font-bold text-nexus-text">Draft PO #PO-X992</div>
                    <div className="text-xs text-nexus-text-muted mt-1">Supplier: Beverage Corp Ltd. | Qty: 500 cases</div>
                  </div>
                  <button className="bg-yellow-500 hover:bg-yellow-600 text-black px-4 py-2 rounded font-bold text-sm transition-colors">
                    Approve & Send PO
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Surge */}
        {activeTab === 'surge' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-surface border border-purple-500/30 rounded-xl p-6">
              <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
                <Zap className="text-purple-400" /> Dynamic Surge Economics & Pricing A/B Testing
              </h3>
              <p className="text-sm text-nexus-text-muted mb-6">
                Automated, micro-adjusted pricing based on demand, inventory shelf-life, and rider availability. Profit maximization on autopilot.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-nexus-surface-raised p-4 border border-nexus-border-strong rounded-xl flex flex-col">
                  <h4 className="text-nexus-text font-bold mb-1">Current Surge Metric</h4>
                  <div className="text-3xl font-black text-purple-500 my-2">1.2x <span className="text-sm text-nexus-text-muted font-normal">Delivery Fee</span></div>
                  <p className="text-xs text-nexus-text-muted mt-auto">Rider availability in Gulshan is low. Increased fee to incentivize fleet.</p>
                </div>
                
                <div className="bg-nexus-surface-raised p-4 border border-nexus-border-strong rounded-xl flex flex-col">
                  <h4 className="text-nexus-text font-bold mb-1">A/B Price Testing</h4>
                  <div className="mt-2 text-sm text-nexus-text">Product: Premium Headphones</div>
                  <div className="flex gap-4 mt-2">
                    <div className="flex-1 bg-green-500/10 p-2 rounded text-center border border-green-500/20">
                      <div className="text-xs text-green-400">Variant A ($99)</div>
                      <div className="font-bold text-nexus-text mt-1">4.2% CR</div>
                    </div>
                    <div className="flex-1 bg-red-500/10 p-2 rounded text-center border border-red-500/20">
                      <div className="text-xs text-red-400">Variant B ($105)</div>
                      <div className="font-bold text-nexus-text mt-1">3.9% CR</div>
                    </div>
                  </div>
                  <p className="text-xs text-nexus-text-muted mt-3 pt-2 border-t border-nexus-border-strong">AI analyzing revenue elasticity...</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LTV & VIP Tiering */}
        {activeTab === 'ltv' && (
          <div className="space-y-6 max-w-5xl">
            <div className="bg-nexus-surface border border-blue-500/30 rounded-xl p-6">
              <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
                <Users className="text-blue-400" /> Customer Lifetime Value (LTV) Prediction
              </h3>
              <p className="text-sm text-nexus-text-muted mb-6">
                Identifies high-value customers early based on micro-behaviors. Auto-tiers VIPs to receive faster routing and premium support.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-nexus-text">
                  <thead className="text-xs uppercase bg-nexus-surface-raised text-nexus-text-muted border-b border-nexus-border-strong">
                    <tr>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Predicted 12m LTV</th>
                      <th className="px-4 py-3">AI Sentiment</th>
                      <th className="px-4 py-3">Auto-Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-nexus-border">
                      <td className="px-4 py-3 font-medium text-nexus-text flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Sarah Ahmed</td>
                      <td className="px-4 py-3 text-green-400 font-mono">$1,240</td>
                      <td className="px-4 py-3">Highly Loyal</td>
                      <td className="px-4 py-3"><span className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs border border-yellow-500/30">Upgraded to VIP Routing</span></td>
                    </tr>
                    <tr className="border-b border-nexus-border">
                      <td className="px-4 py-3 font-medium text-nexus-text flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-gray-500"></div> John Doe</td>
                      <td className="px-4 py-3 text-nexus-text-muted font-mono">$45</td>
                      <td className="px-4 py-3">Deal Hunter</td>
                      <td className="px-4 py-3"><span className="bg-nexus-surface-raised text-nexus-text px-2 py-1 rounded text-xs">Standard Queue</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
