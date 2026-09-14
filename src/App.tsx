import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { UserCircle, Shield, Truck, MessagesSquare, Monitor, X, ChevronRight, Package } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { AdminSecretGate } from './components/admin/AdminSecretGate';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const Storefront = lazy(() => import('./pages/Marketplace'));
const RiderDashboard = lazy(() => import('./pages/RiderDashboard'));
const RepDashboard = lazy(() => import('./pages/RepDashboard'));
const VendorDashboard = lazy(() => import('./pages/VendorDashboard'));
const DesktopShell = lazy(() => import('./apps/control-center/DesktopShell').then(module => ({ default: module.DesktopShell })));
const CEODashboard = lazy(() => import('./components/dashboard/CEODashboard').then(module => ({ default: module.CEODashboard })));
const AdminOS = lazy(() => import('./pages/AdminOS'));
const LogisticsTrackingPage = lazy(() => import('./pages/LogisticsTrackingPage').then(m => ({ default: m.LogisticsTrackingPage })));

const LoadingFallback = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-[#050505] text-white">
    <div className="flex flex-col items-center gap-4">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="font-mono text-sm tracking-widest uppercase text-blue-400">Loading Nexus Core...</p>
    </div>
  </div>
);

const PersonaSwitcher = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { userRole } = useAuth();

  // Only show to admins and CEO roles
  if (userRole !== 'admin' && userRole !== 'ceo') {
    return null;
  }

  const personas = [
    { name: 'Customer View', path: '/', icon: <UserCircle size={14} />, desc: 'Marketplace' },
    { name: 'Admin OS', path: '/admin', icon: <Shield size={14} />, desc: 'Command Center' },
    { name: 'CEO Vault', path: '/ceo', icon: <Monitor size={14} />, desc: 'Master Controls' },
    { name: 'Rider App', path: '/rider', icon: <Truck size={14} />, desc: 'Delivery routing' },
    { name: 'Logistics Scanner', path: '/logistics', icon: <Package size={14} />, desc: 'Batch Handoffs' },
    { name: 'Rep Dashboard', path: '/rep', icon: <MessagesSquare size={14} />, desc: 'Omnichannel' },
    { name: 'Control Center OS', path: '/os', icon: <Monitor size={14} />, desc: 'Windowed desktop' },
  ];

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-[9999] bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full shadow-lg shadow-blue-500/20 backdrop-blur-md flex items-center justify-center transition-all group"
      >
        <UserCircle size={20} />
        <span className="max-w-0 overflow-hidden whitespace-nowrap group-hover:max-w-xs transition-all duration-300 font-bold text-sm ml-0 group-hover:ml-2">
          Switch Persona
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-72 bg-[#111]/95 backdrop-blur-xl border border-[#333] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <div className="bg-[#1a1a1a] px-4 py-3 flex justify-between items-center border-b border-[#333]">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <UserCircle size={16} className="text-blue-400" />
          Persona Matrix
        </h3>
        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white p-1">
          <X size={16} />
        </button>
      </div>
      <div className="p-2 space-y-1">
        {personas.map(p => (
          <Link
            key={p.path}
            to={p.path}
            onClick={() => setIsOpen(false)}
            className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
              location.pathname === p.path ? 'bg-blue-600/20 border border-blue-500/50 text-white' : 'hover:bg-[#222] border border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`p-1.5 rounded-lg ${location.pathname === p.path ? 'bg-blue-500 text-white' : 'bg-[#333] text-gray-400'}`}>
                {p.icon}
              </div>
              <div className="flex flex-col text-left">
                <span className="text-sm font-bold leading-tight">{p.name}</span>
                <span className="text-[10px] text-gray-500">{p.desc}</span>
              </div>
            </div>
            <ChevronRight size={14} className="opacity-50" />
          </Link>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/store/:storeId" element={<Storefront />} />
          {/* FIX: Redirect /marketplace to /store/global for Stripe success/cancel callbacks */}
          <Route path="/marketplace" element={<Navigate to="/store/global" replace />} />
          <Route path="/ceo" element={<AdminSecretGate><CEODashboard /></AdminSecretGate>} />
          <Route path="/admin" element={<AdminSecretGate><AdminOS /></AdminSecretGate>} />
          <Route path="/rider" element={<RiderDashboard />} />
          <Route path="/vendor" element={<VendorDashboard />} />
          <Route path="/logistics" element={<LogisticsTrackingPage />} />
          <Route path="/rep" element={<RepDashboard />} />
          <Route path="/os" element={<DesktopShell />} />
        </Routes>
        <PersonaSwitcher />
      </Suspense>
    </Router>
  );
}
