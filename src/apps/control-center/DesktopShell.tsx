import React, { useState } from 'react';
import { WindowState, WindowFrame } from './WindowFrame';
import { Terminal, AppWindow, Settings, LayoutDashboard, Cpu, Database, Network, Clock, Shield, LogIn } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { AIConfigPanel } from './apps/AIConfigPanel';
import { SystemLogsPanel } from './apps/SystemLogsPanel';
import { TaskSchedulerApp } from '../../components/admin/TaskSchedulerApp';
import { NerveCenterApp } from '../../components/admin/NerveCenterApp';
import { ProductManagerApp } from '../../components/admin/ProductManagerApp';
import { OrderManagerApp } from '../../components/admin/OrderManagerApp';
import { UserManagerApp } from '../../components/admin/UserManagerApp';
import { DatabaseManagerApp } from '../../components/admin/DatabaseManagerApp';
import { SecurityBotApp } from '../../components/admin/SecurityBotApp';
import { MarketingAgentApp } from '../../components/admin/MarketingAgentApp';
import { DeveloperAPIHubApp } from '../../components/admin/DeveloperAPIHubApp';
import { TraceViewerApp } from '../../components/admin/TraceViewerApp';
import { CategoryManagerApp } from '../../components/admin/CategoryManagerApp';
import { CTOChatApp } from '../../components/admin/CTOChatApp';
import { ChatMonitorApp } from '../../components/admin/ChatMonitorApp';
import { FleetManagerApp } from '../../components/admin/FleetManagerApp';
import { GlobalSearch } from '../../components/admin/GlobalSearch';
import { AnalyticsDashboardApp } from '../../components/admin/AnalyticsDashboardApp';
import { OmnichannelHubApp } from '../../components/admin/OmnichannelHubApp';
import { HelpCenterApp } from '../../components/admin/HelpCenterApp';
import { IntegrationManagerApp } from '../../components/admin/IntegrationManagerApp';
import { TokenAnalyticsApp } from '../../components/admin/TokenAnalyticsApp';
import { SystemIntelligenceDashboardApp } from '../../components/admin/SystemIntelligenceDashboardApp';
import { OwnerControlPanel } from '../../components/admin/OwnerControlPanel';
import { OwnerAIControlApp } from '../../components/admin/OwnerAIControlApp';
import { AdminAlertsPanel } from '../../components/admin/AdminAlertsPanel';
import { DynamicPricingApp } from '../../components/admin/DynamicPricingApp';
import { LoyaltyAdminPanel } from '../../components/admin/LoyaltyAdminPanel';
import { CEOCommandCenter } from '../../components/admin/CEOCommandCenter';
import { AppStore } from '../../apps/store/AppStore';
import { LiveObservabilityDashboard } from '../../components/admin/LiveObservabilityDashboard';
import { ModeControlPanel } from '../../components/admin/ModeControlPanel';
import { Box, ShoppingCart, Users, Megaphone, Code as CodeIcon, FileText, ListTree, MessageSquare, Truck, Search, BookOpen, Activity, Zap, ShieldAlert, LayoutGrid, Eye, Bell, TrendingUp, Gift, Brain } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export const DesktopShell = () => {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [zIndexCounter, setZIndexCounter] = useState(10);
  const [isStartOpen, setIsStartOpen] = useState(false);
  const { user, userRole, loginWithGoogle } = useAuth(); // ADDED

  const isAdmin = userRole === 'admin';
  const isCeo = userRole === 'ceo';
  const isVendor = userRole === 'vendor';
  const isAllowed = isAdmin || isCeo || isVendor;

  if (!user || !isAllowed) {
    return (
      <div className="h-screen w-screen bg-nexus-void text-nexus-text flex flex-col items-center justify-center font-mono">
        <Shield className="text-blue-500 mb-6" size={64} />
        <h1 className="text-3xl font-bold tracking-wider mb-2">OS CORE AUTHENTICATION</h1>
        <p className="text-nexus-text-muted mb-8">
          {!user ? "Access to this subsystem requires elevated privileges." : "ACCESS DENIED: ADMIN PRIVILEGES REQUIRED"}
        </p>
        {!user && (
          <button onClick={loginWithGoogle} className="bg-blue-600 hover:bg-blue-500 font-bold px-8 py-3 rounded-lg flex items-center gap-2">
            <LogIn size={18} /> INITIATE GOOGLE SSO
          </button>
        )}
      </div>
    );
  }

  const bringToFront = (id: string) => {
    setZIndexCounter(prev => prev + 1);
    setWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: zIndexCounter + 1 } : w));
  };

  const openApp = (id: string, title: string, component: React.ReactNode, width: number | string = 600, height: number | string = 400) => {
    const existing = windows.find(w => w.id === id);
    if (existing) {
      setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: false, zIndex: zIndexCounter + 1 } : w));
      setZIndexCounter(prev => prev + 1);
      setIsStartOpen(false);
      return;
    }

    const newWindow: WindowState = {
      id, title, component, width, height,
      isOpen: true, isMinimized: false, isMaximized: false,
      x: 50 + (windows.length * 20), y: 50 + (windows.length * 20),
      zIndex: zIndexCounter + 1
    };

    setZIndexCounter(prev => prev + 1);
    setWindows(prev => [...prev, newWindow]);
    setIsStartOpen(false);
  };

  const handleGlobalSearchOpen = (appId: string) => {
    if (appId === 'product') openApp('product-manager', 'Product Manager', <ProductManagerApp />, 900, 650);
    if (appId === 'order') openApp('order-manager', 'Order Manager', <OrderManagerApp />, 900, 650);
    if (appId === 'user') openApp('user-manager', 'User Manager', <UserManagerApp />, 850, 600);
  };

  const closeWindow = (id: string) => setWindows(prev => prev.filter(w => w.id !== id));
  
  const minimizeWindow = (id: string) => setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: true } : w));
  
  const maximizeWindow = (id: string) => setWindows(prev => prev.map(w => w.id === id ? { ...w, isMaximized: !w.isMaximized } : w));

  return (
    <div className="w-full h-screen bg-slate-800 overflow-hidden relative flex flex-col font-sans" style={{ backgroundImage: 'linear-gradient(to bottom right, #1e293b, #0f172a)' }}>
      
      {/* Desktop Area */}
      <div className="flex-1 relative overflow-hidden" onClick={() => setIsStartOpen(false)}>
        {/* Desktop Icons */}
        <div className="absolute top-4 left-4 flex flex-col gap-6 p-4 z-0">
           {/* Desktop shortcuts */}
           {(isAdmin || isCeo) && (
           <button onClick={() => openApp('admin-dash', 'Intelligence Dashboard', <AnalyticsDashboardApp />, 850, 600)} className="flex flex-col items-center gap-2 hover:bg-white/10 p-2 rounded-lg transition-colors group">
             <div className="p-3 bg-blue-500/80 backdrop-blur-sm rounded-xl text-nexus-text shadow-lg group-hover:scale-105 transition-transform"><LayoutDashboard size={24} /></div>
             <span className="text-xs text-nexus-text drop-shadow-md font-medium text-center w-20">Analytics Dashboard</span>
           </button>
           )}
           {isAdmin && (
            <>
            <button onClick={() => openApp('ai-providers', 'AI Hardware Config', <AIConfigPanel />, 700, 500)} className="flex flex-col items-center gap-2 hover:bg-white/10 p-2 rounded-lg transition-colors group">
              <div className="p-3 bg-purple-500/80 backdrop-blur-sm rounded-xl text-nexus-text shadow-lg group-hover:scale-105 transition-transform"><Cpu size={24} /></div>
              <span className="text-xs text-nexus-text drop-shadow-md font-medium text-center w-20">AI Routing Core</span>
            </button>
            <button onClick={() => openApp('channels', 'Omnichannel Gateway', <OmnichannelHubApp />, 650, 450)} className="flex flex-col items-center gap-2 hover:bg-white/10 p-2 rounded-lg transition-colors group">
              <div className="p-3 bg-emerald-500/80 backdrop-blur-sm rounded-xl text-nexus-text shadow-lg group-hover:scale-105 transition-transform"><Network size={24} /></div>
              <span className="text-xs text-nexus-text drop-shadow-md font-medium text-center w-20">Channel Gateway</span>
            </button>
            <button onClick={() => openApp('system-logs', 'System Logs', <SystemLogsPanel />, 750, 450)} className="flex flex-col items-center gap-2 hover:bg-white/10 p-2 rounded-lg transition-colors group">
              <div className="p-3 bg-slate-700/80 backdrop-blur-sm rounded-xl text-nexus-text shadow-lg group-hover:scale-105 transition-transform"><Terminal size={24} /></div>
              <span className="text-xs text-nexus-text drop-shadow-md font-medium text-center w-20">System Logs</span>
            </button>
            </>
           )}
           {isVendor && (
            <button onClick={() => openApp('product-manager', 'Product Manager', <ProductManagerApp />, 900, 650)} className="flex flex-col items-center gap-2 hover:bg-white/10 p-2 rounded-lg transition-colors group">
              <div className="p-3 bg-orange-500/80 backdrop-blur-sm rounded-xl text-nexus-text shadow-lg group-hover:scale-105 transition-transform"><Box size={24} /></div>
              <span className="text-xs text-nexus-text drop-shadow-md font-medium text-center w-20">Manage Products</span>
            </button>
           )}
        </div>
        
        {/* Windows Rendering */}
        <AnimatePresence>
          {windows.map(win => (
            <WindowFrame 
              key={win.id} 
              windowState={win} 
              onClose={closeWindow} 
              onMinimize={minimizeWindow} 
              onMaximize={maximizeWindow}
              onFocus={bringToFront}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Start Menu Overlay */}
      <AnimatePresence>
        {isStartOpen && (
          <div className="absolute bottom-14 left-2 w-64 bg-white/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-200 p-2 z-[9999]">
             <div className="p-3 border-b text-sm font-bold text-nexus-text-faint">Nexus OS Enterprise</div>
             <div className="py-2 flex flex-col gap-1 overflow-y-auto max-h-[60vh] scrollbar-thin">
                {isAdmin && (
                  <>
                  <div className="px-3 py-1 text-xs font-bold text-nexus-text-muted uppercase tracking-widest mt-2">Core Systems</div>
                  <button onClick={() => openApp('owner-control', 'Owner Control Panel', <OwnerControlPanel />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-red-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><ShieldAlert size={16} className="text-red-500"/> Owner Control</button>
                  <button onClick={() => openApp('owner-ai-control', 'Owner AI Control Center', <OwnerAIControlApp />, 920, 680)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-purple-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><Zap size={16} className="text-purple-600"/> AI Control Center</button>
                  <button onClick={() => openApp('admin-alerts', 'Admin Alerts', <AdminAlertsPanel />, 700, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-amber-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><Bell size={16} className="text-amber-500"/> Admin Alerts</button>
                  <button onClick={() => openApp('dynamic-pricing', 'Dynamic Pricing', <DynamicPricingApp />, 900, 660)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-teal-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><TrendingUp size={16} className="text-teal-600"/> Dynamic Pricing</button>
                  <button onClick={() => openApp('loyalty-admin', 'Loyalty Admin', <LoyaltyAdminPanel />, 800, 620)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-yellow-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><Gift size={16} className="text-yellow-600"/> Loyalty & Recovery</button>
                  <button onClick={() => openApp('ceo-command', 'CEO Command Center', <CEOCommandCenter />, 960, 700)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><Brain size={16} className="text-indigo-600"/> CEO Command Center</button>
                  <button onClick={() => openApp('mode-control', 'Tri-Mode Control', <ModeControlPanel />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><Cpu size={16} className="text-indigo-500"/> Operating Modes</button>
                  <button onClick={() => openApp('live-observability', 'Live Observability Matrix', <LiveObservabilityDashboard />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint font-bold"><Eye size={16} className="text-blue-500"/> Live Observability</button>
                  <button onClick={() => openApp('sys-intel', 'System Intelligence', <SystemIntelligenceDashboardApp />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Zap size={16} /> Ops & Intelligence</button>
                  <button onClick={() => openApp('system-logs', 'System Console Logs', <SystemLogsPanel />, 750, 450)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Terminal size={16} /> Console</button>
                  </>
                )}

                {(isAdmin || isCeo) && (
                  <>
                  <button onClick={() => openApp('admin-dash', 'Analytics Dashboard', <AnalyticsDashboardApp />, 850, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><LayoutDashboard size={16} /> Analytics</button>
                  <button onClick={() => openApp('token-analytics', 'Token & Cost Analytics', <TokenAnalyticsApp />, 850, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Activity size={16} /> Token Analytics</button>
                  <button onClick={() => openApp('nerve-center', 'Nerve Center', <NerveCenterApp />, 800, 550)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Database size={16} /> Nerve Center</button>
                  </>
                )}

                {(isAdmin || isVendor) && (
                  <>
                  <div className="px-3 py-1 text-xs font-bold text-nexus-text-muted uppercase tracking-widest mt-2 border-t pt-2">Management</div>
                  <button onClick={() => openApp('product-manager', 'Product Manager', <ProductManagerApp />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Box size={16} /> Products</button>
                  <button onClick={() => openApp('order-manager', 'Order Manager', <OrderManagerApp />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><ShoppingCart size={16} /> Orders</button>
                  <button onClick={() => openApp('help-center', 'Documentation & Guides', <HelpCenterApp />, 850, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><BookOpen size={16} /> Help Center</button>
                  <button onClick={() => openApp('chat-monitor', 'Customer Intercom', <ChatMonitorApp />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><MessageSquare size={16} /> Customer Chat</button>
                  </>
                )}

                {isAdmin && (
                  <>
                  <button onClick={() => openApp('category-manager', 'Category Manager', <CategoryManagerApp />, 900, 650)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><ListTree size={16} /> Categories</button>
                  <button onClick={() => openApp('user-manager', 'User Manager', <UserManagerApp />, 850, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Users size={16} /> Users</button>
                  <button onClick={() => openApp('db-manager', 'Database Manager', <DatabaseManagerApp />, 850, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Database size={16} /> DB Explorer</button>
                  
                  <div className="px-3 py-1 text-xs font-bold text-nexus-text-muted uppercase tracking-widest mt-2 border-t pt-2">Operations & Fleet</div>
                  <button onClick={() => openApp('fleet-manager', 'Fleet Manager', <FleetManagerApp />, 1000, 700)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Truck size={16} /> Fleet Manager</button>
                  </>
                )}

                {(isAdmin || isCeo) && (
                  <>
                  <div className="px-3 py-1 text-xs font-bold text-nexus-text-muted uppercase tracking-widest mt-2 border-t pt-2">AI Agents & Tools</div>
                  <button onClick={() => openApp('cto-chat', 'AI CTO Agent', <CTOChatApp />, 800, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><CodeIcon size={16} /> AI CTO Chat</button>
                  <button onClick={() => openApp('marketing-agent', 'Marketing Agent', <MarketingAgentApp />, 800, 600)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 rounded-lg text-sm text-left text-nexus-text-faint"><Megaphone size={16} /> Marketing Expert</button>
                  </>
                )}
             </div>
          </div>
        )}
      </AnimatePresence>

      {/* Taskbar */}
      <div className="h-12 bg-white/90 backdrop-blur-md border-t border-gray-200 flex items-center px-2 shrink-0 z-[5000]">
        <button 
          onClick={() => setIsStartOpen(!isStartOpen)}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors text-blue-600"
        >
          <AppWindow size={20} />
        </button>
        <div className="w-px h-6 bg-gray-300 mx-2" />
        <div className="relative group">
           <div className="flex items-center bg-gray-100 hover:bg-gray-200 text-nexus-text-muted rounded-md px-3 py-1.5 text-xs transition-colors cursor-pointer mr-2">
             <Search size={14} className="mr-2" />
             Search OS...
           </div>
           {/* We just invoke it here absolutely positioned above */}
           <div className="absolute bottom-full left-0 mb-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto w-64 pb-2">
              <GlobalSearch onOpenApp={handleGlobalSearchOpen} />
           </div>
        </div>
        <div className="flex gap-1 flex-1 overflow-x-auto">
          {windows.map(win => (
            <button 
              key={win.id}
              onClick={() => {
                if (win.isMinimized) {
                  bringToFront(win.id);
                  setWindows(prev => prev.map(w => w.id === win.id ? { ...w, isMinimized: false } : w));
                } else if (win.zIndex === zIndexCounter) {
                  minimizeWindow(win.id);
                } else {
                  bringToFront(win.id);
                }
              }}
              className={`px-3 py-1.5 text-xs rounded border max-w-[150px] truncate transition-colors flex items-center gap-2
                ${win.zIndex === zIndexCounter && !win.isMinimized ? 'bg-blue-100 border-blue-300 text-blue-900 shadow-inner' : 'bg-white border-gray-200 text-nexus-text-faint hover:bg-gray-50'}`}
            >
              <span className="truncate">{win.title}</span>
            </button>
          ))}
        </div>
        <div className="px-4 text-xs font-medium text-nexus-text-muted">
          Nexus v2.0
        </div>
      </div>

    </div>
  );
};
