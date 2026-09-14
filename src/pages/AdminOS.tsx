import React, { useState, Suspense, lazy } from 'react';
import { Shield, LayoutDashboard, Server, MessageSquare, Terminal, Package, Users, Truck, Sparkles, Mic, Triangle, Store, Activity, LogIn, Settings, DollarSign, TrendingUp, ShoppingCart, ShieldAlert, Crown, Brain, Bell, BookOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BrandThemeSettings } from '../components/admin/BrandThemeSettings';

const AnalyticsDashboardApp = lazy(() => import('../components/admin/AnalyticsDashboardApp').then(m => ({ default: m.AnalyticsDashboardApp })));
const OmnichannelHubApp = lazy(() => import('../components/admin/OmnichannelHubApp').then(m => ({ default: m.OmnichannelHubApp })));
const NerveCenterApp = lazy(() => import('../components/admin/NerveCenterApp').then(m => ({ default: m.NerveCenterApp })));
const TaskSchedulerApp = lazy(() => import('../components/admin/TaskSchedulerApp').then(m => ({ default: m.TaskSchedulerApp })));
const ProductManagerApp = lazy(() => import('../components/admin/ProductManagerApp').then(m => ({ default: m.ProductManagerApp })));
const OrderManagerApp = lazy(() => import('../components/admin/OrderManagerApp').then(m => ({ default: m.OrderManagerApp })));
const UserManagerApp = lazy(() => import('../components/admin/UserManagerApp').then(m => ({ default: m.UserManagerApp })));
const FleetManagerApp = lazy(() => import('../components/admin/FleetManagerApp').then(m => ({ default: m.FleetManagerApp })));
const TraceViewerApp = lazy(() => import('../components/admin/TraceViewerApp').then(m => ({ default: m.TraceViewerApp })));
const SystemLogsPanel = lazy(() => import('../apps/control-center/apps/SystemLogsPanel').then(m => ({ default: m.SystemLogsPanel })));
const AIConfigPanel = lazy(() => import('../apps/control-center/apps/AIConfigPanel').then(m => ({ default: m.AIConfigPanel })));
const NexusIntelligenceHubApp = lazy(() => import('../components/admin/NexusIntelligenceHubApp').then(m => ({ default: m.NexusIntelligenceHubApp })));
const NexusPyramidProtocolApp = lazy(() => import('../components/admin/NexusPyramidProtocolApp').then(m => ({ default: m.NexusPyramidProtocolApp })));
const NexusStorefrontConfigApp = lazy(() => import('../components/admin/NexusStorefrontSetup').then(m => ({ default: m.NexusStorefrontConfigApp })));
const SystemAuditSimulationApp = lazy(() => import('../components/admin/SystemAuditSimulationApp').then(m => ({ default: m.SystemAuditSimulationApp })));
const FeatureManager = lazy(() => import('../components/admin/FeatureManager').then(m => ({ default: m.FeatureManager })));

// ── Previously built but never wired into navigation — added so a non-coder
// owner can actually reach every real feature in the system, not just the 14
// that happened to get a sidebar button before. ──────────────────────────
const FinancialOSApp = lazy(() => import('../components/admin/FinancialOSApp').then(m => ({ default: m.FinancialOSApp })));
const PaymentOSApp = lazy(() => import('../components/admin/PaymentOSApp').then(m => ({ default: m.PaymentOSApp })));
const TokenAnalyticsApp = lazy(() => import('../components/admin/TokenAnalyticsApp').then(m => ({ default: m.TokenAnalyticsApp })));
const MarketingAgentApp = lazy(() => import('../components/admin/MarketingAgentApp').then(m => ({ default: m.MarketingAgentApp })));
const LoyaltyAdminPanel = lazy(() => import('../components/admin/LoyaltyAdminPanel').then(m => ({ default: m.LoyaltyAdminPanel })));
const DynamicPricingApp = lazy(() => import('../components/admin/DynamicPricingApp').then(m => ({ default: m.DynamicPricingApp })));
const ProcurementApp = lazy(() => import('../components/admin/ProcurementApp').then(m => ({ default: m.ProcurementApp })));
const SecurityOpsApp = lazy(() => import('../components/admin/SecurityOpsApp').then(m => ({ default: m.SecurityOpsApp })));
const OwnerControlPanel = lazy(() => import('../components/admin/OwnerControlPanel').then(m => ({ default: m.OwnerControlPanel })));
const OwnerAIControlApp = lazy(() => import('../components/admin/OwnerAIControlApp').then(m => ({ default: m.OwnerAIControlApp })));
const CEOCommandCenter = lazy(() => import('../components/admin/CEOCommandCenter').then(m => ({ default: m.CEOCommandCenter })));
const AIProviderDashboard = lazy(() => import('../components/admin/AIProviderDashboard').then(m => ({ default: m.AIProviderDashboard })));
const MemoryDashboard = lazy(() => import('../components/admin/MemoryDashboard').then(m => ({ default: m.MemoryDashboard })));
const DatabaseProviderApp = lazy(() => import('../components/admin/DatabaseProviderApp').then(m => ({ default: m.DatabaseProviderApp })));
const IntegrationManagerApp = lazy(() => import('../components/admin/IntegrationManagerApp').then(m => ({ default: m.IntegrationManagerApp })));
const AdminAlertsPanel = lazy(() => import('../components/admin/AdminAlertsPanel').then(m => ({ default: m.AdminAlertsPanel })));

// Real but currently coupled directly to Firestore (bypass the NexusDB
// abstraction) — works today if DB_PROVIDER=firestore, needs a rewrite to
// work on Postgres/other providers. Wired in because they're genuinely
// functional, not fake — see AUDIT_REPORT.md for the provider-lock caveat.
const CTOChatApp = lazy(() => import('../components/admin/CTOChatApp').then(m => ({ default: m.CTOChatApp })));
const SecurityBotApp = lazy(() => import('../components/admin/SecurityBotApp').then(m => ({ default: m.SecurityBotApp })));
const ChatMonitorApp = lazy(() => import('../components/admin/ChatMonitorApp').then(m => ({ default: m.ChatMonitorApp })));
const DatabaseManagerApp = lazy(() => import('../components/admin/DatabaseManagerApp').then(m => ({ default: m.DatabaseManagerApp })));
const GlobalSearch = lazy(() => import('../components/admin/GlobalSearch').then(m => ({ default: m.GlobalSearch })));
const GrowthDashboard = lazy(() => import('../components/admin/GrowthDashboard').then(m => ({ default: m.GrowthDashboard })));

const ModeControlPanel = lazy(() => import('../components/admin/ModeControlPanel').then(m => ({ default: m.ModeControlPanel })));

const SystemIntelligenceDashboardApp = lazy(() => import('../components/admin/SystemIntelligenceDashboardApp').then(m => ({ default: m.SystemIntelligenceDashboardApp })));

const DeveloperAPIHubApp = lazy(() => import('../components/admin/DeveloperAPIHubApp').then(m => ({ default: m.DeveloperAPIHubApp })));

// Fully local/static — genuinely functional, no backend needed.
const CategoryManagerApp = lazy(() => import('../components/admin/CategoryManagerApp').then(m => ({ default: m.CategoryManagerApp })));
const HelpCenterApp = lazy(() => import('../components/admin/HelpCenterApp').then(m => ({ default: m.HelpCenterApp })));

const ModuleLoader = () => (
  <div className="w-full h-full flex items-center justify-center bg-nexus-surface text-nexus-text-muted">
    <div className="flex flex-col items-center gap-3">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <span className="text-xs font-mono uppercase tracking-widest">Loading Module...</span>
    </div>
  </div>
);

export default function AdminOS() {
  const [activeTab, setActiveTab] = useState('overview');
  const { user, userRole, loginWithGoogle } = useAuth(); // ADDED Auth Check

  const isAdmin = userRole === 'admin';

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen bg-nexus-void text-nexus-text flex flex-col items-center justify-center">
        <Shield className="text-blue-500 mb-6" size={64} />
        <h1 className="text-3xl font-bold tracking-wider mb-2">NEXUS CONTROL CENTER</h1>
        <p className="text-nexus-text-muted mb-8 font-mono">
          {!user ? "AUTHENTICATION REQUIRED" : "ACCESS DENIED: ADMIN PRIVILEGES REQUIRED"}
        </p>
        {!user && (
          <button onClick={loginWithGoogle} className="bg-blue-600 hover:bg-blue-500 font-bold px-8 py-3 rounded-lg flex items-center gap-2">
            <LogIn size={18} /> INITIALIZE OAUTH PROTOCOL
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-nexus-void text-nexus-text">
      {/* Top Nav */}
      <nav className="sticky top-0 z-50 bg-nexus-surface/90 backdrop-blur-md border-b border-nexus-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="text-blue-500" size={24} />
          <h1 className="text-xl font-bold tracking-wider">NEXUS CONTROL CENTER</h1>
          <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded border border-purple-500/30 font-mono ml-4">
            PHASE 4 ACTIVE (INTELLIGENCE MODE)
          </span>
        </div>
        <div>
          <button
            onClick={() => setActiveTab('owner')}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 bg-nexus-surface-raised text-nexus-text-muted hover:text-nexus-text border border-nexus-border-strong"
          >
            <Mic size={16} /> Plain-English Command
          </button>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 border-r border-nexus-border h-[calc(100vh-65px)] sticky top-[65px] bg-nexus-surface overflow-y-auto">
          <div className="p-4 space-y-1">
            <div className="text-xs font-bold text-nexus-text-muted uppercase tracking-widest mb-4">Core Modules</div>
            
            <button onClick={() => setActiveTab('overview')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'overview' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <LayoutDashboard size={18} /> Analytics & Ops
            </button>
            <button onClick={() => setActiveTab('intelligence')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'intelligence' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Sparkles size={18} /> Nexus Core
            </button>
            <button onClick={() => setActiveTab('pyramid')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'pyramid' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Triangle size={18} /> Phase 5
            </button>
            <button onClick={() => setActiveTab('storefront')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'storefront' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Store size={18} /> Storefront Studio
            </button>
            <button onClick={() => setActiveTab('audit')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'audit' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Activity size={18} /> Global System Audit
            </button>
            <button onClick={() => setActiveTab('infrastructure')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'infrastructure' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Server size={18} /> Network & AI
            </button>
            <button onClick={() => setActiveTab('ecommerce')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'ecommerce' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Package size={18} /> E-Commerce
            </button>
            <button onClick={() => setActiveTab('fleet')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'fleet' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Truck size={18} /> Fleet Management
            </button>
            <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'settings' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Settings size={18} /> System Settings
            </button>
            <button onClick={() => setActiveTab('console')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'console' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Terminal size={18} /> System Console
            </button>

            <div className="text-xs font-bold text-nexus-text-muted uppercase tracking-widest mb-4 mt-6">Business</div>

            <button onClick={() => setActiveTab('finance')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'finance' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <DollarSign size={18} /> Finance & Payments
            </button>
            <button onClick={() => setActiveTab('growth')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'growth' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <TrendingUp size={18} /> Growth & Marketing
            </button>
            <button onClick={() => setActiveTab('procurement')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'procurement' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <ShoppingCart size={18} /> Procurement
            </button>
            <button onClick={() => setActiveTab('security')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'security' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <ShieldAlert size={18} /> Security
            </button>
            <button onClick={() => setActiveTab('owner')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'owner' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Crown size={18} /> Owner Controls
            </button>
            <button onClick={() => setActiveTab('ai-memory')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'ai-memory' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Brain size={18} /> AI, Memory & Integrations
            </button>
            <button onClick={() => setActiveTab('alerts')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'alerts' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <Bell size={18} /> Alerts
            </button>
            <button onClick={() => setActiveTab('help')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'help' ? 'bg-nexus-primary text-nexus-primary-text' : 'hover:bg-nexus-surface-raised'}`}>
              <BookOpen size={18} /> Help
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 max-h-[calc(100vh-65px)] overflow-y-auto bg-nexus-void p-6 space-y-6">
          <Suspense fallback={<ModuleLoader />}>
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <GlobalSearch />
                </div>
                <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <AnalyticsDashboardApp />
                </div>
                <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <OmnichannelHubApp />
                </div>
                <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <ChatMonitorApp />
                </div>
              </div>
            )}

            {activeTab === 'intelligence' && (
              <div className="h-[800px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                <NexusIntelligenceHubApp />
              </div>
            )}

            {activeTab === 'pyramid' && (
              <div className="h-[800px] bg-nexus-void border border-nexus-border rounded-xl overflow-hidden relative">
                <NexusPyramidProtocolApp />
              </div>
            )}

            {activeTab === 'storefront' && (
              <div className="h-[800px] bg-nexus-void border border-nexus-border rounded-xl overflow-hidden relative">
                <NexusStorefrontConfigApp />
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="h-[800px] bg-nexus-void border border-nexus-border rounded-xl overflow-hidden relative">
                <SystemAuditSimulationApp />
              </div>
            )}

            {activeTab === 'infrastructure' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                   <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                      <NerveCenterApp />
                   </div>
                   <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                      <TaskSchedulerApp />
                   </div>
                </div>
                <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <AIConfigPanel />
                </div>
                <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <TraceViewerApp />
                </div>
              </div>
            )}

            {activeTab === 'ecommerce' && (
              <div className="space-y-6">
                <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <ProductManagerApp />
                </div>
                <div className="h-[400px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <CategoryManagerApp />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <OrderManagerApp />
                  </div>
                  <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <UserManagerApp />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'fleet' && (
              <div className="h-[800px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                <FleetManagerApp />
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6">
                <div className="bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative" style={{ minHeight: 500 }}>
                  <ModeControlPanel />
                </div>
                <div className="bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative" style={{ minHeight: 600 }}>
                  <BrandThemeSettings />
                </div>
                <div className="bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative text-black">
                  <FeatureManager />
                </div>
              </div>
            )}

            {activeTab === 'console' && (
              <div className="h-[800px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                <SystemLogsPanel />
              </div>
            )}

            {activeTab === 'finance' && (
              <div className="space-y-6">
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <FinancialOSApp />
                </div>
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <PaymentOSApp />
                </div>
                <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <TokenAnalyticsApp />
                </div>
              </div>
            )}

            {activeTab === 'growth' && (
              <div className="space-y-6">
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <CEOCommandCenter />
                </div>
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <MarketingAgentApp />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <LoyaltyAdminPanel />
                  </div>
                  <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <DynamicPricingApp />
                  </div>
                </div>
                <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <GrowthDashboard />
                </div>
              </div>
            )}

            {activeTab === 'procurement' && (
              <div className="h-[800px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                <ProcurementApp />
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6">
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <SecurityOpsApp />
                </div>
                <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <SecurityBotApp />
                </div>
              </div>
            )}

            {activeTab === 'owner' && (
              <div className="space-y-6">
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <OwnerControlPanel />
                </div>
                <div className="h-[800px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <OwnerAIControlApp />
                </div>
              </div>
            )}

            {activeTab === 'ai-memory' && (
              <div className="space-y-6">
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <SystemIntelligenceDashboardApp />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <AIProviderDashboard />
                  </div>
                  <div className="h-[600px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <MemoryDashboard />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <DatabaseProviderApp />
                  </div>
                  <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <IntegrationManagerApp />
                  </div>
                </div>
                <div className="h-[700px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                  <DeveloperAPIHubApp />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <CTOChatApp />
                  </div>
                  <div className="h-[500px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                    <DatabaseManagerApp />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'alerts' && (
              <div className="h-[800px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                <AdminAlertsPanel />
              </div>
            )}

            {activeTab === 'help' && (
              <div className="h-[800px] bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden relative">
                <HelpCenterApp />
              </div>
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
